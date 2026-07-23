import type { PageServerLoad } from './$types.js';
import { getDb } from '$lib/db/client.js';
import { readCachedBrief } from '$lib/theme-brief/assemble.js';

export const load: PageServerLoad = ({ params }) => {
  const roundId = Number(params.roundId);
  return { roundId, brief: readCachedBrief(getDb(), roundId) };
};
