import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { setCompetitorPlayerLink, resyncCompetitorPlayerIds } from '$lib/db/competitors.js';

// PATCH /api/competitors/:competitorId — set or clear the competitor→player link.
// Body: { player_id: number | null }
// After updating, immediately re-syncs ml_submissions/votes/season_standings.player_id
// for this competitor so gameplay rows reflect the new link without a container reboot.
export const PATCH: RequestHandler = async ({ params, request }) => {
  const competitorId = Number(params.competitorId);
  if (!competitorId) throw error(400, 'invalid competitorId');

  const db = getDb();
  const competitor = db.prepare('SELECT id, ml_competitor_id, name, player_id FROM competitors WHERE id = ?').get(competitorId) as
    | { id: number; ml_competitor_id: string; name: string; player_id: number | null }
    | undefined;
  if (!competitor) throw error(404, `competitor not found: ${competitorId}`);

  const body = (await request.json().catch(() => ({}))) as { player_id?: unknown };
  if (!('player_id' in body)) throw error(400, 'body.player_id required (number or null)');

  const rawId = body.player_id;
  if (rawId !== null && (typeof rawId !== 'number' || !Number.isInteger(rawId) || rawId <= 0)) {
    throw error(400, 'player_id must be a positive integer or null');
  }
  const playerId = rawId as number | null;

  if (playerId !== null) {
    const player = db.prepare('SELECT id FROM players WHERE id = ?').get(playerId);
    if (!player) throw error(404, `player not found: ${playerId}`);
  }

  setCompetitorPlayerLink(db, competitorId, playerId);
  resyncCompetitorPlayerIds(db, competitorId);

  const updated = db.prepare('SELECT id, ml_competitor_id, name, player_id FROM competitors WHERE id = ?').get(competitorId);
  return json(updated);
};
