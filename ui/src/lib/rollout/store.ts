/**
 * All rollout SQL. The engine stays pure; this is the only module that knows
 * the tables exist.
 */
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { DEFAULT_ROLLOUT } from './defaults.js';
import { isValidRollout } from './validate.js';
import { initialCutRuns } from './engine.js';
import type { CutRunState, Rollout, RunState } from './types.js';

/** Default lease: a cut unheard-from for this long is presumed abandoned. */
const LEASE_SECONDS = 600;

/**
 * Never throws, never returns null — mirrors the pipeline-config contract.
 * A malformed or structurally invalid stored config degrades to the default,
 * DISABLED, so a bad edit can never start running something unexpected.
 */
export function getRolloutConfig(
  db: Database.Database, leagueId: number,
): { rollout: Rollout; enabled: boolean } {
  const row = db.prepare('SELECT definition_json, enabled FROM rollout_configs WHERE league_id=?')
    .get(leagueId) as { definition_json: string; enabled: number } | undefined;
  if (!row) return { rollout: DEFAULT_ROLLOUT, enabled: false };
  try {
    const parsed: unknown = JSON.parse(row.definition_json);
    if (!isValidRollout(parsed)) return { rollout: DEFAULT_ROLLOUT, enabled: false };
    return { rollout: parsed, enabled: row.enabled === 1 };
  } catch {
    return { rollout: DEFAULT_ROLLOUT, enabled: false };
  }
}

export function putRolloutConfig(
  db: Database.Database, leagueId: number, rollout: Rollout, enabled: boolean, nowIso: string,
): void {
  db.prepare(
    `INSERT INTO rollout_configs (league_id, definition_json, enabled, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(league_id) DO UPDATE SET
       definition_json=excluded.definition_json,
       enabled=excluded.enabled,
       updated_at=excluded.updated_at`,
  ).run(leagueId, JSON.stringify(rollout), enabled ? 1 : 0, nowIso);
}

/**
 * Create a run and its pending cut rows in one transaction.
 * The definition is SNAPSHOT into the run, so editing the league's config
 * never mutates a run already in flight.
 */
export function createRun(
  db: Database.Database, leagueId: number, roundId: number, rollout: Rollout, nowIso: string,
): string {
  const runId = randomUUID();
  const rows = initialCutRuns(rollout);
  db.transaction(() => {
    db.prepare(
      `INSERT INTO rollout_runs (id, league_id, round_id, definition_json, state, current_ep, started_at, updated_at)
       VALUES (?, ?, ?, ?, 'running', 0, ?, ?)`,
    ).run(runId, leagueId, roundId, JSON.stringify(rollout), nowIso, nowIso);
    const ins = db.prepare(
      `INSERT INTO rollout_cut_runs (run_id, cut_id, ep, runtime, state, attempts, remasters)
       VALUES (?, ?, ?, ?, 'pending', 0, 0)`,
    );
    for (const r of rows) ins.run(runId, r.cutId, r.ep, r.runtime);
  })();
  return runId;
}

function hydrate(
  run: { id: string; league_id: number; round_id: number; current_ep: number; state: string; error: string | null },
  cuts: Record<string, unknown>[],
): RunState {
  return {
    runId: run.id,
    leagueId: run.league_id,
    roundId: run.round_id,
    currentEp: run.current_ep,
    state: run.state as RunState['state'],
    error: run.error ?? undefined,
    cuts: cuts.map((c) => ({
      cutId: c.cut_id as string,
      ep: c.ep as number,
      runtime: (c.runtime as CutRunState['runtime']) ?? null,
      state: c.state as CutRunState['state'],
      attempts: c.attempts as number,
      remasters: c.remasters as number,
      checkPassed: c.check_passed === null || c.check_passed === undefined
        ? undefined : c.check_passed === 1,
      outputJson: (c.output_json as string | null) ?? undefined,
    })),
  };
}

export function loadRun(db: Database.Database, runId: string): RunState | null {
  const run = db.prepare('SELECT * FROM rollout_runs WHERE id=?').get(runId) as
    Parameters<typeof hydrate>[0] | undefined;
  if (!run) return null;
  const cuts = db.prepare('SELECT * FROM rollout_cut_runs WHERE run_id=? ORDER BY ep, cut_id')
    .all(runId) as Record<string, unknown>[];
  return hydrate(run, cuts);
}

export function loadRunByRound(db: Database.Database, roundId: number): RunState | null {
  const row = db.prepare('SELECT id FROM rollout_runs WHERE round_id=?').get(roundId) as
    { id: string } | undefined;
  return row ? loadRun(db, row.id) : null;
}

/**
 * Persist a whole RunState. Cheap enough at this size, and impossible to half-apply.
 *
 * A cut row the host executor finished AFTER this RunState was loaded
 * (`awaiting_classification=1`) is skipped, or a save from a stale in-memory
 * copy would revert it to pending and drop its output before the engine ever
 * classifies it (final review I8). The reclassification fold names the cuts it
 * just classified in `classifiedCutIds`; only those may overwrite such a row.
 */
export function saveRun(
  db: Database.Database, run: RunState, nowIso: string, classifiedCutIds: string[] = [],
): void {
  db.transaction(() => {
    db.prepare(
      `UPDATE rollout_runs SET current_ep=?, state=?, error=?, updated_at=?,
         finished_at = CASE WHEN ? IN ('done','failed') THEN ? ELSE finished_at END
       WHERE id=?`,
    ).run(run.currentEp, run.state, run.error ?? null, nowIso, run.state, nowIso, run.runId);
    const upd = db.prepare(
      `UPDATE rollout_cut_runs
          SET state=?, attempts=?, remasters=?, check_passed=?, output_json=?, awaiting_classification=0
        WHERE run_id=? AND cut_id=? AND (awaiting_classification=0 OR ?=1)`,
    );
    for (const c of run.cuts) {
      upd.run(
        c.state, c.attempts, c.remasters,
        c.checkPassed === undefined ? null : c.checkPassed ? 1 : 0,
        c.outputJson ?? null, run.runId, c.cutId,
        classifiedCutIds.includes(c.cutId) ? 1 : 0,
      );
    }
  })();
}

/** Atomic claim. Returns false if someone else got there first. */
export function claimCut(
  db: Database.Database, runId: string, cutId: string, nowIso: string,
): boolean {
  const res = db.prepare(
    `UPDATE rollout_cut_runs
        SET state='running', claimed_at=?, heartbeat_at=?, started_at=COALESCE(started_at, ?)
      WHERE run_id=? AND cut_id=? AND state='pending'`,
  ).run(nowIso, nowIso, nowIso, runId, cutId);
  return res.changes === 1;
}

export function heartbeat(
  db: Database.Database, runId: string, cutId: string, nowIso: string,
): void {
  db.prepare(`UPDATE rollout_cut_runs SET heartbeat_at=? WHERE run_id=? AND cut_id=? AND state='running'`)
    .run(nowIso, runId, cutId);
}

/**
 * Return cuts whose executor went away to `pending`, spending an attempt.
 * Without this the first host crash wedges a round forever.
 */
export function reapStaleCuts(
  db: Database.Database, nowIso: string, leaseSeconds = LEASE_SECONDS,
): number {
  const cutoff = new Date(new Date(nowIso).getTime() - leaseSeconds * 1000).toISOString();
  const res = db.prepare(
    `UPDATE rollout_cut_runs
        SET state='pending', attempts=attempts+1, claimed_at=NULL, heartbeat_at=NULL
      WHERE state='running' AND (heartbeat_at IS NULL OR heartbeat_at < ?)`,
  ).run(cutoff);
  return res.changes;
}

/**
 * One active run per league. A PARKED run counts as active — it still owns its
 * league — but a parked run in one league must never block another's.
 */
export function hasActiveRun(db: Database.Database, leagueId: number): boolean {
  const row = db.prepare(
    `SELECT COUNT(*) AS n FROM rollout_runs WHERE league_id=? AND state IN ('running','parked')`,
  ).get(leagueId) as { n: number };
  return row.n > 0;
}

export type HostRawResult = { cutId: string; exitCode: number; outputJson?: string; error?: string };

/**
 * Host-runtime cuts in the run's current EP that the host executor finished
 * RAW — written `done`/`failed` directly, with `awaiting_classification=1` —
 * but which have not yet passed through the engine's check/retry/remaster
 * logic (final review C2: the host has no notion of checks or budgets).
 */
export function hostRawResults(db: Database.Database, runId: string, ep: number): HostRawResult[] {
  const rows = db.prepare(
    `SELECT cut_id, state, output_json, error FROM rollout_cut_runs
      WHERE run_id=? AND ep=? AND runtime='host' AND awaiting_classification=1`,
  ).all(runId, ep) as { cut_id: string; state: string; output_json: string | null; error: string | null }[];
  return rows.map((r) => ({
    cutId: r.cut_id,
    exitCode: r.state === 'done' ? 0 : 1,
    outputJson: r.output_json ?? undefined,
    error: r.error ?? undefined,
  }));
}
