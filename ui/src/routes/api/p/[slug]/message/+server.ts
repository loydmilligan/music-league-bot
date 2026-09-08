import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { notifyPlaylistMessage } from '$lib/ytm/playlistRelease.js';
import { ensureVideoReviewSchema } from '$lib/ytm/videoReview.js';
import {
  ensurePlaylistSchema, authorizeWrite, submitMessage, MessageRejected, MAX_MESSAGE_CHARS,
} from '$lib/ytm/playlistVotes.js';

/**
 * POST { videoId, playerId, text } — say something about one video.
 *
 * PUBLIC and unauthenticated (see the GET alongside). The message is stored
 * `pending` and goes nowhere: it is not on the page and not in the group until
 * Matt releases it, which is what the "⏳ WITH MATT" chip promises the sender.
 *
 * Unlike a vote this is allowed on a child video too — children are commentable
 * but never votable (D6).
 */
export const POST: RequestHandler = async ({ params, request }) => {
  const body = (await request.json().catch(() => null)) as {
    videoId?: unknown; playerId?: unknown; text?: unknown;
  } | null;
  if (!body || typeof body.videoId !== 'string' || typeof body.playerId !== 'string') {
    throw error(400, 'videoId and playerId are required');
  }
  if (typeof body.text !== 'string') throw error(400, 'text is required');

  const db = getDb();
  ensureVideoReviewSchema(db);
  ensurePlaylistSchema(db);
  const auth = authorizeWrite(db, params.slug, body.videoId, body.playerId, 'commentable');
  if ('status' in auth) throw error(auth.status, auth.reason);

  try {
    const { id, token } = submitMessage(
      db, auth.page.slug, body.videoId, auth.player.id, body.text, new Date().toISOString(),
    );

    // Tell Matt, or the message sits in the queue forever and the page's
    // "with Matt" chip is a lie. Fire-and-forget: the message is already
    // stored, and a notification failure must not fail the write or make the
    // author think their message was lost.
    void notifyPlaylistMessage(db, {
      slug: auth.page.slug,
      roundId: auth.page.roundId,
      videoId: body.videoId,
      author: auth.player.name,
      text: body.text,
      token,
    }).catch((e) => console.error('[playlist-message] notify failed:', e instanceof Error ? e.message : e));

    // No text comes back: echoing it would make it look posted, and the whole
    // point is that nothing is public until it has been through Matt.
    return json({ ok: true, id, status: 'pending' });
  } catch (e) {
    if (e instanceof MessageRejected) throw error(400, `${e.message} (max ${MAX_MESSAGE_CHARS})`);
    throw e;
  }
};
