import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { setActiveRound, getLeagueActiveRound } from '$lib/db/activeRound.js';

// PUT /api/leagues/:leagueId/active-round — set the league's manual active-round
// slot. Body: { roundId: number | null } (null clears the slot). Returns the
// league's refreshed active-round view.
export const PUT: RequestHandler = async ({ params, request }) => {
  const leagueId = Number(params.leagueId);
  if (!leagueId) throw error(400, 'invalid leagueId');

  const db = getDb();
  const league = db.prepare('SELECT id FROM leagues WHERE id = ?').get(leagueId);
  if (!league) throw error(404, `league not found: ${leagueId}`);

  const body = (await request.json().catch(() => ({}))) as { roundId?: unknown };
  const roundId = body.roundId;
  if (roundId !== null && !(typeof roundId === 'number' && Number.isInteger(roundId))) {
    throw error(400, 'body.roundId must be an integer or null');
  }

  try {
    setActiveRound(db, leagueId, roundId);
  } catch (e) {
    throw error(400, e instanceof Error ? e.message : 'failed to set active round');
  }
  return json(getLeagueActiveRound(db, leagueId));
};

// DELETE /api/leagues/:leagueId/active-round — clear the slot.
export const DELETE: RequestHandler = async ({ params }) => {
  const leagueId = Number(params.leagueId);
  if (!leagueId) throw error(400, 'invalid leagueId');

  const db = getDb();
  const league = db.prepare('SELECT id FROM leagues WHERE id = ?').get(leagueId);
  if (!league) throw error(404, `league not found: ${leagueId}`);

  setActiveRound(db, leagueId, null);
  return json(getLeagueActiveRound(db, leagueId));
};
