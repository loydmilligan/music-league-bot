import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { requireBearerToken } from '$lib/auth/bearer.js';
import { getPendingMatchup } from '$lib/db/h2hRandom.js';

export const GET: RequestHandler = async ({ params, request }) => {
  const db = getDb();
  requireBearerToken(request, db);
  const roundId = Number(params.roundId);
  if (!roundId) throw error(400, 'invalid roundId');
  return json(getPendingMatchup(db, roundId));
};
