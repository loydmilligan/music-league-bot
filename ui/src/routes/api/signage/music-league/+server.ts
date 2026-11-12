import type { RequestHandler } from './$types.js';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { requireBearerToken } from '$lib/auth/bearer.js';
import { buildSignage } from '$lib/signage/musicLeague.js';

// GET /api/signage/music-league — read-only snapshot for Pocket Sign's Music League screens.
export const GET: RequestHandler = async ({ request }) => {
  const db = getDb();
  requireBearerToken(request, db);
  return json(buildSignage(db, Date.now()));
};
