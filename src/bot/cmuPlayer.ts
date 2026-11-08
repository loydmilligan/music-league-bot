import { performance } from 'node:perf_hooks';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { CmuCommand } from './cmuCommand.js';
import {
  CMU_ACK_EMOJI,
  CMU_DEADLINE_MS,
  CMU_FAILURE_DM_TIMEOUT_MS,
  CMU_WAIT_EMOJI,
  CmuHttpError,
  describeError,
  framing,
  msSince,
  react,
  resolveNotifyName,
  resolveRequesterKey,
  timed,
  withDeadline,
  type CmuDeps,
  type CmuMessage,
  type SafeTrace,
} from './catchMeUp.js';
import { CMU_COMMAND_TIMEOUT_MS } from './cmuFlows.js';
import { isRecapKind, runRecapCommand } from './recapSubs.js';
import { followUpText, recapFact } from './cmuFollowUp.js';
import { menuHeading, playerMenu } from './cmuMenu.js';
import { FOOTER_PLAYER, FOOTER_RECAP, FOOTER_RETRY, MESSAGE_NAMES, frameMessage } from './messageFrame.js';

/**
 * Player command flows (R5, R7, R8, L9/L9a, W1, W3, W4): top lists, pick one, list/show topics and the
 * dossier. DM only, so every DM goes to msg.author and every companelist body carries via "dm".
 * No response text, URL or id reaches the trace or the log.
 */

export type PlayerCmd = Exclude<CmuCommand, { kind: 'catchup' | 'full' | 'forget' | 'help' | 'off' | 'on' | 'tldr' | 'recap' }>;

/** R7: one run per person per command per minute. */
export const PLAYER_COOLDOWN_MS = 60_000;
/** L6 + L9a: at most 3 pictures, and the text makes 4 DMs. */
export const PLAYER_MAX_IMAGES = 3;
/** W4, verbatim. */
export const PLAYER_FAILURE_TEXT = "Couldn't get that just now. Try again in a minute.";

const PLAYER_THROTTLE = new Map<string, number>();

type End = (outcome: string, error?: string) => void;

export function isPlayerKind(cmd: CmuCommand): cmd is PlayerCmd {
  switch (cmd.kind) {
    case 'top': case 'pick': case 'topics': case 'topic': case 'dossier':
    case 'recap-sub': case 'recap-unsub': case 'recap-time': case 'recap-time-bad':
    case 'recap7':
      return true;
    default:
      return false;
  }
}

interface PlayerImage { caption?: string; jpegB64: string }
interface PlayerReply { text: string; images: PlayerImage[] }

/** V5: the recap7 body when companelist has no stats lines for the person. */
export const RECAP7_NO_STATS_TEXT = 'No stats for you in the last 7 days yet.';

const TOP_NAMES = {
  songs: MESSAGE_NAMES.topSongs, pics: MESSAGE_NAMES.topPics, videos: MESSAGE_NAMES.topVideos,
  links: MESSAGE_NAMES.topLinks, media: MESSAGE_NAMES.topMedia,
} as const;

/** F7: the frame name per player kind (recap-* kinds have their own flow). */
function playerName(cmd: PlayerCmd): string {
  switch (cmd.kind) {
    case 'top': return TOP_NAMES[cmd.list];
    case 'pick': return MESSAGE_NAMES.pickOne;
    case 'topics': return MESSAGE_NAMES.topics;
    case 'topic': return MESSAGE_NAMES.topic(cmd.n);
    case 'recap7': return MESSAGE_NAMES.recap;
    case 'dossier': return MESSAGE_NAMES.dossier;
    default: return MESSAGE_NAMES.morningBriefSettings;
  }
}

/** The empty cases: the reply says there was nothing to show. */
const isEmptyReply = (text: string): boolean => text.startsWith('Dead chat.') || text.startsWith('You were in every');

function wireBody(cmd: PlayerCmd): Record<string, unknown> {
  switch (cmd.kind) {
    case 'top': return { mode: 'top', list: cmd.list, days: cmd.days };
    case 'pick': return { mode: 'pick' };
    case 'topics': return { mode: 'topics' };
    case 'topic': return { mode: 'topic', n: cmd.n };
    case 'recap7': return { mode: 'followup' };
    default: return { mode: 'dossier' };
  }
}

/** R2: `{ kind: "followup", lines: string[] }`, else BadResponse. */
function parseFollowUpLines(data: unknown): string[] {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  if (d.kind !== 'followup' || !Array.isArray(d.lines) || !d.lines.every((l) => typeof l === 'string')) throw new Error('BadResponse');
  return d.lines as string[];
}

function parseReply(cmd: PlayerCmd, data: unknown): PlayerReply {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const expected = cmd.kind;
  if (d.kind !== expected || typeof d.text !== 'string' || !d.text.trim()) throw new Error('BadResponse');
  const images: PlayerImage[] = [];
  if (expected === 'top' && Array.isArray(d.images)) {
    for (const i of d.images) {
      const o = (i && typeof i === 'object' ? i : {}) as Record<string, unknown>;
      if (typeof o.jpegB64 === 'string' && o.jpegB64) {
        images.push({ jpegB64: o.jpegB64, caption: typeof o.caption === 'string' && o.caption ? o.caption : undefined });
      }
    }
  }
  return { text: d.text, images: images.slice(0, PLAYER_MAX_IMAGES) };
}

export async function runPlayer(msg: CmuMessage, deps: CmuDeps, cmd: PlayerCmd, trace: SafeTrace, end: End): Promise<void> {
  // Recap subscription commands have their own flow (M2/M3): no player cooldown, no companelist call.
  if (isRecapKind(cmd)) return runRecapCommand(msg, deps, cmd, trace, end);
  // K4: while the owner's switch is off, nothing at all.
  let enabled = true;
  try {
    enabled = deps.cmuSwitch?.isEnabled() !== false;
  } catch {
    enabled = true;
  }
  if (!enabled) {
    end('disabled');
    return;
  }

  const throttle = deps.playerThrottle ?? PLAYER_THROTTLE;
  const now = (deps.now ?? Date.now)();
  const key = `${msg.author}|${cmd.kind === 'top' ? `top:${cmd.list}` : cmd.kind === 'topic' ? `topic:${cmd.n}` : cmd.kind}`;
  const last = throttle.get(key);
  if (last !== undefined && now - last < PLAYER_COOLDOWN_MS) {
    await react(msg, CMU_WAIT_EMOJI, deps, trace);
    end('throttled');
    return;
  }
  for (const [k, at] of throttle) if (now - at >= PLAYER_COOLDOWN_MS) throttle.delete(k);
  throttle.set(key, now);

  let outcome = 'failed';
  let error: string | undefined;
  const state: DeliverState = { textSent: false, dir: null, aborted: false };
  // Sprint 4: DM replies frame behind the person gate (the DM router sets previewPerson) plus format.
  const frame = framing(deps, msg.from, msg.previewPerson === true);
  try {
    await react(msg, CMU_ACK_EMOJI, deps, trace);
    try {
      outcome = await withDeadline(deliverPlayer(msg, deps, cmd, trace, state, frame), deps.deadlineMs ?? CMU_DEADLINE_MS);
    } catch (err) {
      state.aborted = true;
      if (state.textSent) {
        // The requester has their answer; a failed image or a late deadline never earns a failure DM.
        outcome = 'sent';
        deps.log(`[cmu] player ${cmd.kind} partly sent in ${msg.from}: ${describeError(err)}`);
        return;
      }
      outcome = 'failed';
      error = describeError(err);
      deps.log(`[cmu] player ${cmd.kind} failed in ${msg.from}: ${error}`);
      const t0 = performance.now();
      try {
        const failure = frame
          ? frameMessage({ name: playerName(cmd), body: PLAYER_FAILURE_TEXT, footer: FOOTER_RETRY })
          : PLAYER_FAILURE_TEXT;
        await withDeadline(deps.sendText(msg.author, failure), deps.failureDmTimeoutMs ?? CMU_FAILURE_DM_TIMEOUT_MS);
        trace.step('failure-dm', { ok: true, ms: msSince(t0) });
      } catch (dmErr) {
        trace.step('failure-dm', { ok: false, ms: msSince(t0) });
        deps.log(`[cmu] failure DM failed in ${msg.from}: ${describeError(dmErr)}`);
      }
    } finally {
      if (state.dir) await rm(state.dir, { recursive: true, force: true }).catch(() => undefined);
    }
  } finally {
    end(outcome, error);
  }
}

interface DeliverState { textSent: boolean; dir: string | null; aborted: boolean }

async function deliverPlayer(
  msg: CmuMessage,
  deps: CmuDeps,
  cmd: PlayerCmd,
  trace: SafeTrace,
  state: DeliverState,
  frame: boolean,
): Promise<string> {
  try {
    return await deliverInner(msg, deps, cmd, trace, state, frame);
  } finally {
    if (state.dir) await rm(state.dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function deliverInner(
  msg: CmuMessage,
  deps: CmuDeps,
  cmd: PlayerCmd,
  trace: SafeTrace,
  state: DeliverState,
  frame: boolean,
): Promise<string> {
  const { name: notifyName } = await resolveNotifyName(msg);
  const requesterKey = await resolveRequesterKey(msg, deps);
  const body = {
    notifyName,
    requestAt: msg.capturedAt,
    league: deps.groups.get(msg.from),
    requesterKey,
    ...wireBody(cmd),
    via: 'dm',
  };

  const t0 = performance.now();
  if (cmd.kind === 'recap7') return deliverRecap7(msg, deps, body, requesterKey, trace, state, frame, t0);
  let reply: PlayerReply;
  try {
    const res = await deps.fetchFn(deps.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${deps.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(CMU_COMMAND_TIMEOUT_MS),
    });
    if (!res.ok) throw new CmuHttpError(res.status);
    reply = parseReply(cmd, await res.json());
  } catch (err) {
    trace.step('companelist', { ok: false, ms: msSince(t0), status: err instanceof CmuHttpError ? err.status : undefined });
    throw err;
  }
  trace.step('companelist', { ok: true, ms: msSince(t0), status: 200, images: reply.images.length });

  if (state.aborted) throw new Error('Aborted');
  // In flight counts as sent: a deadline that fires mid-send must not add a failure DM after the text.
  state.textSent = true;
  // Framed text, but the empty check below reads the unframed reply.text (review focus 2).
  const text = frame
    ? frameMessage({
      name: playerName(cmd),
      facts: cmd.kind === 'top' ? [cmd.days === 7 ? 'last 7 days' : 'last 48 h'] : [],
      body: reply.text,
      footer: FOOTER_PLAYER,
    })
    : reply.text;
  try {
    await timed(trace, 'text-dm', () => deps.sendText(msg.author, text));
  } catch (err) {
    state.textSent = false;
    throw err;
  }

  if (reply.images.length > 0) {
    if (state.aborted) throw new Error('Aborted');
    state.dir = await mkdtemp(path.join(os.tmpdir(), 'cmu-player-'));
    for (const [i, img] of reply.images.entries()) {
      if (state.aborted) throw new Error('Aborted');
      const file = path.join(state.dir, `${i}.jpg`);
      await writeFile(file, Buffer.from(img.jpegB64, 'base64'));
      await timed(trace, 'image', () => deps.sendImage(msg.author, file, img.caption), { caption: !!img.caption });
    }
  }
  return isEmptyReply(reply.text) ? 'empty' : 'sent';
}

/** R1-R3: the Recap on demand. companelist's followup mode has no side effects; the bot assembles the body. */
async function deliverRecap7(
  msg: CmuMessage,
  deps: CmuDeps,
  body: Record<string, unknown>,
  requesterKey: string,
  trace: SafeTrace,
  state: DeliverState,
  frame: boolean,
  t0: number,
): Promise<string> {
  let lines: string[];
  try {
    const res = await deps.fetchFn(deps.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${deps.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(CMU_COMMAND_TIMEOUT_MS),
    });
    if (!res.ok) throw new CmuHttpError(res.status);
    lines = parseFollowUpLines(await res.json());
  } catch (err) {
    trace.step('companelist', { ok: false, ms: msSince(t0), status: err instanceof CmuHttpError ? err.status : undefined });
    throw err;
  }
  trace.step('companelist', { ok: true, ms: msSince(t0), status: 200, stats: lines.length > 0 });

  let text = RECAP7_NO_STATS_TEXT;
  if (lines.length > 0) {
    let dmOk = msg.previewPerson === true;
    try {
      dmOk = dmOk || deps.preview?.isPreviewPerson(requesterKey) === true;
    } catch { /* keep */ }
    let sub;
    try {
      sub = dmOk ? deps.recapSubscription?.(requesterKey) : undefined;
    } catch {
      sub = undefined;
    }
    text = followUpText({ lines, sub, heading: menuHeading(dmOk), menu: playerMenu(dmOk), ...(frame ? { briefWords: true } : {}) });
  }
  if (frame) text = frameMessage({ name: MESSAGE_NAMES.recap, facts: [recapFact(msg.capturedAt)], body: text, footer: FOOTER_RECAP });

  if (state.aborted) throw new Error('Aborted');
  state.textSent = true;
  try {
    await timed(trace, 'text-dm', () => deps.sendText(msg.author, text));
  } catch (err) {
    state.textSent = false;
    throw err;
  }
  return 'recap7';
}
