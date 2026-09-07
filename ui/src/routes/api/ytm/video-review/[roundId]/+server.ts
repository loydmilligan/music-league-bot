import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { ensureVideoReviewSchema, getReview, applyDecisions, undecidedPicks, includedVideoIds, type PickDecision } from '$lib/ytm/videoReview.js';

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
