import type { RequestHandler } from './$types.js';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { getActiveLeaguesActiveRounds } from '$lib/db/activeRound.js';

// GET /api/active-rounds — per active league, its resolved active round (or null)
// plus the active season's rounds (the "choose from this list" set for the modal).
export const GET: RequestHandler = async () => {
  return json({ leagues: getActiveLeaguesActiveRounds(getDb()) });
};
