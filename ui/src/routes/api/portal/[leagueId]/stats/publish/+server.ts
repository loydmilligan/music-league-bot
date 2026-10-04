import { error, json } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { publishLeagueStats, StatsPublishBusyError } from '$lib/portal/statsPublish.js';
import type { RequestHandler } from './$types.js';

export const POST: RequestHandler = async ({ params }) => {
  const id = Number(params.leagueId);
  if (!Number.isInteger(id) || id <= 0) throw error(400, 'invalid league id');
  const db = getDb();
  if (!db.prepare('SELECT 1 FROM leagues WHERE id = ?').get(id)) throw error(404, 'league not found');
  if (!db.prepare('SELECT 1 FROM dashboard_sites WHERE league_id = ?').get(id)) throw error(404, 'no b-side site');
  try {
    return json(await publishLeagueStats(id));
  } catch (e) {
    if (e instanceof StatsPublishBusyError) throw error(409, e.message);
    if (e instanceof Error && e.message.includes('no b-side site')) throw error(404, e.message);
    throw e;
  }
};
