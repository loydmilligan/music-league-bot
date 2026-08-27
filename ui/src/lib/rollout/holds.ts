/**
 * Holds: park a run for a human, notify, and lift on their action.
 *
 * This is the existing digest approval gate generalized from one hold to N.
 * The token pattern is approvals.ts verbatim and the notification goes through
 * the existing notify() dispatch, so a hold routes to ntfy and WhatsApp using
 * the settings grid already in place.
 */
import type Database from 'better-sqlite3';
import { generateApprovalToken } from '$lib/digest/approvals.js';
import type { AlertPayload } from '$lib/notifications/channels/types.js';
import { loadRun, saveRun } from './store.js';
import type { Rollout, RunState } from './types.js';

export type HoldDeps = {
  notify: (payload: AlertPayload) => Promise<unknown>;
  now: () => string;
  appBase: string;
};

function names(db: Database.Database, run: RunState): { league: string; round: string } {
  const l = db.prepare('SELECT name FROM leagues WHERE id=?').get(run.leagueId) as { name?: string } | undefined;
  const r = db.prepare('SELECT name FROM rounds WHERE id=?').get(run.roundId) as { name?: string } | undefined;
  return { league: l?.name ?? `League ${run.leagueId}`, round: r?.name ?? `Round ${run.roundId}` };
}

/** The human cut the run is parked on, if any. */
function holdCut(run: RunState, rollout: Rollout): string | null {
  const c = run.cuts.find((x) => x.ep === run.currentEp && x.runtime === null && x.state === 'pending');
  return c && rollout.cuts[c.cutId]?.kind === 'human' ? c.cutId : null;
}

/**
 * Mint a resume token, store the review url, and notify — once.
 *
 * Idempotent: a run that already has a resume_token is already announced, so a
 * second executor tick does not push a duplicate.
 */
export async function parkAtHold(
  db: Database.Database, run: RunState, rollout: Rollout, deps: HoldDeps,
): Promise<RunState> {
  const existing = db.prepare('SELECT resume_token FROM rollout_runs WHERE id=?')
    .get(run.runId) as { resume_token: string | null } | undefined;
  if (existing?.resume_token) return run;

  const cutId = holdCut(run, rollout);
  const def = cutId ? rollout.cuts[cutId] : undefined;
  const label = def && def.kind === 'human' ? def.label : 'Review required';
  const path = def && def.kind === 'human' ? def.reviewPath : `/digest/${run.roundId}`;
  const alertType = def && def.kind === 'human' ? def.alertType : 'digest_ready';

  const reviewUrl = `${deps.appBase}${path.replace('{roundId}', String(run.roundId))}`;
  const token = generateApprovalToken();
  const now = deps.now();

  saveRun(db, { ...run, state: 'parked' }, now);
  db.prepare('UPDATE rollout_runs SET resume_token=?, review_url=?, updated_at=? WHERE id=?')
    .run(token, reviewUrl, now, run.runId);

  const { league, round } = names(db, run);
  const message = run.error ? `${label} — unresolved: ${run.error}` : label;
  await deps.notify({
    alertType, title: `${league} — ${round}`, message, link: reviewUrl,
  } as AlertPayload);

  return { ...run, state: 'parked' };
}

/**
 * Lift a hold: mark the human cut done, resume the run, and SPEND the token so
 * a re-tapped notification cannot replay it.
 */
export function liftHold(
  db: Database.Database, token: string, nowIso: string,
): { ok: true; runId: string } | { ok: false; reason: string } {
  if (!token) return { ok: false, reason: 'unknown or spent token' };
  const row = db.prepare('SELECT id FROM rollout_runs WHERE resume_token=?').get(token) as
    { id: string } | undefined;
  if (!row) return { ok: false, reason: 'unknown or spent token' };

  const run = loadRun(db, row.id);
  if (!run) return { ok: false, reason: 'unknown or spent token' };

  const cuts = run.cuts.map((c) =>
    c.ep === run.currentEp && c.runtime === null && c.state === 'pending'
      ? { ...c, state: 'done' as const }
      : c);

  saveRun(db, { ...run, cuts, state: 'running', error: undefined }, nowIso);
  db.prepare('UPDATE rollout_runs SET resume_token=NULL, updated_at=? WHERE id=?').run(nowIso, row.id);
  return { ok: true, runId: row.id };
}
