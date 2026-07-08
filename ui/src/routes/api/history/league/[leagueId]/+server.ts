import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { getLeagueResearch } from '$lib/db/leagueResearch.js';

// GET /api/history/league/:leagueId?season=<n> — League Research dataset for one
// league (sprint-26). Omit `season` (or pass "all") for the all-seasons scope.
export const GET: RequestHandler = async ({ params, url }) => {
  const leagueId = Number(params.leagueId);
  if (!Number.isInteger(leagueId)) throw error(400, 'invalid league id');

  const seasonRaw = url.searchParams.get('season');
  const season = seasonRaw && seasonRaw !== 'all' ? Number(seasonRaw) : null;
  if (season !== null && !Number.isInteger(season)) throw error(400, 'invalid season');

  const data = getLeagueResearch(getDb(), leagueId, season);
  if (!data) throw error(404, 'league not found');
  return json(data);
};
