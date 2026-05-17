import type { PageServerLoad } from './$types.js';
import { getDb } from '$lib/db/client.js';
import { getShortlistSongs } from '$lib/shortlist/shortlist.js';

export const load: PageServerLoad = async () => {
  const db = getDb();
  return { songs: getShortlistSongs(db) };
};
