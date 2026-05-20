import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { readRelContext, upsertRelContext } from '$lib/digest/relContext.js';

// GET /api/leagues/:leagueId/rel-context — current + previous snapshot.
export const GET: RequestHandler = async ({ params }) => {
  const leagueId = Number(params.leagueId);
  if (!leagueId) throw error(400, 'invalid leagueId');

  const db = getDb();
  const league = db.prepare('SELECT id FROM leagues WHERE id = ?').get(leagueId);
  if (!league) throw error(404, `league not found: ${leagueId}`);

  return json(readRelContext(db, leagueId));
};

// PATCH /api/leagues/:leagueId/rel-context — manual operator override. Snapshots prior into previous_*.
export const PATCH: RequestHandler = async ({ params, request }) => {
  const leagueId = Number(params.leagueId);
  if (!leagueId) throw error(400, 'invalid leagueId');

  const db = getDb();
  const league = db.prepare('SELECT id FROM leagues WHERE id = ?').get(leagueId);
  if (!league) throw error(404, `league not found: ${leagueId}`);

  const body = (await request.json().catch(() => ({}))) as { context?: unknown };
  if (typeof body.context !== 'string') throw error(400, 'body.context (string) required');

  return json(upsertRelContext(db, leagueId, body.context, null));
};
