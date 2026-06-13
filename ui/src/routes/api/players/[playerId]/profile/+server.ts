import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { getPlayerById } from '$lib/db/players.js';

export interface DossierProfile {
  player_id: number;
  notes: string | null;
  tags: string[];
  taste_fingerprint: unknown | null;
  fingerprint_model: string | null;
  fingerprint_cost_usd: number | null;
  fingerprint_generated_at: string | null;
  updated_at: string | null;
}

function defaultProfile(playerId: number): DossierProfile {
  return {
    player_id: playerId,
    notes: null,
    tags: [],
    taste_fingerprint: null,
    fingerprint_model: null,
    fingerprint_cost_usd: null,
    fingerprint_generated_at: null,
    updated_at: null,
  };
}

// GET /api/players/:playerId/profile
// Returns the player's dossier profile. Returns an empty default if no row exists yet.
export const GET: RequestHandler = async ({ params }) => {
  const playerId = Number(params.playerId);
  if (!playerId) throw error(400, 'invalid playerId');

  const db = getDb();
  if (!getPlayerById(db, playerId)) throw error(404, `player not found: ${playerId}`);

  const row = db
    .prepare(
      `SELECT player_id, notes, tags, taste_fingerprint,
              fingerprint_model, fingerprint_cost_usd, fingerprint_generated_at, updated_at
       FROM player_profiles WHERE player_id = ?`,
    )
    .get(playerId) as
    | {
        player_id: number;
        notes: string | null;
        tags: string;
        taste_fingerprint: string | null;
        fingerprint_model: string | null;
        fingerprint_cost_usd: number | null;
        fingerprint_generated_at: string | null;
        updated_at: string | null;
      }
    | undefined;

  if (!row) return json(defaultProfile(playerId));

  let tags: string[] = [];
  try {
    tags = JSON.parse(row.tags);
  } catch {
    tags = [];
  }

  let tasteFingerprint: unknown | null = null;
  try {
    if (row.taste_fingerprint) tasteFingerprint = JSON.parse(row.taste_fingerprint);
  } catch {
    tasteFingerprint = null;
  }

  const profile: DossierProfile = {
    player_id: row.player_id,
    notes: row.notes,
    tags,
    taste_fingerprint: tasteFingerprint,
    fingerprint_model: row.fingerprint_model,
    fingerprint_cost_usd: row.fingerprint_cost_usd,
    fingerprint_generated_at: row.fingerprint_generated_at,
    updated_at: row.updated_at,
  };

  return json(profile);
};

// PATCH /api/players/:playerId/profile
// Persists notes + tags ONLY. Never touches taste_fingerprint or fingerprint_* provenance.
// Creates the profile row if it doesn't exist yet (upsert).
export const PATCH: RequestHandler = async ({ params, request }) => {
  const playerId = Number(params.playerId);
  if (!playerId) throw error(400, 'invalid playerId');

  const db = getDb();
  if (!getPlayerById(db, playerId)) throw error(404, `player not found: ${playerId}`);

  const body = (await request.json().catch(() => ({}))) as {
    notes?: unknown;
    tags?: unknown;
  };

  if (body.notes !== undefined && body.notes !== null && typeof body.notes !== 'string') {
    throw error(400, 'notes must be a string or null');
  }
  const notes = body.notes === undefined ? undefined : (body.notes as string | null);

  let tagsJson: string | undefined;
  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags) || !body.tags.every((t) => typeof t === 'string')) {
      throw error(400, 'tags must be an array of strings');
    }
    tagsJson = JSON.stringify(body.tags);
  }

  if (notes === undefined && tagsJson === undefined) {
    throw error(400, 'PATCH body must include at least one of: notes, tags');
  }

  // Upsert: insert-or-ignore creates the row if absent, then selective UPDATE
  // touches only the requested manual fields — taste_fingerprint is never mentioned.
  db.prepare(
    `INSERT OR IGNORE INTO player_profiles (player_id, tags) VALUES (?, '[]')`,
  ).run(playerId);

  const setClauses: string[] = ["updated_at = datetime('now')"];
  const values: unknown[] = [];
  if (notes !== undefined) {
    setClauses.push('notes = ?');
    values.push(notes);
  }
  if (tagsJson !== undefined) {
    setClauses.push('tags = ?');
    values.push(tagsJson);
  }
  values.push(playerId);

  db.prepare(
    `UPDATE player_profiles SET ${setClauses.join(', ')} WHERE player_id = ?`,
  ).run(...values);

  // Return the updated profile via the same read path
  const updated = db
    .prepare(
      `SELECT player_id, notes, tags, taste_fingerprint,
              fingerprint_model, fingerprint_cost_usd, fingerprint_generated_at, updated_at
       FROM player_profiles WHERE player_id = ?`,
    )
    .get(playerId) as {
    player_id: number;
    notes: string | null;
    tags: string;
    taste_fingerprint: string | null;
    fingerprint_model: string | null;
    fingerprint_cost_usd: number | null;
    fingerprint_generated_at: string | null;
    updated_at: string | null;
  };

  let tags: string[] = [];
  try {
    tags = JSON.parse(updated.tags);
  } catch {
    tags = [];
  }

  let tasteFingerprint: unknown | null = null;
  try {
    if (updated.taste_fingerprint) tasteFingerprint = JSON.parse(updated.taste_fingerprint);
  } catch {
    tasteFingerprint = null;
  }

  return json({
    player_id: updated.player_id,
    notes: updated.notes,
    tags,
    taste_fingerprint: tasteFingerprint,
    fingerprint_model: updated.fingerprint_model,
    fingerprint_cost_usd: updated.fingerprint_cost_usd,
    fingerprint_generated_at: updated.fingerprint_generated_at,
    updated_at: updated.updated_at,
  } satisfies DossierProfile);
};
