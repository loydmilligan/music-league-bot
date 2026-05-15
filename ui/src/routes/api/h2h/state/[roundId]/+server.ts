import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { buildH2HState, clearH2HMatches } from '$lib/db/headToHead.js';

export const GET: RequestHandler = async ({ params }) => {
  const roundId = Number(params.roundId);
  if (!roundId) throw error(400, 'invalid roundId');
  return json(buildH2HState(getDb(), roundId));
};

export const DELETE: RequestHandler = async ({ params }) => {
  const roundId = Number(params.roundId);
  if (!roundId) throw error(400, 'invalid roundId');
  const db = getDb();
  const cleared = clearH2HMatches(db, roundId);
  return json({ cleared, state: buildH2HState(db, roundId) });
};
