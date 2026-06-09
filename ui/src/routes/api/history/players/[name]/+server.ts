import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { getPlayer } from '$lib/db/playerHistory.js';

// GET /api/history/players/:name — per-player detail (sprint-24, player-data).
// { songs: [{ round, title, artist, points }], winRate, tasteOverlap: { otherName: score } }.
// `name` is the competitor's display name (URL-decoded by SvelteKit).
export const GET: RequestHandler = async ({ params }) => {
  const name = params.name;
  if (!name) throw error(400, 'player name required');
  return json(getPlayer(getDb(), name));
};
