import type { RequestHandler } from './$types.js';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { appBaseUrl } from '$lib/config/urls.js';
import { notify } from '$lib/notifications/dispatch.js';
import {
  ensureVideoReviewSchema, getReview, reviewsDueForNotify, markNotified,
  undecidedPicks, includedVideoIds, type VideoReview,
} from '$lib/ytm/videoReview.js';
import { reviewContext } from '$lib/ytm/reviewContext.js';

const now = () => new Date().toISOString();

async function notifyOne(db: ReturnType<typeof getDb>, review: VideoReview) {
  const base = appBaseUrl();
  const { roundName, leagueTitle } = reviewContext(db, review.roundId);
  const needsDecision = undecidedPicks(review.picks).length;
  const ready = includedVideoIds(review.picks).length;
  const results = await notify(db, {
    alertType: 'video_review',
    title: leagueTitle,
    message: roundName,
    link: `${base}/ytm/${review.roundId}/videos`,
    approval: {
      kind: 'video_review',
      token: review.token ?? '',
      approveUrl: `${base}/api/ytm/video-review/approve`,
      denyUrl: `${base}/api/ytm/video-review/deny`,
      snoozeUrl: `${base}/api/ytm/video-review/snooze`,
      editUrl: `${base}/ytm/${review.roundId}/videos`,
      needsDecision,
      ready,
    },
  });
  const delivered = results.some((r) => r.ok);
  // Only mark notified if something actually went out — otherwise an ntfy
  // outage would silence the review permanently instead of retrying next tick.
  if (delivered) markNotified(db, review.roundId, now());
  return { roundId: review.roundId, delivered, results };
}

/**
 * POST { roundId? } — send the review notification.
 *
 * With a roundId: notify that round (the drop script calls this straight after
 * parking a review). Without: notify everything due, which is how a snooze
 * comes back — the existing 15-minute ytm-drop timer pokes this and needs no
 * scheduler of its own.
 */
export const POST: RequestHandler = async ({ request }) => {
  const db = getDb();
  ensureVideoReviewSchema(db);
  const body = (await request.json().catch(() => ({}))) as { roundId?: unknown };
  const roundId = typeof body.roundId === 'number' ? body.roundId : null;

  const targets = roundId !== null
    ? [getReview(db, roundId)].filter((r): r is VideoReview => !!r && r.status === 'pending')
    : reviewsDueForNotify(db, now());

  const out = [];
  for (const review of targets) out.push(await notifyOne(db, review));
  return json({ ok: true, notified: out });
};
