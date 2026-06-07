import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { getBadgesBatch, type BadgeInput } from '$lib/db/badges.js';

// POST /api/history/badges — batch song/artist badge lookup (sprint-23,
// badges-api, D6/D7). Body: { items: [{uri, artist}] }. Returns
// { [uri]: { song: BadgeSet, artist: BadgeSet } } where BadgeSet =
// { medals:{gold,silver,bronze}, poop, bigDiscussion }. Consumed by badge-system.
export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json()) as { items?: BadgeInput[] };
  if (!Array.isArray(body.items)) {
    throw error(400, 'items must be an array of { uri, artist }');
  }
  const items = body.items
    .filter((i) => i && typeof i.uri === 'string' && i.uri)
    .map((i) => ({ uri: i.uri, artist: typeof i.artist === 'string' ? i.artist : '' }));
  return json(getBadgesBatch(getDb(), items));
};
