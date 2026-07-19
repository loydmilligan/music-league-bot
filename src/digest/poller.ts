/**
 * Polls bot-ui for digests that are ready to post.
 *
 * Lives in the bot container because that is where the authenticated WhatsApp
 * client is. Everything it knows comes from bot-ui over HTTP — the bot cannot
 * import $lib, and only one process may hold the LocalAuth session.
 *
 * A poll rather than a cron: the round-end trigger falls out of the resolver
 * (which keys on voting_deadline) plus the claim (which makes a repeat a no-op),
 * so no cron dependency is needed. It also matches the existing setInterval
 * shape used by the email poller and the ML auth heartbeat.
 *
 * Deliberately NOT firing an immediate pass on startup, unlike those two. For a
 * 3-minute poller a restart-time tick is free; for a send it is a way to post at
 * an unexpected moment on every deploy. It waits a full interval first.
 */
import { runDigestTick, type AutoPostDeps, type ScheduleEntry } from './autoPost.js';
import { parseTargets, type SendGuardEnv } from '../whatsapp/sendGuard.js';

const DEFAULT_POLL_MS = 60 * 60 * 1000; // hourly

interface PollerOpts {
  baseUrl: string;
  send: (target: string, text: string) => Promise<void>;
  notifyOwner: (msg: string) => Promise<void>;
}

async function post(baseUrl: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text().catch(() => '')}`);
  return res.json();
}

export function makeDeps(opts: PollerOpts): AutoPostDeps {
  const env: SendGuardEnv = {
    mode: process.env.DIGEST_SEND_MODE,
    targets: parseTargets(process.env.DIGEST_SEND_TARGETS),
  };

  // Best-effort alert to bot-ui's notify() dispatch. Never throws — a failure
  // here must never affect the actual digest send/poll path, only get logged.
  async function raise(alertType: string, title: string, message: string): Promise<void> {
    try {
      await fetch(`${opts.baseUrl}/api/notify`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ alertType, title, message }),
      });
    } catch (e) { console.error('[autopost] /api/notify failed:', e instanceof Error ? e.message : e); }
  }

  return {
    env,
    fetchSchedule: async () => {
      const res = await fetch(`${opts.baseUrl}/api/digest/schedule`);
      if (!res.ok) throw new Error(`schedule → ${res.status}`);
      return ((await res.json()) as { entries: ScheduleEntry[] }).entries;
    },
    claimAndExport: async (roundId) =>
      (await post(opts.baseUrl, `/api/digest/${roundId}/send-claim`)) as {
        claimed: boolean;
        url?: string;
      },
    send: opts.send,
    confirm: async (roundId, target, url) => {
      await post(opts.baseUrl, `/api/digest/${roundId}/send-confirm`, { target, url });
      await raise('digest_sent', 'Digest sent', `round ${roundId} → ${target}\n${url}`);
    },
    fail: async (roundId, error) => {
      await post(opts.baseUrl, `/api/digest/${roundId}/send-failed`, { error });
    },
    log: (msg) => console.log(msg),
    notifyOwner: (msg) => raise('pipeline_failure', '⚠ digest send', msg),
  };
}

export interface PollerHandle {
  timer: NodeJS.Timeout;
  /** Run one scheduled tick now (used by the control server's /trigger). */
  runOnce: () => Promise<void>;
}

export function startDigestPoller(opts: PollerOpts): PollerHandle {
  const ms = Number(process.env.DIGEST_POLL_MS) || DEFAULT_POLL_MS;
  const deps = makeDeps(opts);

  const mode = process.env.DIGEST_SEND_MODE ?? 'dry-run';
  const configured = Object.keys(deps.env.targets ?? {});
  console.log(
    `[autopost] poller every ${Math.round(ms / 1000)}s · mode=${mode} · targets=${
      configured.length ? configured.join(',') : 'none (nothing can send)'
    }`,
  );

  const runOnce = () => runDigestTick(deps);
  const timer = setInterval(() => {
    void runOnce().catch((err) => console.error('[autopost] tick threw:', err));
  }, ms);
  timer.unref?.();
  return { timer, runOnce };
}
