import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { getPlayerById } from '$lib/db/players.js';
import { generateFingerprint } from '$lib/predict/tasks/tasteFingerprint.js';

// POST /api/players/:playerId/fingerprint
// Runs the taste-fingerprint task and persists the result to player_profiles.
// Returns the fingerprint output + provenance (model, cost, generated_at).
export const POST: RequestHandler = async ({ params }) => {
  const playerId = Number(params.playerId);
  if (!playerId) throw error(400, 'invalid playerId');

  const db = getDb();
  if (!getPlayerById(db, playerId)) throw error(404, `player not found: ${playerId}`);

  const { fingerprint, meta } = await generateFingerprint(db, playerId);

  // Read back the stored provenance so the response is authoritative.
  const row = db
    .prepare(
      `SELECT fingerprint_model, fingerprint_cost_usd, fingerprint_generated_at
       FROM player_profiles WHERE player_id = ?`,
    )
    .get(playerId) as {
    fingerprint_model: string | null;
    fingerprint_cost_usd: number | null;
    fingerprint_generated_at: string | null;
  };

  return json({
    fingerprint,
    model: row?.fingerprint_model ?? meta.model,
    cost_usd: row?.fingerprint_cost_usd ?? meta.costUsd,
    generated_at: row?.fingerprint_generated_at ?? null,
  });
};
