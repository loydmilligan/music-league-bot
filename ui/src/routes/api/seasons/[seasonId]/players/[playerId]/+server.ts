import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { removePlayerFromSeason } from '$lib/db/players.js';

// DELETE /api/seasons/:seasonId/players/:playerId — remove a player from a season.
export const DELETE: RequestHandler = ({ params }) => {
  const seasonId = Number(params.seasonId);
  const playerId = Number(params.playerId);
  if (!seasonId) throw error(400, 'invalid seasonId');
  if (!playerId) throw error(400, 'invalid playerId');

  const db = getDb();
  const removed = removePlayerFromSeason(db, seasonId, playerId);
  if (!removed) throw error(404, `player ${playerId} is not in season ${seasonId}`);
  return json({ seasonId, playerId, removed: true });
};
