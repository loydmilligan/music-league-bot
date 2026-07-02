import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { recomputePopularityProxies } from '$lib/lastfm.js';
import { runPrepChecks } from '$lib/digest/prepChecks.js';

// POST /api/digest/:roundId/prepare — runs the full data-readiness checks.
export const POST: RequestHandler = async ({ params }) => {
  const roundId = Number(params.roundId);
  if (!roundId) throw error(400, 'invalid roundId');

  const db = getDb();
  const round = db.prepare('SELECT id FROM rounds WHERE id = ?').get(roundId);
  if (!round) throw error(404, `round not found: ${roundId}`);

  await recomputePopularityProxies(db); // ensure proxy is fresh before coverage is judged

  return json({ checks: runPrepChecks(db, roundId) });
};
