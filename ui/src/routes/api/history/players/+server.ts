import type { RequestHandler } from './$types.js';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { getPlayers } from '$lib/db/playerHistory.js';

// GET /api/history/players — Tab 3 "Player research" roster (sprint-24, player-data).
// [{ name, songsSubmitted, winRate }], ordered by songs submitted.
export const GET: RequestHandler = async () => {
  return json(getPlayers(getDb()));
};
