import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types.js';

// /digest → /content (the sidebar's Digest item is now "Content")
export const load: PageServerLoad = async () => {
  throw redirect(302, '/content');
};
