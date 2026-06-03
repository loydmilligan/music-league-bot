import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { getRoundStats } from '$lib/db/roundStats.js';

// GET /api/digest/:roundId/stats → { stats: { totalVotes, submitters, blowoutMargin, closestRace, uniqueArtists } }
export const GET: RequestHandler = ({ params }) => {
  const roundId = Number(params.roundId);
  if (!roundId) throw error(400, 'invalid roundId');
  const db = getDb();
  if (!db.prepare('SELECT id FROM rounds WHERE id = ?').get(roundId)) throw error(404, `round not found: ${roundId}`);
  return json({ stats: getRoundStats(db, roundId) });
};
