import type { PageServerLoad } from './$types.js';
import { listStatsLeagues } from '$lib/server/boarzStats/data.js';

export const load: PageServerLoad = async () => ({ leagues: listStatsLeagues() });
