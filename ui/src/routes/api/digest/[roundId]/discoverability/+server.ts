import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { getDiscoverability } from '$lib/db/discoverability.js';

// GET /api/digest/:roundId/discoverability
//   → { discoverability: [{ name, obscurityScore, submissionCount, avgPopularity }] | null }
// Ranked most-obscure first; null when no popularity data exists (self-suppress).
export const GET: RequestHandler = ({ params }) => {
  const roundId = Number(params.roundId);
  if (!roundId) throw error(400, 'invalid roundId');
  const db = getDb();
  if (!db.prepare('SELECT id FROM rounds WHERE id = ?').get(roundId)) throw error(404, `round not found: ${roundId}`);
  return json({ discoverability: getDiscoverability(db, roundId) });
};
