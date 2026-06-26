import type { RequestHandler } from './$types.js';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import {
  AVATAR_GENDERS,
  AVATAR_RACES,
  AVATAR_HEIGHTS,
  AVATAR_BUILDS,
  AVATAR_HAIR_STYLES,
  AVATAR_HAIR_COLORS,
  AVATAR_STYLES_ALL,
} from '$lib/avatarTraits.js';

// Field name → optional enum whitelist. Freeform fields (trait, legacy hair) have
// no list. Style is validated against the gender-agnostic union of all gendered
// style lists. Legacy avatar_hair is still accepted for back-compat.
const FIELDS: Record<string, string[] | null> = {
  avatar_gender: AVATAR_GENDERS,
  avatar_race: AVATAR_RACES,
  avatar_style: AVATAR_STYLES_ALL,
  avatar_height: AVATAR_HEIGHTS,
  avatar_build: AVATAR_BUILDS,
  avatar_hair_style: AVATAR_HAIR_STYLES,
  avatar_hair_color: AVATAR_HAIR_COLORS,
  avatar_hair: null,
  avatar_trait: null,
};

/**
 * PATCH /api/players/:id/avatar/traits
 * Upserts the six avatar_* trait columns on player_profiles. Accepts any subset.
 * Empty string or null clears a field. Never touches dossier/fingerprint fields.
 */
export const PATCH: RequestHandler = async ({ params, request }) => {
  const playerId = Number(params.id);
  if (!Number.isInteger(playerId) || playerId <= 0) {
    return json({ error: 'invalid player id' }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const setClauses: string[] = [];
  const values: unknown[] = [];

  for (const [field, allowed] of Object.entries(FIELDS)) {
    if (!(field in body)) continue;
    const raw = body[field];

    // null or empty string clears the column.
    if (raw === null || raw === '') {
      setClauses.push(`${field} = NULL`);
      continue;
    }
    if (typeof raw !== 'string') {
      return json({ error: `${field} must be a string or null` }, { status: 400 });
    }
    const value = raw.trim();
    if (value === '') {
      setClauses.push(`${field} = NULL`);
      continue;
    }
    if (allowed && !allowed.includes(value)) {
      return json({ error: `${field} must be one of: ${allowed.join(', ')}` }, { status: 400 });
    }
    setClauses.push(`${field} = ?`);
    values.push(value);
  }

  if (setClauses.length === 0) {
    return json({ error: 'no avatar trait fields supplied' }, { status: 400 });
  }

  const db = getDb();
  const exists = db.prepare('SELECT 1 FROM players WHERE id = ?').get(playerId);
  if (!exists) {
    return json({ error: 'player not found' }, { status: 404 });
  }

  // Upsert: ensure the profile row exists, then set only the supplied trait columns.
  db.prepare(`INSERT OR IGNORE INTO player_profiles (player_id, tags) VALUES (?, '[]')`).run(playerId);
  db.prepare(`UPDATE player_profiles SET ${setClauses.join(', ')} WHERE player_id = ?`).run(
    ...values,
    playerId,
  );

  const updated = db
    .prepare(
      `SELECT avatar_gender, avatar_race, avatar_style, avatar_height, avatar_build,
              avatar_hair_style, avatar_hair_color, avatar_hair, avatar_trait
       FROM player_profiles WHERE player_id = ?`,
    )
    .get(playerId);

  return json(updated ?? {}, { status: 200 });
};
