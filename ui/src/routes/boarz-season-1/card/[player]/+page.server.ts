import type { PageServerLoad } from './$types.js';
import { error } from '@sveltejs/kit';
import { getReviewPlayers } from '$lib/server/boarzReview.js';

export const load: PageServerLoad = async ({ params, setHeaders }) => {
  setHeaders({ 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'private, no-store' });
  const players = await getReviewPlayers();
  const player = players.find(p => p.slug === params.player);
  if (!player) throw error(404, 'Unknown player');
  const card = player.media.filter(m => m.path.startsWith('card/'));
  return {
    slug: player.slug,
    name: player.name,
    front: card.find(m => m.name === 'card-front.png')?.url ?? null,
    back: card.find(m => m.name === 'card-back.png')?.url ?? null,
    video: card.find(m => m.name === 'card.mp4')?.url ?? null
  };
};
