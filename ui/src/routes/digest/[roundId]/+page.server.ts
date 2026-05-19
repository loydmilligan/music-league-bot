import type { PageServerLoad } from './$types.js';

export const load: PageServerLoad = async ({ params }) => {
  return { roundId: params.roundId };
};
