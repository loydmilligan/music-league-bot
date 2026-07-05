import type { RequestHandler } from './$types.js';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { requireBearerToken } from '$lib/auth/bearer.js';
import { getAllLeagues } from '$lib/db/leagues.js';

// GET /api/leagues — list every league as {slug, name}. New route (Phase 1b);
// the discovery/lookup layer for the MCP server's list_leagues tool, so an
// LLM assistant can find a league slug without already knowing it.
export const GET: RequestHandler = async ({ request }) => {
  const db = getDb();
  requireBearerToken(request, db);

  const leagues = getAllLeagues(db).map((l) => ({ slug: l.slug, name: l.name }));
  return json(leagues);
};
