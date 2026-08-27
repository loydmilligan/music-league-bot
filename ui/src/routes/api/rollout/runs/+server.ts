import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { loadRun } from '$lib/rollout/store.js';

export type RunSummary = {
  runId: string; roundId: number; roundName: string;
  state: string; currentEp: number; startedAt: string; updatedAt: string; error: string | null;
};

// GET /api/rollout/runs?runId=X   → { run }   (full RunState, for the detail view)
// GET /api/rollout/runs?leagueId=N → { runs } (summaries, newest first)
export const GET: RequestHandler = async ({ url }) => {
  const db = getDb();
  const runId = url.searchParams.get('runId');
  if (runId) {
    const run = loadRun(db, runId);
    if (!run) throw error(404, 'unknown run');
    return json({ run });
  }
  const leagueId = Number(url.searchParams.get('leagueId'));
  if (!Number.isInteger(leagueId) || leagueId <= 0) throw error(400, 'leagueId or runId is required');
  const runs = db.prepare(
    `SELECT rr.id AS runId, rr.round_id AS roundId, r.name AS roundName, rr.state,
            rr.current_ep AS currentEp, rr.started_at AS startedAt,
            rr.updated_at AS updatedAt, rr.error
       FROM rollout_runs rr JOIN rounds r ON r.id = rr.round_id
      WHERE rr.league_id = ? ORDER BY rr.started_at DESC LIMIT 50`,
  ).all(leagueId) as RunSummary[];
  return json({ runs });
};
