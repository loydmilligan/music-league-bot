import { randomUUID } from 'node:crypto';
import { rm, stat } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import os from 'node:os';
import path from 'node:path';
import { parseCmuCommand, type CmuCommand } from './cmuCommand.js';
import { runForget, runHelp, runSwitch, runTldr } from './cmuFlows.js';
import { memoryCmuSwitch, type CmuSwitch } from './cmuSwitch.js';
import { NOOP_TRACE, type InteractionTrace } from '../storage/interactionLog.js';

/**
 * "@bot catch me up": DM the requester a picture of what they missed.
 *
 * The bot only does the plumbing here. companelist (POST CMU_URL) picks the
 * window, writes the text and returns card HTML; the bot screenshots that HTML
 * with WhatsApp's own Chromium and DMs the PNG plus the topic links to the
 * request's author. The group sees one 👍 (or ⏳ when over the limit) and
 * nothing else. Logs carry outcome + group id only, never text or names.
 */

export const CMU_FAILURE_TEXT = "Couldn't build your catch-up just now. Try again in a few minutes.";
/** companelist refreshes take 22-89 s before the brief call; its idle timeout is 5 min. */
export const CMU_TIMEOUT_MS = 240_000;
/** Whole request, fetch included: a hung screenshot or send must not leave the requester with nothing. */
export const CMU_DEADLINE_MS = 270_000;
/** The failure DM is best effort and gets its own bound. */
export const CMU_FAILURE_DM_TIMEOUT_MS = 15_000;

/** C1: a bot mention whose text after the mention starts with a catch-up phrase. */
export function isCatchMeUpRequest(text: string, mentionsBot: boolean): boolean {
  return parseCmuCommand(text, mentionsBot, [], new Set())?.kind === 'catchup';
}

/** CMU_GROUPS="<groupId>@g.us=<instance>,..." → Map(groupId → instance). */
export function parseCmuGroups(env: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const pair of (env ?? '').split(',')) {
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    const id = pair.slice(0, eq).trim();
    const instance = pair.slice(eq + 1).trim();
    if (id && instance) map.set(id, instance);
  }
  return map;
}

export interface CmuMessage {
  from: string;          // group chat id
  author: string;        // requester id (@lid or @c.us); the only DM target
  capturedAt: string;    // ISO timestamp of the request message
  notifyName?: string;   // WhatsApp display name from the message payload
  chatName?: string;     // human-readable group name (interaction log only)
  mentionedIds?: string[]; // serialized wids the message @mentions
  getContact(): Promise<{ pushname: string }>;
  react?(emoji: string): Promise<void>;
}

export interface CmuDeps {
  fetchFn: typeof fetch;
  groups: Map<string, string>;
  url: string;
  token: string;
  /** PNG to outPath; when thumbPath is given, also a best-effort JPEG thumbnail there. */
  screenshot(html: string, outPath: string, thumbPath?: string): Promise<{ thumbBytes?: number } | void>;
  sendImage(chatId: string, filePath: string): Promise<void>;
  sendText(chatId: string, text: string): Promise<void>;
  log(line: string): void;
  /**
   * The id WhatsApp delivers to for `id` (an @c.us author swapped for its LID).
   * Used for the requester's limits key; absent or failing, msg.author is used.
   */
  dmTarget?(id: string): Promise<string>;
  /** Overrides for tests; default CMU_DEADLINE_MS / CMU_FAILURE_DM_TIMEOUT_MS. */
  deadlineMs?: number;
  failureDmTimeoutMs?: number;
  /** Interaction-log trace factory, called once per request. Default: NOOP_TRACE. */
  trace?: () => InteractionTrace;
  /** M4: is `author` the owner? Absent or failing means no (fail closed). */
  isOwner?(author: string): Promise<boolean>;
  /** A contact's display name, for `forget @Player`. Absent or failing means ''. */
  contactName?(id: string): Promise<string>;
  /** The bot's WhatsApp display name, for the help DM. Default "Music League Bot". */
  botName?(): string;
  /** Author id → last sent help DM (ms). Default: a module-level map. */
  helpThrottle?: Map<string, number>;
  /** The help cooldown in minutes, as companelist last said. Default: a module-level holder (5). */
  helpCooldown?: { min: number };
  /** Clock override for tests. Default: Date.now. */
  now?(): number;
  /** K3: the owner's global off/on switch. Default: an in-memory switch (enabled). */
  cmuSwitch?: CmuSwitch;
  /** Group id → last tldr post (ms). Default: a module-level map. */
  tldrThrottle?: Map<string, number>;
}

/** Used when no switch is wired: on, and `@bot off` lasts until a restart. */
const DEFAULT_SWITCH = memoryCmuSwitch();

export const CMU_COMMAND = 'catch me up';

/** P3: the interaction log's `command` field. Never carries the target id. */
export function commandLabel(cmd: CmuCommand): string {
  switch (cmd.kind) {
    case 'catchup': return CMU_COMMAND;
    case 'full': return 'full';
    case 'help': return 'help';
    case 'off': return 'off';
    case 'on': return 'on';
    case 'tldr': return 'tldr';
    case 'forget': return cmd.target === 'self' ? 'forget' : cmd.target === 'all' ? 'forget all' : 'forget @';
  }
}

/**
 * The interaction trace as used here: every call is swallowed, so a broken
 * log can never change what the requester gets. Steps carry no message text.
 */
export interface SafeTrace {
  step(name: string, f: { ok: boolean; ms?: number } & Record<string, string | number | boolean | string[] | null | undefined>): void;
  thumbPath(): string | undefined;
}

function safeCall<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

export function msSince(t0: number): number {
  return Math.round(performance.now() - t0);
}

function authorKind(author: string): 'lid' | 'c.us' | 'other' {
  if (author.endsWith('@lid')) return 'lid';
  if (author.endsWith('@c.us')) return 'c.us';
  return 'other';
}

/** Fallback topic ids from older `share-<id>.html` links; the link text itself is never kept. */
function topicIds(links: string[]): string[] {
  const ids: string[] = [];
  for (const l of links) for (const m of l.matchAll(/share-([A-Za-z0-9_-]+)\.html/g)) ids.push(m[1]);
  return ids;
}

type CmuResult =
  | { kind: 'card'; html: string; links: string[] }
  | { kind: 'quiet'; text: string };

type Outcome = 'card' | 'card-partial' | 'quiet' | 'limit' | 'failed' | 'unsupported';

/** Optional display fields companelist adds to a 200 (Task 1); absent on older versions. */
function parseMeta(data: unknown): { costUsd?: number; windowStart?: string; windowReason?: string; person?: string | null; topicIds?: string[] } {
  const m = data && typeof data === 'object' ? (data as Record<string, unknown>).meta : undefined;
  if (!m || typeof m !== 'object') return {};
  const r = m as Record<string, unknown>;
  return {
    costUsd: typeof r.costUsd === 'number' ? r.costUsd : undefined,
    windowStart: typeof r.windowStart === 'string' ? r.windowStart : undefined,
    windowReason: typeof r.windowReason === 'string' ? r.windowReason : undefined,
    person: typeof r.person === 'string' || r.person === null ? (r.person as string | null) : undefined,
    topicIds: Array.isArray(r.topicIds) && r.topicIds.every((t) => typeof t === 'string') ? (r.topicIds as string[]) : undefined,
  };
}

/** The 429 body's `gate`, when companelist sends one. */
function parseGate(data: unknown): 'limit' | 'busy' | undefined {
  const g = data && typeof data === 'object' ? (data as Record<string, unknown>).gate : undefined;
  return g === 'limit' || g === 'busy' ? g : undefined;
}

class CmuDeadlineError extends Error {
  constructor() {
    super('deadline');
    this.name = 'Deadline';
  }
}

/** Resolve/reject with `work`, or reject with CmuDeadlineError after `ms`. */
export function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_res, rej) => {
    timer = setTimeout(() => rej(new CmuDeadlineError()), ms);
  });
  return Promise.race([work, expired]).finally(() => clearTimeout(timer));
}

export class CmuHttpError extends Error {
  constructor(readonly status: number) {
    super(`http ${status}`);
  }
}

function parseResult(data: unknown): CmuResult | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d.kind === 'card' && typeof d.html === 'string' && Array.isArray(d.links)
      && d.links.every((l) => typeof l === 'string')) {
    return { kind: 'card', html: d.html, links: d.links as string[] };
  }
  if (d.kind === 'quiet' && typeof d.text === 'string') return { kind: 'quiet', text: d.text };
  return null;
}

/** Redacted error summary: a class of failure, never a message body. */
export function describeError(err: unknown): string {
  if (err instanceof CmuHttpError) return err.message;
  if (err instanceof Error) return err.name;
  return 'error';
}

export async function resolveNotifyName(msg: CmuMessage): Promise<{ name: string; source: 'payload' | 'contact' | 'none' }> {
  if (msg.notifyName) return { name: msg.notifyName, source: 'payload' };
  try {
    const name = (await msg.getContact()).pushname || '';
    return { name, source: name ? 'contact' : 'none' };
  } catch {
    return { name: '', source: 'none' }; // companelist treats an unknown name as "last 24h" (C6)
  }
}

/** The requester's stable WhatsApp id (LID when known): companelist's limits key. Never logged. */
export async function resolveRequesterKey(msg: CmuMessage, deps: CmuDeps): Promise<string> {
  return resolveKey(msg.author, deps);
}

/** `id` as the limits key companelist hashes: its dmTarget (LID) when known, else `id`. */
export async function resolveKey(id: string, deps: CmuDeps): Promise<string> {
  if (!deps.dmTarget) return id;
  try {
    return (await deps.dmTarget(id)) || id;
  } catch {
    return id;
  }
}

/** The owner check's own bound (it is a LID lookup at most). */
export const CMU_OWNER_TIMEOUT_MS = 15_000;

/** M4, bounded: the owner check never hangs a request, and any failure means "not the owner". */
export async function checkOwner(msg: CmuMessage, deps: CmuDeps, trace: SafeTrace | null): Promise<boolean> {
  const t0 = performance.now();
  let owner = false;
  try {
    owner = deps.isOwner ? (await withDeadline(deps.isOwner(msg.author), CMU_OWNER_TIMEOUT_MS)) === true : false;
  } catch {
    owner = false;
  }
  trace?.step('owner', { ok: owner, ms: msSince(t0) });
  return owner;
}

export async function react(msg: CmuMessage, emoji: string, deps: CmuDeps, trace: SafeTrace): Promise<void> {
  const t0 = performance.now();
  let ok = true;
  try {
    await msg.react?.(emoji);
  } catch (err) {
    ok = false;
    deps.log(`[cmu] react failed in ${msg.from}: ${describeError(err)}`);
  }
  trace.step('react', { ok, ms: msSince(t0), emoji });
}

export async function runCatchMeUp(msg: CmuMessage, deps: CmuDeps, cmd: CmuCommand = { kind: 'catchup' }): Promise<void> {
  const group = msg.from;
  const raw = safeCall(() => deps.trace?.()) ?? NOOP_TRACE;
  const trace: SafeTrace = {
    step: (name, f) => void safeCall(() => raw.step(name, f)),
    thumbPath: () => safeCall(() => raw.thumbPath()) || undefined,
  };
  const start = (who: string) => safeCall(() => raw.start({
    group,
    groupName: msg.chatName,
    instance: deps.groups.get(group),
    who,
    authorKind: authorKind(msg.author ?? ''),
    command: commandLabel(cmd),
  }));

  if (!deps.groups.has(group)) {
    start(msg.notifyName ?? '');
    trace.step('trigger', { ok: true, mapped: false });
    safeCall(() => raw.end('unsupported'));
    deps.log(`[cmu] unsupported group ${group}; ignored`);
    return;
  }
  // The author is the only DM target: never DM a group, or the chat the request came from.
  if (!msg.author || msg.author.endsWith('@g.us') || msg.author === msg.from) {
    deps.log(`[cmu] no DM target in ${group}; ignored`);
    return;
  }

  // `who` is the payload name; a getContact() fallback runs later, inside the
  // deadline, so it can never hold up the 👍 (C3) or the outcome (I14).
  start(msg.notifyName ?? '');
  const cmuSwitch = deps.cmuSwitch ?? DEFAULT_SWITCH;
  // K4: while off, every command but the owner's off/on is swallowed: no reaction, DM, post or fetch.
  if (cmd.kind !== 'off' && cmd.kind !== 'on' && safeCall(() => cmuSwitch.isEnabled()) === false) {
    safeCall(() => raw.end('disabled'));
    deps.log(`[cmu] disabled in ${group}`);
    return;
  }
  // M3: an owner command from anyone else gets nothing at all, and is not passed on.
  const ownerOnly = cmd.kind === 'full' || cmd.kind === 'forget' || cmd.kind === 'off' || cmd.kind === 'on' || cmd.kind === 'tldr';
  if (ownerOnly && !(await checkOwner(msg, deps, trace))) {
    safeCall(() => raw.end('not-allowed'));
    deps.log(`[cmu] not-allowed in ${group}`);
    return;
  }
  trace.step('trigger', { ok: true, mapped: true });

  const end = (outcome: string, error?: string) => void safeCall(() => raw.end(outcome, error ? { error } : undefined));
  if (cmd.kind === 'help') return runHelp(msg, deps, trace, end);
  if (cmd.kind === 'off' || cmd.kind === 'on') return runSwitch(msg, deps, cmuSwitch, cmd.kind === 'on', trace, end);
  if (cmd.kind === 'tldr') return runTldr(msg, deps, trace, end);
  if (cmd.kind === 'forget') return runForget(msg, deps, cmd.target, trace, end);

  let outcome: Outcome = 'failed';
  let error: string | undefined;
  try {
    await react(msg, '👍', deps, trace);

    // Set once the image DM lands. After that the requester has their catch-up,
    // so a failed or hung links DM is logged, never answered with "Couldn't build".
    const state = { imageSent: false, pngPath: null as string | null };
    try {
      outcome = await withDeadline(deliver(msg, deps, state, trace, cmd.kind === 'full'), deps.deadlineMs ?? CMU_DEADLINE_MS);
    } catch (err) {
      if (state.imageSent) {
        outcome = 'card-partial';
        deps.log(`[cmu] image sent, links failed in ${group}: ${describeError(err)}`);
        return;
      }
      outcome = 'failed';
      error = describeError(err);
      deps.log(`[cmu] failed in ${group}: ${error}`);
      const t0 = performance.now();
      try {
        await withDeadline(
          deps.sendText(msg.author, CMU_FAILURE_TEXT),
          deps.failureDmTimeoutMs ?? CMU_FAILURE_DM_TIMEOUT_MS,
        );
        trace.step('failure-dm', { ok: true, ms: msSince(t0) });
      } catch (dmErr) {
        trace.step('failure-dm', { ok: false, ms: msSince(t0) });
        deps.log(`[cmu] failure DM failed in ${group}: ${describeError(dmErr)}`);
      }
    } finally {
      // deliver() deletes the PNG itself; this covers a deadline that fired
      // while a screenshot or send was still hanging.
      if (state.pngPath) await rm(state.pngPath, { force: true }).catch(() => undefined);
    }
  } finally {
    safeCall(() => raw.end(outcome, error ? { error } : undefined));
  }
}

async function deliver(
  msg: CmuMessage,
  deps: CmuDeps,
  state: { imageSent: boolean; pngPath: string | null },
  trace: SafeTrace,
  full = false,
): Promise<'card' | 'quiet' | 'limit'> {
  const group = msg.from;
  const nameT0 = performance.now();
  const { name: notifyName, source } = await resolveNotifyName(msg);
  // A display name may be stored (I6); only the contact fallback adds one here, since `start` lacked it.
  trace.step('name', { ok: source !== 'none', ms: msSince(nameT0), source, who: source === 'contact' ? notifyName : undefined });
  const requesterKey = await resolveRequesterKey(msg, deps);
  const league = deps.groups.get(group);

  const fetchT0 = performance.now();
  let status: number | undefined;
  let data: unknown;
  let result: CmuResult | null = null;
  try {
    const res = await deps.fetchFn(deps.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${deps.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ notifyName, requestAt: msg.capturedAt, league, requesterKey, ...(full ? { mode: 'full' } : {}) }),
      signal: AbortSignal.timeout(CMU_TIMEOUT_MS),
    });
    status = res.status;
    if (res.status === 429) {
      data = await res.json().catch(() => undefined);
    } else {
      if (!res.ok) throw new CmuHttpError(res.status);
      data = await res.json();
      result = parseResult(data);
      if (!result) throw new Error('BadResponse');
    }
  } catch (err) {
    trace.step('companelist', { ok: false, ms: msSince(fetchT0), status });
    throw err;
  }

  if (status === 429) {
    trace.step('companelist', { ok: true, ms: msSince(fetchT0), status, result: 'limit' });
    trace.step('limit', { ok: true, gate: parseGate(data) });
    await react(msg, '⏳', deps, trace);
    deps.log(`[cmu] limit in ${group}`);
    return 'limit';
  }
  if (!result) throw new Error('BadResponse'); // unreachable: narrowed above
  const { topicIds: metaTopicIds, ...displayMeta } = parseMeta(data);
  trace.step('companelist', { ok: true, ms: msSince(fetchT0), status, result: result.kind, ...displayMeta });

  if (result.kind === 'quiet') {
    await timed(trace, 'quiet-dm', () => deps.sendText(msg.author, result.text));
    deps.log(`[cmu] quiet sent in ${group}`);
    return 'quiet';
  }

  const card = result;
  const pngPath = path.join(os.tmpdir(), `cmu-${randomUUID()}.png`);
  state.pngPath = pngPath;
  try {
    const thumbPath = trace.thumbPath();
    const shotT0 = performance.now();
    let shot: { thumbBytes?: number } | void;
    try {
      shot = thumbPath ? await deps.screenshot(card.html, pngPath, thumbPath) : await deps.screenshot(card.html, pngPath);
    } catch (err) {
      trace.step('screenshot', { ok: false, ms: msSince(shotT0) });
      throw err;
    }
    const shotMs = msSince(shotT0);
    const bytes = await stat(pngPath).then((st) => st.size, () => undefined);
    trace.step('screenshot', { ok: true, ms: shotMs, bytes });
    if (thumbPath) {
      const thumbBytes = shot && typeof shot.thumbBytes === 'number' ? shot.thumbBytes : undefined;
      trace.step('thumb', { ok: thumbBytes !== undefined, bytes: thumbBytes });
    }
    await timed(trace, 'image', () => deps.sendImage(msg.author, pngPath));
    state.imageSent = true;
    if (card.links.length) {
      await timed(trace, 'links', () => deps.sendText(msg.author, card.links.join('\n')), {
        count: card.links.length,
        topics: metaTopicIds ?? topicIds(card.links),
      });
    }
  } finally {
    await rm(pngPath, { force: true }).catch(() => undefined);
  }
  deps.log(`[cmu] card sent in ${group}`);
  return 'card';
}

/** Run one send as a traced step: ok + ms either way, rethrowing on failure. */
export async function timed(
  trace: SafeTrace,
  name: string,
  work: () => Promise<void>,
  extra: Record<string, number | string[]> = {},
): Promise<void> {
  const t0 = performance.now();
  try {
    await work();
  } catch (err) {
    trace.step(name, { ok: false, ms: msSince(t0), ...extra });
    throw err;
  }
  trace.step(name, { ok: true, ms: msSince(t0), ...extra });
}
