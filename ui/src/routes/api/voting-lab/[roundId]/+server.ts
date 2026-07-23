import type { RequestHandler } from './$types.js';
import { json, error, isHttpError } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { buildLabData } from '$lib/voting-lab/labData.js';

export const GET: RequestHandler = async ({ params }) => {
  const roundId = Number(params.roundId);
  if (!Number.isInteger(roundId)) throw error(400, 'roundId must be an integer');
  try {
    return json(buildLabData(getDb(), roundId));
  } catch (e) {
    if (isHttpError(e)) throw e;
    if (e instanceof Error && /not found/i.test(e.message)) {
      throw error(404, `round not found: ${roundId}`);
    }
    throw e;
  }
};
