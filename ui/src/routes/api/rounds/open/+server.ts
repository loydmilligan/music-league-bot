import type { RequestHandler } from './$types.js';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { getOpenRounds } from '$lib/shortlist/shortlist.js';

export const GET: RequestHandler = async () => {
  return json(getOpenRounds(getDb()));
};
