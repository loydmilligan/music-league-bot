import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { ensureVideoReviewSchema } from '$lib/ytm/videoReview.js';
import { ensurePlaylistSchema, readModel } from '$lib/ytm/playlistVotes.js';

/**
 * The MLB playlist page's public read model — tallies, band stamps and the
 * messages Matt has released.
 *
 * PUBLIC and unauthenticated: the page is a static file on
 * digest.mattmariani.com and this route is reached through the narrow prefix
 * Caddy proxies to bot-ui, from a link pasted into a group chat. The slug is
 * the only credential, so an unknown one is a bare 404 that says nothing about
 * what other slugs exist, and the response carries this round's data only.
 */
export const GET: RequestHandler = ({ params }) => {
  const db = getDb();
  ensureVideoReviewSchema(db);
  ensurePlaylistSchema(db);
  const model = readModel(db, params.slug);
  if (!model) throw error(404, 'no such page');
  return json(model);
};
