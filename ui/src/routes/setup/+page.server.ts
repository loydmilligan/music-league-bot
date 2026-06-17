import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types.js';

// /setup → /settings/setup (sprint-38 moved Setup under Settings as "Music League
// Setup"). Internal links were all repointed; this shim covers external bookmarks.
export const load: PageServerLoad = async () => {
  throw redirect(308, '/settings/setup');
};
