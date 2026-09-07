import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { ensureVideoReviewSchema, upsertReview, undecidedPicks, includedVideoIds, type VideoPick } from '$lib/ytm/videoReview.js';
import { normalizeVideoPlaylistConfig } from '$lib/db/videoPlaylist.js';

/**
 * POST — park a freshly resolved set of video candidates for review.
 *
 * The drop script calls this instead of writing `ytm_video_reviews` itself: it
 * runs on the host as plain ESM, and duplicating the table schema and the
 * status machine out there is exactly the kind of drift the config twin already
 * costs us. Resolution stays on the host (it owns the YouTube search); the
 * lifecycle stays here.
 */
export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => null)) as {
    roundId?: unknown; leagueId?: unknown; picks?: unknown; config?: unknown;
    target?: unknown; audioUrl?: unknown; audioSent?: unknown;
  } | null;
  if (!body || typeof body.roundId !== 'number' || typeof body.leagueId !== 'number') {
    throw error(400, 'roundId and leagueId are required');
  }
  if (!Array.isArray(body.picks)) throw error(400, 'picks must be an array');
  if (typeof body.target !== 'string' || !body.target) throw error(400, 'target is required');

  const db = getDb();
  ensureVideoReviewSchema(db);
  const review = upsertReview(db, {
    roundId: body.roundId,
    leagueId: body.leagueId,
    picks: body.picks as VideoPick[],
    config: normalizeVideoPlaylistConfig(body.config),
    target: body.target,
    audioUrl: typeof body.audioUrl === 'string' ? body.audioUrl : null,
    audioSent: body.audioSent === true,
  }, new Date().toISOString());

  return json({
    ok: true,
    roundId: review.roundId,
    status: review.status,
    undecided: undecidedPicks(review.picks).length,
    included: includedVideoIds(review.picks).length,
  });
};
