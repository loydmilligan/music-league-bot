import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { setSeasonStatus } from '$lib/db/leagues.js';

// PATCH /api/leagues/:leagueId/seasons/:seasonId — flip season status.
// Body: { status: 'active' | 'complete' }
export const PATCH: RequestHandler = async ({ params, request }) => {
  const leagueId = Number(params.leagueId);
  const seasonId = Number(params.seasonId);
  if (!leagueId) throw error(400, 'invalid leagueId');
  if (!seasonId) throw error(400, 'invalid seasonId');

  const db = getDb();
  const season = db.prepare('SELECT id FROM seasons WHERE id = ? AND league_id = ?').get(seasonId, leagueId);
  if (!season) throw error(404, `season ${seasonId} not found in league ${leagueId}`);

  const body = (await request.json().catch(() => ({}))) as { status?: unknown };
  if (body.status !== 'active' && body.status !== 'complete') {
    throw error(400, 'body.status must be "active" or "complete"');
  }

  const changed = setSeasonStatus(db, seasonId, body.status);
  if (!changed) throw error(500, 'update failed');

  const updated = db.prepare('SELECT * FROM seasons WHERE id = ?').get(seasonId) as {
    id: number; league_id: number; season_number: number; status: string; status_source: string;
  };
  return json({ id: updated.id, leagueId: updated.league_id, seasonNumber: updated.season_number, status: updated.status, statusSource: updated.status_source });
};
