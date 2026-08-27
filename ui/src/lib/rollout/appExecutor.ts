/**
 * The bot-ui half of the rollout. Runs `app` cuts — the ones that reuse the
 * live HTTP endpoints the digest runner already drives — and promotes pending
 * digest jobs into rollout runs for rollout-enabled leagues.
 *
 * DEGENERATE SAFETY: a league without an enabled rollout config is never
 * touched here. Its digest_jobs row stays `pending` and runOneJob handles it
 * exactly as before.
 */
import type Database from 'better-sqlite3';
import {
  getRolloutConfig, createRun, loadRun, loadRunByRound, saveRun,
  claimCut, heartbeat, reapStaleCuts, hasActiveRun, hostRawResults,
} from './store.js';
import { advance, applyCutResult, claimable } from './engine.js';
import { parkAtHold, type HoldDeps } from './holds.js';
import { modelForCut } from './modelForCut.js';
import type { Rollout, RunState } from './types.js';

/**
 * Resolve each agent cut's model into the run snapshot (I9), so the host
 * executor keeps reading a plain `model` string. An explicit model in the
 * league config wins; the stored config itself is never mutated.
 */
function resolveAgentModels(db: Database.Database, rollout: Rollout): Rollout {
  const cuts: Rollout['cuts'] = {};
  for (const [cutId, def] of Object.entries(rollout.cuts)) {
    cuts[cutId] = def.kind === 'agent' && !def.model
      ? { ...def, model: modelForCut(cutId, db) }
      : def;
  }
  return { ...rollout, cuts };
}

/** Marker status parking a promoted job out of runOneJob's claim query. */
const PROMOTED = 'rollout';

export type AppCutDeps = {
  capture: (roundId: number) => Promise<void>;
  generate: (roundId: number) => Promise<void>;
  send: (roundId: number) => Promise<void>;
  archive: (roundId: number) => Promise<void>;
};

export type AppExecutorDeps = AppCutDeps & {
  db: Database.Database;
  hold: HoldDeps;
  now: () => string;
};

/**
 * Turn `pending` digest jobs into rollout runs, but only for leagues whose
 * rollout config is enabled. Returns how many were promoted.
 */
export function promotePendingJobs(db: Database.Database, nowIso: string): number {
  const rows = db.prepare(
    `SELECT round_id, league_id FROM digest_jobs WHERE status='pending' ORDER BY created_at`,
  ).all() as { round_id: number; league_id: number }[];

  let promoted = 0;
  for (const row of rows) {
    const cfg = getRolloutConfig(db, row.league_id);
    if (!cfg.enabled) continue;              // not ours — leave it for runOneJob
    if (hasActiveRun(db, row.league_id)) continue; // one active run per league
    // rollout_runs_round is UNIQUE — a round that already has ANY run (done,
    // failed, or otherwise) must never be promoted again, or createRun throws
    // on every future tick for a re-queued round (final review I6).
    if (loadRunByRound(db, row.round_id)) continue;
    createRun(db, row.league_id, row.round_id, resolveAgentModels(db, cfg.rollout), nowIso);
    db.prepare('UPDATE digest_jobs SET status=?, updated_at=? WHERE round_id=?')
      .run(PROMOTED, nowIso, row.round_id);
    promoted++;
  }
  return promoted;
}

type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) =>
  Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/**
 * The archive cut (final review I4): the old wiring POSTed
 * /api/digest/{roundId}/archive-refresh, a route that does not exist, so the
 * cut 404ed on every run. The real refresh is the league-scoped async content
 * update: POST /api/content/{leagueId}/update → 202 {jobId} → poll
 * /update-status/{jobId} until done.
 *
 * announce is 'silent' on purpose: the digest send already went out via the
 * send cut, and an automated cut must not post an extra chat card without a
 * hold in front of it. Announce by hand from the b-side UI if wanted.
 */
export async function archiveRefresh(
  db: Database.Database, base: string, roundId: number,
  fetchFn: FetchLike = fetch as unknown as FetchLike,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<void> {
  const row = db.prepare(
    'SELECT s.league_id FROM rounds r JOIN seasons s ON s.id=r.season_id WHERE r.id=?',
  ).get(roundId) as { league_id: number } | undefined;
  if (!row) throw new Error(`round ${roundId}: no league found for archive refresh`);

  const res = await fetchFn(`${base}/api/content/${row.league_id}/update`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ announce: 'silent' }),
  });
  if (res.status === 409) return; // nothing pending — an idempotent re-run
  if (!res.ok) throw new Error(`content update ${res.status}`);
  const { jobId } = await res.json() as { jobId: string };

  const deadline = Date.now() + 10 * 60_000;
  for (;;) {
    await sleep(5_000);
    const poll = await fetchFn(`${base}/api/content/${row.league_id}/update-status/${jobId}`);
    if (!poll.ok) throw new Error(`update-status ${poll.status}`);
    const body = await poll.json() as { status: string; error?: string };
    if (body.status === 'done') return;
    if (body.status === 'error') throw new Error(`archive refresh failed: ${body.error ?? 'unknown'}`);
    if (Date.now() > deadline) throw new Error('archive refresh timed out after 10m');
  }
}

async function runAppCut(
  deps: AppExecutorDeps, rollout: Rollout, run: RunState, cutId: string,
): Promise<{ exitCode: number; error?: string }> {
  const def = rollout.cuts[cutId];
  if (def.kind !== 'script') return { exitCode: 1, error: `cut "${cutId}" is not a script cut` };
  const verb = def.command[0];
  const fn = { capture: deps.capture, generate: deps.generate, send: deps.send, archive: deps.archive }[verb];
  if (!fn) return { exitCode: 1, error: `unknown app command "${verb}"` };
  try {
    await fn(run.roundId);
    return { exitCode: 0 };
  } catch (e) {
    return { exitCode: 1, error: e instanceof Error ? e.message : String(e) };
  }
}

/** One pass: promote, reap, run at most one app cut, then advance/park. */
export async function tickApp(deps: AppExecutorDeps): Promise<'idle' | 'worked'> {
  const { db, now } = deps;
  const nowIso = now();

  promotePendingJobs(db, nowIso);
  reapStaleCuts(db, nowIso);

  const open = db.prepare(
    `SELECT id FROM rollout_runs WHERE state IN ('running','parked') ORDER BY started_at`,
  ).all() as { id: string }[];

  let worked = false;
  for (const { id } of open) {
    let run = loadRun(db, id);
    if (!run) continue;
    const rollout = JSON.parse(
      (db.prepare('SELECT definition_json FROM rollout_runs WHERE id=?').get(id) as { definition_json: string }).definition_json,
    ) as Rollout;

    if (run.state === 'parked') {
      await parkAtHold(db, run, rollout, deps.hold); // idempotent: notifies once
      continue;
    }

    // Host cuts finished RAW — done/failed written directly by host_executor.py,
    // which knows nothing of checks, retries, or remasters. Fold each through
    // the same engine path an app cut takes before claiming anything else this
    // tick, so a check failure retries/remasters/forces a hold exactly as an
    // app cut's would (final review C2).
    for (const raw of hostRawResults(db, id, run.currentEp)) {
      run = applyCutResult(loadRun(db, id)!, rollout, raw.cutId, {
        exitCode: raw.exitCode, outputJson: raw.outputJson, error: raw.error,
      });
      saveRun(db, run, nowIso, [raw.cutId]);
      worked = true;
    }
    if (run.state === 'parked') {
      await parkAtHold(db, run, rollout, deps.hold);
      continue;
    }

    const ready = claimable(run, rollout, 'app');
    for (const cutId of ready) {
      if (!claimCut(db, id, cutId, nowIso)) continue;
      // Heartbeat while the cut runs (I5): a long generate can outlive the
      // 600s lease, and a later tick's reapStaleCuts would reclaim it mid-run.
      const beat = setInterval(() => heartbeat(db, id, cutId, now()), 60_000);
      beat.unref?.();
      let result;
      try {
        result = await runAppCut(deps, rollout, run, cutId);
      } finally {
        clearInterval(beat);
      }
      run = applyCutResult(loadRun(db, id)!, rollout, cutId, result);
      saveRun(db, run, nowIso);
      worked = true;
    }

    const advanced = advance(loadRun(db, id)!, rollout);
    saveRun(db, advanced, nowIso);
    if (advanced.state === 'parked') await parkAtHold(db, advanced, rollout, deps.hold);
  }
  return worked ? 'worked' : 'idle';
}

/**
 * Start the app-side rollout executor. Called once from hooks.server.ts,
 * next to startDigestRunner — the two coexist because a league is on exactly
 * one of the two paths.
 */
export function startRolloutAppExecutor(): void {
  const ms = Number(process.env.ROLLOUT_POLL_MS) || 60_000;
  console.log(`[rollout-app] starting (poll every ${ms}ms)`);
  // Ticks must not overlap: a tick awaiting a slow cut plus a second tick's
  // reapStaleCuts is exactly the lease-expiry double-run I5 guards against.
  let busy = false;
  const timer = setInterval(() => {
    if (busy) return;
    busy = true;
    void (async () => {
      const { getDb } = await import('$lib/db/client.js');
      const { notify } = await import('$lib/notifications/dispatch.js');
      const { captureRoundData } = await import('$lib/digest/capture.js');
      const base = process.env.BOT_UI_INTERNAL_URL ?? 'http://localhost:3002';
      const appBase = process.env.PUBLIC_APP_BASE_URL ?? 'https://mlb37.mattmariani.com';
      const post = async (roundId: number, path: string) => {
        const res = await fetch(`${base}/api/digest/${roundId}/${path}`, { method: 'POST' });
        if (!res.ok) throw new Error(`${path} ${res.status}`);
      };
      await tickApp({
        db: getDb(),
        capture: async (roundId) => { await captureRoundData(roundId); },
        generate: (roundId) => post(roundId, 'draft'),
        send: (roundId) => post(roundId, 'finalize'),
        archive: (roundId) => archiveRefresh(getDb(), base, roundId),
        hold: {
          notify: (payload) => notify(getDb(), payload, { botControlUrl: process.env.BOT_CONTROL_URL ?? 'http://bot:3003' }),
          now: () => new Date().toISOString(),
          appBase,
        },
        now: () => new Date().toISOString(),
      });
    })()
      .catch((e) => console.error('[rollout-app] tick threw', e))
      .finally(() => { busy = false; });
  }, ms);
  timer.unref?.();
}
