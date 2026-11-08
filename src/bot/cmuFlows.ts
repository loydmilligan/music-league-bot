import { performance } from 'node:perf_hooks';
import type { CmuCommand } from './cmuCommand.js';
import { ALL_COMMANDS, HELP_TABLE, SECTION_EXPLAIN, menuHeading, type HelpEntry } from './cmuMenu.js';
import {
  CMU_ACK_EMOJI,
  CMU_DEADLINE_MS,
  CMU_FAILURE_DM_TIMEOUT_MS,
  CMU_WAIT_EMOJI,
  CmuHttpError,
  checkOwner,
  describeError,
  msSince,
  react,
  resolveKey,
  resolveNotifyName,
  resolveRequesterKey,
  timed,
  withDeadline,
  type CmuDeps,
  type CmuMessage,
  type SafeTrace,
  framing,
} from './catchMeUp.js';
import { FOOTER_HELP, FOOTER_OWNER, FOOTER_RETRY, MESSAGE_NAMES, frameMessage } from './messageFrame.js';
import type { CmuSwitch } from './cmuSwitch.js';

/**
 * The forget (owner only) and help flows of "@bot ...", split out of
 * catchMeUp.ts (P4). runCatchMeUp has already checked the group, the DM
 * target and, for forget, the owner. Every DM goes to msg.author only, and
 * no name, id or DM text reaches the trace or the log.
 */

export const DEFAULT_BOT_NAME = 'Music League Bot';
export const CMU_DAILY_LIMIT = 3;
/** H4: at most one help DM per person per cooldown (configurable in companelist's admin, default 5 minutes). */
export const DEFAULT_HELP_COOLDOWN_MIN = 5;
/** Status and forget never build; their companelist call gets a short bound of its own. */
export const CMU_COMMAND_TIMEOUT_MS = 15_000;
export const FORGET_FAILURE_TEXT = "Couldn't reach the catch-up service, so nothing was forgotten. Try again in a few minutes.";

export const RECAP_FAILURE_TEXT = "Couldn't build the recap just now.";

const HELP_THROTTLE = new Map<string, number>();
/** The live cooldown, learned from companelist's status responses. Deps may override the holder (tests). */
const HELP_COOLDOWN = { min: DEFAULT_HELP_COOLDOWN_MIN };

/** A cooldown companelist sent: an integer 1-60, else undefined (ignored). */
const validCooldown = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 60 ? v : undefined;

type End = (outcome: string, error?: string) => void;
type ForgetTarget = Extract<CmuCommand, { kind: 'forget' }>['target'];
type ForgetScope = Extract<CmuCommand, { kind: 'forget' }>['scope'];

/** H2, verbatim. `used` undefined means companelist couldn't be asked (H3). */
export function helpText(o: { botName: string; used?: number; limit: number; cooldownMin: number; owner: boolean; dmOk?: boolean }): string {
  const at = `@${o.botName}`;
  const count = o.used === undefined
    ? `${o.limit} a day (couldn't check your count just now)`
    : `You've used ${o.used} of ${o.limit} today. Resets at midnight (LA time).`;
  const lines = o.dmOk ? [
    menuHeading(true),
    ...ALL_COMMANDS,
    '',
    count,
    'Add "week" to any top- command for the last 7 days.',
  ] : [
    'Catch-up bot — what you can ask',
    '',
    `${at} catch me up`,
    '  A picture of what you missed since your last post (up to 48 hours),',
    '  plus links to the top topics. Also works: "what did I miss", "cmu",',
    '  "fill me in", "recap".',
    '',
    count,
    '',
    `${at} help`,
    `  This message. Once every ${o.cooldownMin} ${o.cooldownMin === 1 ? 'minute' : 'minutes'}; ask again sooner and you get ⏳.`,
  ];
  if (o.owner) {
    lines.push(
      '',
      'Owner only',
      `  ${at} full — the last 48 hours; doesn't count or move your window.`,
      `  ${at} forget — forget your last catch-up and reset your count.`,
      `  ${at} forget @Player — the same for that player.`,
      `  ${at} forget all — the same for every player.`,
      `  ${at} off — turn catch-me-up off everywhere (no reactions, no DMs).`,
      `  ${at} on — turn it back on.`,
      `  ${at} tldr — post a short how-to in this group.`,
    );
  }
  return lines.join('\n');
}

/** Sprint 4 help body (unframed; framing happens at the send). */
export function helpBody(o: { dmOk: boolean; owner: boolean; used?: number; limit: number }): string {
  const count = o.used === undefined
    ? `${o.limit} a day (couldn't check your count just now)`
    : `You've used ${o.used} of ${o.limit} today. Resets at midnight (LA time).`;
  const line = (e: HelpEntry) => `  ${e.command} \u2014 ${e.explain}`;
  const players = HELP_TABLE.filter((e) => !e.owner);
  const section = (where: HelpEntry['where'], empty?: string): string[] => {
    const items = players.filter((e) => e.where === where);
    return [SECTION_EXPLAIN[where], ...(items.length ? items.map(line) : empty ? [empty] : [])];
  };
  const lines = [
    ...section('both'),
    '',
    ...section('group', 'Nothing group-only yet. Both commands work here too.'),
    ...(o.dmOk ? ['', ...section('dm')] : []),
    '',
    count,
  ];
  if (o.owner) {
    const tag = (w: HelpEntry['where']) => (w === 'dm' ? '(DM)' : `(${w})`);
    lines.push('', 'Owner only', ...HELP_TABLE.filter((e) => e.owner).map((e) => `  ${e.command} ${tag(e.where)} \u2014 ${e.explain}`));
  }
  return lines.join('\n');
}

/** K7, verbatim: the group reminder `@bot tldr` posts. `cooldownMin` is not in the copy yet. */
export function tldrText(o: { botName: string; limit: number; cooldownMin?: number }): string {
  const at = `@${o.botName}`;
  return [
    "👋 Quick reminder: I'm the catch-up bot.",
    '',
    "Been away and the chat ran a few hundred messages deep? Skip the scroll. Tag me and I'll DM you what you missed.",
    '',
    `${at} catch me up`,
    '  A picture of everything since your last post (up to 48 hours), plus links to the top topics. "what did I miss", "cmu" and "recap" work too.',
    '',
    `${at} help`,
    '  The full list, sent to you privately.',
    '',
    `You get ${o.limit} a day, reset at midnight LA time. Everything comes by DM; nothing gets posted here but this.`,
  ].join('\n');
}

/** K5 / K6, verbatim. */
export const switchOffText = (botName: string): string =>
  `Catch-up bot is off. Nobody gets reactions or DMs from catch-me-up commands until you send "@${botName} on" in any group.`;
export const SWITCH_ON_TEXT = 'Catch-up bot is back on.';
export const switchFailureText = (still: 'on' | 'off'): string => `Couldn't change the catch-up switch; it's still ${still}.`;

/** A switch that can't even be read counts as on, like a missing file. */
function safeIsEnabled(sw: CmuSwitch): boolean {
  try {
    return sw.isEnabled() !== false;
  } catch {
    return true;
  }
}

/** K7: at most one tldr per group per 30 minutes. */
export const TLDR_COOLDOWN_MS = 30 * 60_000;
const TLDR_THROTTLE = new Map<string, number>();

/**
 * M4: is `author` the owner? True when the raw ids match or both map to the
 * same DM target. A failed mapping is "no" (fail closed).
 */
export function makeIsOwner(dmTarget: (id: string) => Promise<string>, ownerId: string): (author: string) => Promise<boolean> {
  return async (author) => {
    if (!author || !ownerId) return false;
    if (author === ownerId) return true;
    try {
      const [a, o] = await Promise.all([dmTarget(author), dmTarget(ownerId)]);
      return !!a && a === o;
    } catch {
      return false;
    }
  };
}

interface Forgot { target: 'self' | 'all' | 'player'; resolved: boolean; forgotten: boolean; person?: string; left: number }

function parseForgot(data: unknown): Forgot | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d.kind !== 'forgot' || (d.target !== 'self' && d.target !== 'all' && d.target !== 'player')) return null;
  return {
    target: d.target,
    resolved: d.resolved === true,
    forgotten: d.forgotten === true,
    person: typeof d.person === 'string' && d.person.trim() ? d.person : undefined,
    left: typeof d.left === 'number' ? d.left : CMU_DAILY_LIMIT,
  };
}

/** R4 and B4. `contactName` is the name the bot sent for a `forget @Player`. */
export function forgetReply(r: Forgot, contactName: string): string {
  if (r.target === 'all') return "Forgot everyone's last catch-up and reset today's counts.";
  if (r.target === 'self') {
    return r.forgotten
      ? `Forgot your last catch-up. You have ${r.left} left today.`
      : 'Reset your count; no recent catch-up to forget.';
  }
  const name = contactName.trim();
  if (!r.resolved) return `Couldn't tell who ${name || 'that player'} is; reset their count only.`;
  const person = r.person ?? (name || 'that player');
  return r.forgotten
    ? `Forgot ${person}'s last catch-up. They have ${r.left} left today.`
    : `Reset ${person}'s count; no recent catch-up to forget.`;
}

/** Sprint 4 forget confirmation: worded from the scope and target only (not the `forgotten` flag). */
export function forgetReplyScoped(r: Forgot, scope: ForgetScope, contactName: string): string {
  const what = scope === 'dl' ? 'Daily Limit reset' : scope === 'sybg' ? 'SYBG reset' : 'Daily Limit and SYBG reset';
  if (r.target === 'all') return `${what} for everyone.`;
  if (r.target === 'self') return `${what} for you.`;
  return `${what} for ${r.person ?? (contactName.trim() || 'that player')}.`;
}

/** POST one request to companelist; a non-2xx throws CmuHttpError. Returns the status and JSON body. */
async function post(deps: CmuDeps, body: Record<string, unknown>, timeoutMs: number): Promise<{ status: number; data: unknown }> {
  const res = await deps.fetchFn(deps.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${deps.token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new CmuHttpError(res.status);
  return { status: res.status, data: await res.json() };
}

async function baseBody(msg: CmuMessage, deps: CmuDeps): Promise<Record<string, unknown>> {
  const { name: notifyName } = await resolveNotifyName(msg);
  return { notifyName, requestAt: msg.capturedAt, league: deps.groups.get(msg.from), requesterKey: await resolveRequesterKey(msg, deps), ...(msg.via === 'dm' ? { via: 'dm' } : {}) };
}

async function safeContactName(deps: CmuDeps, id: string): Promise<string> {
  try {
    return (await deps.contactName?.(id)) || '';
  } catch {
    return '';
  }
}

/**
 * An owner failure DM. Framed (sprint 4) it carries FOOTER_RETRY, so a "Try again ..." sentence in the
 * body is dropped; unframed it is the old text, byte for byte.
 */
function ownerFailure(deps: CmuDeps, msg: CmuMessage, name: string, text: string): string {
  if (!framing(deps, msg.from, true)) return text;
  const body = text.replace(/\s*Try again in a few minutes\.$/, '');
  return frameMessage({ name, body, footer: FOOTER_RETRY });
}

/** Owner only (R1–R4): reset a count and forget the latest request, then confirm by DM. */
export async function runForget(msg: CmuMessage, deps: CmuDeps, target: ForgetTarget, scope: ForgetScope, trace: SafeTrace, end: End): Promise<void> {
  let outcome = 'failed';
  let error: string | undefined;
  const state = { posted: false };
  try {
    await react(msg, CMU_ACK_EMOJI, deps, trace);
    try {
      outcome = await withDeadline(forget(msg, deps, target, scope, trace, state), deps.deadlineMs ?? CMU_DEADLINE_MS);
    } catch (err) {
      if (state.posted) {
        // The forget itself succeeded; only the confirm DM (or the deadline) failed. No contradictory DM.
        outcome = 'forgot';
        deps.log(`[cmu] forget confirm failed in ${msg.from}: ${describeError(err)}`);
        return;
      }
      outcome = 'failed';
      error = describeError(err);
      deps.log(`[cmu] forget failed in ${msg.from}: ${error}`);
      const t0 = performance.now();
      try {
        await withDeadline(deps.sendText(msg.author, ownerFailure(deps, msg, MESSAGE_NAMES.forget, FORGET_FAILURE_TEXT)), deps.failureDmTimeoutMs ?? CMU_FAILURE_DM_TIMEOUT_MS);
        trace.step('failure-dm', { ok: true, ms: msSince(t0) });
      } catch (dmErr) {
        trace.step('failure-dm', { ok: false, ms: msSince(t0) });
        deps.log(`[cmu] failure DM failed in ${msg.from}: ${describeError(dmErr)}`);
      }
    }
  } finally {
    end(outcome, error);
  }
}

async function forget(msg: CmuMessage, deps: CmuDeps, target: ForgetTarget, scope: ForgetScope, trace: SafeTrace, state: { posted: boolean }): Promise<'forgot'> {
  const player = typeof target === 'object';
  const contactName = player ? await safeContactName(deps, target.id) : '';
  const wireTarget = player ? { key: await resolveKey(target.id, deps), name: contactName } : target;
  const frame = framing(deps, msg.from, true);
  const body = { ...(await baseBody(msg, deps)), mode: 'forget', target: wireTarget, ...(frame ? { scope } : {}) };

  const t0 = performance.now();
  let result: Forgot | null;
  try {
    const { data } = await post(deps, body, CMU_COMMAND_TIMEOUT_MS);
    result = parseForgot(data);
    if (!result) throw new Error('BadResponse');
  } catch (err) {
    trace.step('forget', { ok: false, ms: msSince(t0), status: err instanceof CmuHttpError ? err.status : undefined });
    throw err;
  }
  // P3: `forget @` keeps only whether the player was resolved; never the id or a name.
  state.posted = true;
  trace.step('forget', { ok: true, ms: msSince(t0), status: 200, ...(player ? { resolved: result.resolved } : {}) });

  const reply = frame
    ? frameMessage({ name: MESSAGE_NAMES.forget, body: forgetReplyScoped(result, scope, contactName), footer: FOOTER_OWNER })
    : forgetReply(result, contactName);
  await timed(trace, 'confirm-dm', () => deps.sendText(msg.author, reply));
  deps.log(`[cmu] forgot in ${msg.from}`);
  return 'forgot';
}

/**
 * Anyone (H1–H5): a help DM with today's count, at most once per person per cooldown (configurable
 * in companelist's admin, default 5 minutes). A throttled help gets a ⏳ reaction and no DM.
 */
export async function runHelp(msg: CmuMessage, deps: CmuDeps, trace: SafeTrace, end: End): Promise<void> {
  const throttle = deps.helpThrottle ?? HELP_THROTTLE;
  const now = deps.now ?? Date.now;
  const cooldown = deps.helpCooldown ?? HELP_COOLDOWN;
  const last = throttle.get(msg.author);
  if (last !== undefined && now() - last < cooldown.min * 60_000) {
    await react(msg, CMU_WAIT_EMOJI, deps, trace);
    // The help message is still a chat message: tell companelist so it is not taken for a real post.
    try {
      const { data } = await post(deps, { ...(await baseBody(msg, deps)), mode: 'status' }, CMU_COMMAND_TIMEOUT_MS);
      learnCooldown(cooldown, data);
    } catch (err) {
      deps.log(`[cmu] throttled help status failed in ${msg.from}: ${describeError(err)}`);
    }
    end('help-throttled');
    return;
  }

  let outcome = 'failed';
  let error: string | undefined;
  try {
    await react(msg, CMU_ACK_EMOJI, deps, trace);
    await withDeadline(help(msg, deps, trace, cooldown), deps.deadlineMs ?? CMU_DEADLINE_MS);
    outcome = 'help';
    const t = now();
    for (const [k, at] of throttle) if (t - at >= cooldown.min * 60_000) throttle.delete(k);
    throttle.set(msg.author, t);
  } catch (err) {
    error = describeError(err);
    deps.log(`[cmu] help failed in ${msg.from}: ${error}`);
  } finally {
    end(outcome, error);
  }
}

function learnCooldown(cooldown: { min: number }, data: unknown): void {
  const v = validCooldown(data && typeof data === 'object' ? (data as Record<string, unknown>).helpCooldownMin : undefined);
  if (v !== undefined) cooldown.min = v;
}

async function help(msg: CmuMessage, deps: CmuDeps, trace: SafeTrace, cooldown: { min: number }): Promise<void> {
  const owner = await checkOwner(msg, deps, null);
  let used: number | undefined;
  let limit = CMU_DAILY_LIMIT;
  const t0 = performance.now();
  try {
    const { status, data } = await withDeadline(
      (async () => post(deps, { ...(await baseBody(msg, deps)), mode: 'status' }, CMU_COMMAND_TIMEOUT_MS))(),
      CMU_COMMAND_TIMEOUT_MS,
    );
    const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    if (d.kind !== 'status' || typeof d.used !== 'number') throw new Error('BadResponse');
    used = d.used;
    if (typeof d.limit === 'number') limit = d.limit;
    learnCooldown(cooldown, d);
    trace.step('status', { ok: true, ms: msSince(t0), status, used, limit });
  } catch (err) {
    trace.step('status', { ok: false, ms: msSince(t0), status: err instanceof CmuHttpError ? err.status : undefined });
    deps.log(`[cmu] status failed in ${msg.from}: ${describeError(err)}`);
  }
  // G5 / H-DM: the DM list only for a preview person; by DM the router has already checked that.
  let dmOk = msg.via === 'dm';
  if (!dmOk) {
    try {
      dmOk = deps.preview?.isPreviewPerson(await resolveKey(msg.author, deps)) === true;
    } catch {
      dmOk = false;
    }
  }
  const text = framing(deps, msg.from, true)
    ? frameMessage({ name: MESSAGE_NAMES.help, body: helpBody({ dmOk, owner, used, limit }), footer: FOOTER_HELP })
    : helpText({ botName: deps.botName?.() || DEFAULT_BOT_NAME, used, limit, cooldownMin: cooldown.min, owner, dmOk });
  await timed(trace, 'help-dm', () => deps.sendText(msg.author, text));
}

/**
 * Owner only (K5, K6): flip the global switch, then confirm by DM. No reaction,
 * so the group sees nothing. Repeating the current state sends the same DM.
 */
export async function runSwitch(msg: CmuMessage, deps: CmuDeps, sw: CmuSwitch, enabled: boolean, trace: SafeTrace, end: End): Promise<void> {
  const label = enabled ? 'on' : 'off';
  try {
    sw.set(enabled, new Date((deps.now ?? Date.now)()));
  } catch (err) {
    trace.step('switch', { ok: false, enabled });
    const error = describeError(err);
    deps.log(`[cmu] switch ${label} failed in ${msg.from}: ${error}`);
    const still = safeIsEnabled(sw) ? 'on' : 'off';
    try {
      await withDeadline(
        timed(trace, 'failure-dm', () => deps.sendText(msg.author, ownerFailure(deps, msg, enabled ? MESSAGE_NAMES.botOn : MESSAGE_NAMES.botOff, switchFailureText(still)))),
        deps.failureDmTimeoutMs ?? CMU_FAILURE_DM_TIMEOUT_MS,
      );
    } catch (dmErr) {
      deps.log(`[cmu] switch failure DM failed in ${msg.from}: ${describeError(dmErr)}`);
    }
    end('failed', error);
    return;
  }
  trace.step('switch', { ok: true, enabled });
  deps.log(`[cmu] switched ${label} in ${msg.from}`);
  const plain = enabled ? SWITCH_ON_TEXT : switchOffText(deps.botName?.() || DEFAULT_BOT_NAME);
  const text = framing(deps, msg.from, true)
    ? frameMessage({ name: enabled ? MESSAGE_NAMES.botOn : MESSAGE_NAMES.botOff, body: plain, footer: FOOTER_OWNER })
    : plain;
  try {
    await withDeadline(
      timed(trace, 'confirm-dm', () => deps.sendText(msg.author, text)),
      deps.failureDmTimeoutMs ?? CMU_FAILURE_DM_TIMEOUT_MS,
    );
  } catch (err) {
    // The switch itself took; only the confirmation failed.
    deps.log(`[cmu] switch confirm failed in ${msg.from}: ${describeError(err)}`);
  }
  end(label);
}

/**
 * Owner only (K7): 👍, then a short how-to posted in the group itself. At most
 * once per group per 30 minutes; a throttled tldr gets ⏳ and no post. No
 * companelist call, and it counts toward no one's daily limit.
 */
export async function runTldr(msg: CmuMessage, deps: CmuDeps, trace: SafeTrace, end: End): Promise<void> {
  const throttle = deps.tldrThrottle ?? TLDR_THROTTLE;
  const now = deps.now ?? Date.now;
  const last = throttle.get(msg.from);
  if (last !== undefined && now() - last < TLDR_COOLDOWN_MS) {
    await react(msg, CMU_WAIT_EMOJI, deps, trace);
    end('tldr-throttled');
    return;
  }
  let outcome = 'failed';
  let error: string | undefined;
  try {
    await react(msg, CMU_ACK_EMOJI, deps, trace);
    const cooldown = deps.helpCooldown ?? HELP_COOLDOWN;
    const text = tldrText({ botName: deps.botName?.() || DEFAULT_BOT_NAME, limit: CMU_DAILY_LIMIT, cooldownMin: cooldown.min });
    // The one message catch-me-up ever sends to a group, on the owner's say-so.
    await withDeadline(timed(trace, 'group-post', () => deps.sendText(msg.from, text)), deps.deadlineMs ?? CMU_DEADLINE_MS);
    outcome = 'tldr';
    const t = now();
    for (const [k, at] of throttle) if (t - at >= TLDR_COOLDOWN_MS) throttle.delete(k);
    throttle.set(msg.from, t);
    deps.log(`[cmu] tldr posted in ${msg.from}`);
  } catch (err) {
    error = describeError(err);
    deps.log(`[cmu] tldr failed in ${msg.from}: ${error}`);
  } finally {
    end(outcome, error);
  }
}

/**
 * Owner only: ask companelist for a one-screen summary of the last 24 h of bot activity and DM it
 * to the requester. Reacts with the ack emoji on the command message first (as catch me up and help do),
 * then DMs; nothing is posted in the group. Any failure DMs a fixed one-liner.
 * No message text, id or DM text reaches the trace or the log.
 */
export async function runRecap(msg: CmuMessage, deps: CmuDeps, trace: SafeTrace, end: End): Promise<void> {
  let outcome = 'recap-failed';
  let error: string | undefined;
  try {
    await react(msg, CMU_ACK_EMOJI, deps, trace);
    const t0 = performance.now();
    let text: string;
    try {
      const { status, data } = await withDeadline(
        (async () => post(deps, { ...(await baseBody(msg, deps)), mode: 'recap' }, CMU_COMMAND_TIMEOUT_MS))(),
        deps.deadlineMs ?? CMU_COMMAND_TIMEOUT_MS,
      );
      const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
      if (d.kind !== 'recap' || typeof d.text !== 'string') throw new Error('BadResponse');
      text = d.text;
      trace.step('companelist', { ok: true, ms: msSince(t0), status });
    } catch (err) {
      trace.step('companelist', { ok: false, ms: msSince(t0), status: err instanceof CmuHttpError ? err.status : undefined });
      throw err;
    }
    const dm = framing(deps, msg.from, true) ? frameMessage({ name: MESSAGE_NAMES.botCalls, body: text, footer: FOOTER_OWNER }) : text;
    await withDeadline(timed(trace, 'confirm-dm', () => deps.sendText(msg.author, dm)), deps.deadlineMs ?? CMU_DEADLINE_MS);
    outcome = 'recap';
  } catch (err) {
    error = describeError(err);
    deps.log(`[cmu] recap failed in ${msg.from}: ${error}`);
    try {
      await withDeadline(
        timed(trace, 'failure-dm', () => deps.sendText(msg.author, ownerFailure(deps, msg, MESSAGE_NAMES.botCalls, RECAP_FAILURE_TEXT))),
        deps.failureDmTimeoutMs ?? CMU_FAILURE_DM_TIMEOUT_MS,
      );
    } catch (dmErr) {
      deps.log(`[cmu] recap failure DM failed in ${msg.from}: ${describeError(dmErr)}`);
    }
  } finally {
    end(outcome, error);
  }
}
