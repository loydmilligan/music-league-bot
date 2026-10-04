import { json } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { publishLeagueStats, type StatsSeasonResult } from '$lib/portal/statsPublish.js';
import type { RequestHandler } from './$types.js';

interface LeagueResult { leagueId: number; ok: boolean; seasons?: StatsSeasonResult[]; error?: string }

export const POST: RequestHandler = async () => {
  const ids = (getDb().prepare('SELECT league_id FROM dashboard_sites ORDER BY league_id').all() as { league_id: number }[]).map((r) => r.league_id);
  const results: LeagueResult[] = [];
  for (const leagueId of ids) {
    try {
      const r = await publishLeagueStats(leagueId);
      results.push({ leagueId, ok: true, seasons: r.seasons });
    } catch (e) {
      results.push({ leagueId, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  const allFailed = results.length > 0 && results.every((r) => !r.ok);
  return json({ results }, { status: allFailed ? 500 : 200 });
};
