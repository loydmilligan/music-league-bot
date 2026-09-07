import type { RequestHandler } from './$types.js';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { bearerOk } from '$lib/digest/callbackAuth.js';
import { getNotificationsConfig } from '$lib/notifications/config.js';
import { ensureVideoReviewSchema, claimApproval } from '$lib/ytm/videoReview.js';
import { completeApproval } from '$lib/ytm/send.js';
import { reviewContext } from '$lib/ytm/reviewContext.js';

const now = () => new Date().toISOString();

/**
 * POST { token } — approve the video playlist and post it.
 *
 * Fast-ack like the digest approve endpoint: the ntfy action times out around
 * 15s, but building a playlist (one insert per video, paced) plus two WhatsApp
 * sends takes far longer. claimApproval has already consumed the token, so a
 * client retry on a slow response is a no-op.
 */
export const POST: RequestHandler = async ({ request }) => {
  const db = getDb();
  ensureVideoReviewSchema(db);
  const expected = getNotificationsConfig(db).channels.ntfy.token || process.env.NTFY_TOKEN;
  if (!bearerOk(request.headers.get('authorization'), expected)) {
    return json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as { token?: unknown };
  const token = typeof body.token === 'string' ? body.token : '';

  const claim = claimApproval(db, token, now);
  if (!claim.ok || claim.roundId === undefined) return json(claim, { status: 400 });
  const roundId = claim.roundId;

  void completeApproval(db, roundId, { ...reviewContext(db, roundId), now })
    .catch((e) => console.error(`[ytm-video-approve] round ${roundId} failed:`, e instanceof Error ? e.message : e));

  return json({ ok: true, roundId }, { status: 200 });
};
