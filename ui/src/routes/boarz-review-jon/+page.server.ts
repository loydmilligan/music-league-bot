import type { PageServerLoad } from './$types.js';
import { getJonReviewPlayers } from '$lib/server/boarzJonReview.js';

export const load: PageServerLoad = async ({ setHeaders }) => {
  setHeaders({ 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'private, no-store' });
  return { players: await getJonReviewPlayers(), dataLoadedAt: new Date().toISOString() };
};
