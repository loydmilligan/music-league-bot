import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { requireBearerToken } from '$lib/auth/bearer.js';

// GET /api/rounds/list?leagueSlug=&seasonNumber=
// Lists a league's rounds (optionally scoped to one season) for discovery —
// the browse-then-pick companion to /api/rounds/resolve's exact lookup. New
// route (Phase 1b), bearer-token protected.
export const GET: RequestHandler = async ({ url, request }) => {
  const db = getDb();
  requireBearerToken(request, db);

  const leagueSlug = url.searchParams.get('leagueSlug');
  const seasonNumber = url.searchParams.get('seasonNumber');
  if (!leagueSlug) throw error(400, 'leagueSlug required');

  const rows = seasonNumber
    ? db
        .prepare(
          `SELECT r.id, r.name, r.round_number AS roundNumber, r.phase,
                  s.season_number AS seasonNumber
           FROM rounds r
           JOIN seasons s ON s.id = r.season_id
           JOIN leagues l ON l.id = s.league_id
           WHERE l.slug = ? AND s.season_number = ?
           ORDER BY s.season_number, r.id`,
        )
        .all(leagueSlug, Number(seasonNumber))
    : db
        .prepare(
          `SELECT r.id, r.name, r.round_number AS roundNumber, r.phase,
                  s.season_number AS seasonNumber
           FROM rounds r
           JOIN seasons s ON s.id = r.season_id
           JOIN leagues l ON l.id = s.league_id
           WHERE l.slug = ?
           ORDER BY s.season_number, r.id`,
        )
        .all(leagueSlug);

  return json(rows);
};
