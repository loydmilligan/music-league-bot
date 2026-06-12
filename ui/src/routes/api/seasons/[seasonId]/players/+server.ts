import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { addPlayerToSeason } from '$lib/db/players.js';

// POST /api/seasons/:seasonId/players — add a player to a season.
// Body: { playerId: number }
export const POST: RequestHandler = async ({ params, request }) => {
  const seasonId = Number(params.seasonId);
  if (!seasonId) throw error(400, 'invalid seasonId');

  const db = getDb();
  if (!db.prepare('SELECT id FROM seasons WHERE id = ?').get(seasonId)) {
    throw error(404, `season not found: ${seasonId}`);
  }

  const body = (await request.json().catch(() => ({}))) as { playerId?: unknown };
  if (typeof body.playerId !== 'number' || !Number.isInteger(body.playerId)) {
    throw error(400, 'body.playerId (integer) required');
  }
  if (!db.prepare('SELECT id FROM players WHERE id = ?').get(body.playerId)) {
    throw error(404, `player not found: ${body.playerId}`);
  }

  addPlayerToSeason(db, seasonId, body.playerId);
  return json({ seasonId, playerId: body.playerId }, { status: 201 });
};
