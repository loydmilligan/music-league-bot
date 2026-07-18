import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { requeueJob } from '$lib/digest/jobs.js';

export const POST: RequestHandler = async ({ params }) => {
  const roundId = Number(params.roundId);
  if (!roundId) throw error(400, 'invalid roundId');
  requeueJob(getDb(), roundId, new Date().toISOString());
  return json({ ok: true, roundId });
};
