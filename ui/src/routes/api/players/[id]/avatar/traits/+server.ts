import type { RequestHandler } from './$types.js';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';

// Allowed enum values mirror the Settings UI controls (spec §Settings UI).
const GENDERS = ['male', 'female', 'nonbinary'];
const STYLES = ['average', 'skater', 'preppy', 'formal', 'jock', 'punk', 'bohemian'];
const HEIGHTS = ['petite', 'short', 'average', 'tall', 'very tall'];
const BUILDS = ['lanky', 'medium', 'athletic', 'thick'];

// Field name → optional enum whitelist. Freeform fields (hair, trait) have no list.
const FIELDS: Record<string, string[] | null> = {
  avatar_gender: GENDERS,
  avatar_style: STYLES,
  avatar_height: HEIGHTS,
  avatar_build: BUILDS,
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
      `SELECT avatar_gender, avatar_style, avatar_height, avatar_build, avatar_hair, avatar_trait
       FROM player_profiles WHERE player_id = ?`,
    )
    .get(playerId);

  return json(updated ?? {}, { status: 200 });
};
