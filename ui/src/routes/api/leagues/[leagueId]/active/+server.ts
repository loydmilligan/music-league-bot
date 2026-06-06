import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { markLeagueActive, getLeagueActiveRound } from '$lib/db/activeRound.js';

// PATCH /api/leagues/:leagueId/active — mark a league active / inactive.
// Body: { active: boolean }. Returns the league's refreshed active-round view.
export const PATCH: RequestHandler = async ({ params, request }) => {
  const leagueId = Number(params.leagueId);
  if (!leagueId) throw error(400, 'invalid leagueId');

  const db = getDb();
  const league = db.prepare('SELECT id FROM leagues WHERE id = ?').get(leagueId);
  if (!league) throw error(404, `league not found: ${leagueId}`);

  const body = (await request.json().catch(() => ({}))) as { active?: unknown };
  if (typeof body.active !== 'boolean') throw error(400, 'body.active (boolean) required');

  markLeagueActive(db, leagueId, body.active);
  return json(getLeagueActiveRound(db, leagueId));
};
