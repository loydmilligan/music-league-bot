import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { getPlayerById, addRelationship } from '$lib/db/players.js';

const VALID_TYPES = [
  'sister', 'brother', 'parent', 'spouse', 'child', 'grandchild',
  'cousin', 'boyfriend', 'girlfriend', 'other',
] as const;

// POST /api/players/:playerId/relationships
// Body: { related_player_id, relationship_type, relationship_note? }
export const POST: RequestHandler = async ({ params, request }) => {
  const playerId = Number(params.playerId);
  if (!playerId) throw error(400, 'invalid playerId');

  const db = getDb();
  if (!getPlayerById(db, playerId)) throw error(404, `player not found: ${playerId}`);

  const body = (await request.json().catch(() => ({}))) as {
    related_player_id?: unknown;
    relationship_type?: unknown;
    relationship_note?: unknown;
  };

  const relatedId = Number(body.related_player_id);
  if (!relatedId) throw error(400, 'related_player_id must be a positive integer');
  if (relatedId === playerId) throw error(400, 'related_player_id cannot be the same as playerId');
  if (!getPlayerById(db, relatedId)) throw error(404, `related player not found: ${relatedId}`);

  if (!VALID_TYPES.includes(body.relationship_type as (typeof VALID_TYPES)[number])) {
    throw error(400, `relationship_type must be one of: ${VALID_TYPES.join(', ')}`);
  }
  const type = body.relationship_type as string;
  if (type === 'other' && (typeof body.relationship_note !== 'string' || body.relationship_note.trim() === '')) {
    throw error(400, 'relationship_note is required when relationship_type is "other"');
  }
  const note = typeof body.relationship_note === 'string' ? body.relationship_note.trim() || null : null;

  try {
    const rel = addRelationship(db, playerId, relatedId, type, note ?? undefined);
    return json(rel, { status: 201 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('UNIQUE')) throw error(409, 'relationship already exists');
    throw error(500, 'failed to add relationship');
  }
};
