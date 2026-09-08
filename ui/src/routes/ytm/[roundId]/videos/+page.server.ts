import type { PageServerLoad } from './$types.js';
import { error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { ensureVideoReviewSchema, getReview, undecidedPicks, includedVideoIds } from '$lib/ytm/videoReview.js';
import { reviewContext } from '$lib/ytm/reviewContext.js';

export const load: PageServerLoad = ({ params }) => {
  const roundId = Number(params.roundId);
  if (!roundId) throw error(400, 'invalid round');
  const db = getDb();
  ensureVideoReviewSchema(db);
  const review = getReview(db, roundId);
  if (!review) throw error(404, 'No music-video review for this round.');
  return {
    // The single-use token stays server-side: the page's buttons go through the
    // in-app POST, which looks it up itself, so there is no reason to put a
    // live approval capability into the HTML.
    review: { ...review, token: null },
    ...reviewContext(db, roundId),
    undecided: undecidedPicks(review.picks).length,
    includedCount: includedVideoIds(review.picks).length,
  };
};
