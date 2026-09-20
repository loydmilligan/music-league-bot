import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { runStillGeneration } from '$lib/server/boarzReview.js';

export const POST: RequestHandler = async ({ params }) => {
  const result = await runStillGeneration(params.player);
  return json(result, { headers: { 'Cache-Control': 'private, no-store' } });
};
