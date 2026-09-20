import type { PageServerLoad } from './$types.js';
import { getReviewPlayers, getStillSpecs } from '$lib/server/boarzReview.js';

export const load: PageServerLoad = async ({ setHeaders }) => {
  setHeaders({ 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'private, no-store' });
  const players = await getReviewPlayers();
  const stillsByPlayer = Object.fromEntries(
    (await Promise.all(players.map(async player => [player.slug, await getStillSpecs(player.slug)] as const)))
      .filter(([, specs]) => specs.length)
  );
  return { players, stills: stillsByPlayer };
};
