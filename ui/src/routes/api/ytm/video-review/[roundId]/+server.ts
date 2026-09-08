import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import {
  ensureVideoReviewSchema, getReview, applyDecisions, undecidedPicks, includedVideoIds,
  claimApproval, denyReview, snoozeReview, type PickDecision,
} from '$lib/ytm/videoReview.js';
import { completeApproval } from '$lib/ytm/send.js';
import { reviewContext } from '$lib/ytm/reviewContext.js';

const now = () => new Date().toISOString();

// GET → the review as it stands (no token: this is behind the same access as
// the rest of the UI; the token only exists for the ntfy one-tap actions).
export const GET: RequestHandler = ({ params }) => {
  const db = getDb();
  ensureVideoReviewSchema(db);
  const review = getReview(db, Number(params.roundId));
  if (!review) throw error(404, 'no video review for this round');
  return json({ review, undecided: undecidedPicks(review.picks).length, included: includedVideoIds(review.picks) });
};

// PATCH { decisions: [{ spotifyUri, chosen?, included? }] } → the updated review.
export const PATCH: RequestHandler = async ({ params, request }) => {
  const roundId = Number(params.roundId);
  const body = (await request.json().catch(() => null)) as { decisions?: unknown } | null;
  if (!body || !Array.isArray(body.decisions)) throw error(400, 'body.decisions must be an array');
  const db = getDb();
  ensureVideoReviewSchema(db);
  const review = applyDecisions(db, roundId, body.decisions as PickDecision[], now());
  if (!review) throw error(404, 'no video review for this round');
  return json({ review, undecided: undecidedPicks(review.picks).length, included: includedVideoIds(review.picks) });
};

/**
 * POST { action: 'approve' | 'deny' | 'snooze' } — the review page's buttons.
 *
 * Separate from /api/ytm/video-review/{approve,deny,snooze}, which are the
 * PUBLIC ntfy callbacks and are gated on the shared NTFY_TOKEN bearer because
 * anyone on the internet can POST to them. This route is in-app: it sits on the
 * same auth surface as the PATCH above, which can already decide what goes into
 * the playlist, so gating it differently would be theatre.
 *
 * The single-use token is read from the database here rather than sent by the
 * client — the browser never needs to hold it, and it stays out of the page.
 */
export const POST: RequestHandler = async ({ params, request }) => {
  const roundId = Number(params.roundId);
  const body = (await request.json().catch(() => ({}))) as { action?: unknown };
  const action = body.action;
  if (action !== 'approve' && action !== 'deny' && action !== 'snooze') {
    throw error(400, "action must be 'approve', 'deny' or 'snooze'");
  }

  const db = getDb();
  ensureVideoReviewSchema(db);
  const review = getReview(db, roundId);
  if (!review) throw error(404, 'no video review for this round');
  if (!review.token) return json({ ok: false, reason: `already ${review.status}` }, { status: 400 });

  if (action === 'snooze') {
    return json(snoozeReview(db, review.token, () => new Date()));
  }
  if (action === 'deny') {
    return json(denyReview(db, review.token, now));
  }

  const claim = claimApproval(db, review.token, now);
  if (!claim.ok) return json(claim, { status: 400 });

  // Fast-ack for the same reason the ntfy callback does: building the playlist
  // (one paced insert per video) plus the sends take far longer than a click
  // should wait, and the token is already consumed so a retry is a no-op.
  void completeApproval(db, roundId, { ...reviewContext(db, roundId), now })
    .catch((e) => console.error(`[ytm-video-approve] round ${roundId} failed:`, e instanceof Error ? e.message : e));

  return json({ ok: true, roundId });
};
