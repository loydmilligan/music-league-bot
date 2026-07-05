import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { requireBearerToken } from '$lib/auth/bearer.js';

// GET /api/rounds/resolve?leagueSlug=&seasonNumber=&roundNumber=|roundName=
// Resolves a human-friendly round reference to its stable rounds.id.
// round_number is nullable/manually-curated (see rounds.md design notes),
// so this is a lookup convenience, not a chronology guarantee.
export const GET: RequestHandler = async ({ url, request }) => {
  const db = getDb();
  requireBearerToken(request, db);

  const leagueSlug = url.searchParams.get('leagueSlug');
  const seasonNumber = url.searchParams.get('seasonNumber');
  const roundNumber = url.searchParams.get('roundNumber');
  const roundName = url.searchParams.get('roundName');

  if (!leagueSlug || !seasonNumber) throw error(400, 'leagueSlug and seasonNumber required');
  if (!roundNumber && !roundName) throw error(400, 'one of roundNumber or roundName required');

  const row = roundNumber
    ? db
        .prepare(
          `SELECT r.id, r.name, r.round_number AS roundNumber, r.phase,
                  s.season_number AS seasonNumber, l.slug AS leagueSlug
           FROM rounds r
           JOIN seasons s ON s.id = r.season_id
           JOIN leagues l ON l.id = s.league_id
           WHERE l.slug = ? AND s.season_number = ? AND r.round_number = ?`,
        )
        .get(leagueSlug, Number(seasonNumber), Number(roundNumber))
    : db
        .prepare(
          `SELECT r.id, r.name, r.round_number AS roundNumber, r.phase,
                  s.season_number AS seasonNumber, l.slug AS leagueSlug
           FROM rounds r
           JOIN seasons s ON s.id = r.season_id
           JOIN leagues l ON l.id = s.league_id
           WHERE l.slug = ? AND s.season_number = ? AND LOWER(r.name) = LOWER(?)`,
        )
        .get(leagueSlug, Number(seasonNumber), roundName);

  if (!row) throw error(404, 'no matching round found');
  return json(row);
};
