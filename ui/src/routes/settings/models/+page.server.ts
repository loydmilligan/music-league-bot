import type { PageServerLoad } from './$types.js';
import { getDb } from '$lib/db/client.js';
import { getAllLeagues } from '$lib/db/leagues.js';

export const load: PageServerLoad = async () => {
  const leagues = getAllLeagues(getDb());
  return { leagues };
};
