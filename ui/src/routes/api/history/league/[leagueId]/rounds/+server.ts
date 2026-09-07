import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';

// GET /api/history/league/:leagueId/rounds — round picker source for the Voting
// Replay panel. Unauthenticated like the sibling League Research endpoints.
// `ballots` is the distinct voter count, so the picker can grey out rounds with
// nothing to replay.
export const GET: RequestHandler = async ({ params }) => {
  const leagueId = Number(params.leagueId);
  if (!Number.isInteger(leagueId) || leagueId <= 0) throw error(400, 'invalid league id');

  const rows = getDb().prepare(
    `SELECT r.id, r.name, s.season_number AS season,
            (SELECT COUNT(DISTINCT v.voter_id) FROM votes v WHERE v.round_id = r.id) AS ballots
       FROM rounds r
       JOIN seasons s ON s.id = r.season_id
      WHERE s.league_id = ?
      ORDER BY s.season_number, r.id`,
  ).all(leagueId);
  return json(rows);
};
