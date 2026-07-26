import type { RequestHandler } from './$types.js';
import { error, json } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { getRoundInsights } from '$lib/db/roundInsights.js';

export const GET: RequestHandler = ({ params }) => {
  const roundId = Number(params.roundId);
  if (!Number.isFinite(roundId)) throw error(400, 'invalid roundId');
  const db = getDb();
  if (!db.prepare('SELECT id FROM rounds WHERE id = ?').get(roundId)) {
    throw error(404, `round not found: ${roundId}`);
  }
  return json({ insights: getRoundInsights(db, roundId) });
};
