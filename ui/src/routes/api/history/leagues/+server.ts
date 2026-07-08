import type { RequestHandler } from './$types.js';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { getAllLeagues } from '$lib/db/leagues.js';

// GET /api/history/leagues — league list for the League Research scope bar
// (sprint-26). Only leagues that actually have submissions are useful, but we
// return all and let the tab default to the first; [{ id, slug, name }].
export const GET: RequestHandler = async () => {
  const leagues = getAllLeagues(getDb()).map((l) => ({ id: l.id, slug: l.slug, name: l.name }));
  return json(leagues);
};
