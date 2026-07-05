import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { requireBearerToken } from '$lib/auth/bearer.js';
import { reshuffleRandomMatchup } from '$lib/db/h2hRandom.js';

export const POST: RequestHandler = async ({ params, request }) => {
  const db = getDb();
  requireBearerToken(request, db);
  const roundId = Number(params.roundId);
  if (!roundId) throw error(400, 'invalid roundId');
  try {
    return json(reshuffleRandomMatchup(db, roundId));
  } catch (e) {
    throw error(400, (e as Error).message);
  }
};
