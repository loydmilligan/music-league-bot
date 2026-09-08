import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { ensureVideoReviewSchema } from '$lib/ytm/videoReview.js';
import { ensurePlaylistSchema, authorizeWrite, castVote, tallies } from '$lib/ytm/playlistVotes.js';

/**
 * POST { videoId, playerId, dir: 'up' | 'down' | null } — one person's thumb.
 *
 * PUBLIC and unauthenticated (see the GET alongside): the player is whoever the
 * chip says they are, so the only thing that can be checked is that they are on
 * this round's roster and that the video is one this page offers. Both are
 * checked here and not merely in the page's script, which is a file anybody can
 * read and nobody has to run.
 *
 * Children are never votable (D6): only a pick's primary is, which is why the
 * authorisation asks for 'votable' rather than any video of the round.
 */
export const POST: RequestHandler = async ({ params, request }) => {
  const body = (await request.json().catch(() => null)) as {
    videoId?: unknown; playerId?: unknown; dir?: unknown;
  } | null;
  if (!body || typeof body.videoId !== 'string' || typeof body.playerId !== 'string') {
    throw error(400, 'videoId and playerId are required');
  }
  const dir = body.dir ?? null;
  if (dir !== 'up' && dir !== 'down' && dir !== null) throw error(400, "dir must be 'up', 'down' or null");

  const db = getDb();
  ensureVideoReviewSchema(db);
  ensurePlaylistSchema(db);
  const auth = authorizeWrite(db, params.slug, body.videoId, body.playerId, 'votable');
  if ('status' in auth) throw error(auth.status, auth.reason);

  castVote(db, auth.page.slug, body.videoId, auth.player.id, dir, new Date().toISOString());
  // The page adjusted its own count optimistically; hand back the true one so a
  // caller that wants to reconcile can, without a second round trip.
  const tally = tallies(db, auth.page.slug).find((t) => t.videoId === body.videoId);
  return json({ ok: true, tally: tally ?? { videoId: body.videoId, up: 0, down: 0, stampers: [] } });
};
