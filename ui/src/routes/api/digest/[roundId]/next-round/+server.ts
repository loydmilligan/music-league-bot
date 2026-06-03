import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { getNextRound } from '$lib/db/nextRound.js';

// GET /api/digest/:roundId/next-round → { nextRound: { theme, deadline, submissionsSoFar } | null }
export const GET: RequestHandler = ({ params }) => {
  const roundId = Number(params.roundId);
  if (!roundId) throw error(400, 'invalid roundId');
  const db = getDb();
  if (!db.prepare('SELECT id FROM rounds WHERE id = ?').get(roundId)) throw error(404, `round not found: ${roundId}`);
  return json({ nextRound: getNextRound(db, roundId) });
};
