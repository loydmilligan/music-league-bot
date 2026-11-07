import { performance } from 'node:perf_hooks';
import type { CmuCommand } from './cmuCommand.js';
import {
  CMU_DEADLINE_MS,
  CMU_FAILURE_DM_TIMEOUT_MS,
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
} from './catchMeUp.js';

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

const HELP_THROTTLE = new Map<string, number>();
/** The live cooldown, learned from companelist's status responses. Deps may override the holder (tests). */
const HELP_COOLDOWN = { min: DEFAULT_HELP_COOLDOWN_MIN };

/** A cooldown companelist sent: an integer 1-60, else undefined (ignored). */
const validCooldown = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 60 ? v : undefined;

type End = (outcome: string, error?: string) => void;
type ForgetTarget = Extract<CmuCommand, { kind: 'forget' }>['target'];

/** H2, verbatim. `used` undefined means companelist couldn't be asked (H3). */
export function helpText(o: { botName: string; used?: number; limit: number; cooldownMin: number; owner: boolean }): string {
  const at = `@${o.botName}`;
  const count = o.used === undefined
    ? `${o.limit} a day (couldn't check your count just now)`
    : `You've used ${o.used} of ${o.limit} today. Resets at midnight (LA time).`;
  const lines = [
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
    );
  }
  return lines.join('\n');
}

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
  return { notifyName, requestAt: msg.capturedAt, league: deps.groups.get(msg.from), requesterKey: await resolveRequesterKey(msg, deps) };
}

async function safeContactName(deps: CmuDeps, id: string): Promise<string> {
  try {
    return (await deps.contactName?.(id)) || '';
  } catch {
    return '';
  }
}

/** Owner only (R1–R4): reset a count and forget the latest request, then confirm by DM. */
export async function runForget(msg: CmuMessage, deps: CmuDeps, target: ForgetTarget, trace: SafeTrace, end: End): Promise<void> {
  let outcome = 'failed';
  let error: string | undefined;
  const state = { posted: false };
  try {
    await react(msg, '👍', deps, trace);
    try {
      outcome = await withDeadline(forget(msg, deps, target, trace, state), deps.deadlineMs ?? CMU_DEADLINE_MS);
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
        await withDeadline(deps.sendText(msg.author, FORGET_FAILURE_TEXT), deps.failureDmTimeoutMs ?? CMU_FAILURE_DM_TIMEOUT_MS);
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

async function forget(msg: CmuMessage, deps: CmuDeps, target: ForgetTarget, trace: SafeTrace, state: { posted: boolean }): Promise<'forgot'> {
  const player = typeof target === 'object';
  const contactName = player ? await safeContactName(deps, target.id) : '';
  const wireTarget = player ? { key: await resolveKey(target.id, deps), name: contactName } : target;
  const body = { ...(await baseBody(msg, deps)), mode: 'forget', target: wireTarget };

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

  const reply = forgetReply(result, contactName);
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
    await react(msg, '⏳', deps, trace);
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
    await react(msg, '👍', deps, trace);
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
  const text = helpText({ botName: deps.botName?.() || DEFAULT_BOT_NAME, used, limit, cooldownMin: cooldown.min, owner });
  await timed(trace, 'help-dm', () => deps.sendText(msg.author, text));
}
