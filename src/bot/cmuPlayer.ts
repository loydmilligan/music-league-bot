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
      return true;
    default:
      return false;
  }
}

interface PlayerImage { caption?: string; jpegB64: string }
interface PlayerReply { text: string; images: PlayerImage[] }

/** The empty cases: the reply says there was nothing to show. */
const isEmptyReply = (text: string): boolean => text.startsWith('Dead chat.') || text.startsWith('You were in every');

function wireBody(cmd: PlayerCmd): Record<string, unknown> {
  switch (cmd.kind) {
    case 'top': return { mode: 'top', list: cmd.list, days: cmd.days };
    case 'pick': return { mode: 'pick' };
    case 'topics': return { mode: 'topics' };
    case 'topic': return { mode: 'topic', n: cmd.n };
    default: return { mode: 'dossier' };
  }
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
  // Recap subscription commands belong to the recap flow (Task 12).
  if (cmd.kind === 'recap-sub' || cmd.kind === 'recap-unsub' || cmd.kind === 'recap-time' || cmd.kind === 'recap-time-bad') {
    end('unsupported');
    return;
  }
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
  const key = `${msg.author}|${cmd.kind}`;
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
  const state = { textSent: false, dir: null as string | null };
  try {
    await react(msg, CMU_ACK_EMOJI, deps, trace);
    try {
      outcome = await withDeadline(deliverPlayer(msg, deps, cmd, trace, state), deps.deadlineMs ?? CMU_DEADLINE_MS);
    } catch (err) {
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
        await withDeadline(deps.sendText(msg.author, PLAYER_FAILURE_TEXT), deps.failureDmTimeoutMs ?? CMU_FAILURE_DM_TIMEOUT_MS);
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

async function deliverPlayer(
  msg: CmuMessage,
  deps: CmuDeps,
  cmd: PlayerCmd,
  trace: SafeTrace,
  state: { textSent: boolean; dir: string | null },
): Promise<string> {
  const { name: notifyName } = await resolveNotifyName(msg);
  const body = {
    notifyName,
    requestAt: msg.capturedAt,
    league: deps.groups.get(msg.from),
    requesterKey: await resolveRequesterKey(msg, deps),
    ...wireBody(cmd),
    via: 'dm',
  };

  const t0 = performance.now();
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

  await timed(trace, 'text-dm', () => deps.sendText(msg.author, reply.text));
  state.textSent = true;

  if (reply.images.length > 0) {
    state.dir = await mkdtemp(path.join(os.tmpdir(), 'cmu-player-'));
    for (const [i, img] of reply.images.entries()) {
      const file = path.join(state.dir, `${i}.jpg`);
      await writeFile(file, Buffer.from(img.jpegB64, 'base64'));
      await timed(trace, 'image', () => deps.sendImage(msg.author, file, img.caption), { caption: !!img.caption });
    }
  }
  return isEmptyReply(reply.text) ? 'empty' : 'sent';
}
