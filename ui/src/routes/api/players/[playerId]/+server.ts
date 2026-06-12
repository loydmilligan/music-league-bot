import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { getPlayerById, updatePlayer } from '$lib/db/players.js';

// PATCH /api/players/:playerId — update name, chat_type, chat_identifier.
export const PATCH: RequestHandler = async ({ params, request }) => {
  const playerId = Number(params.playerId);
  if (!playerId) throw error(400, 'invalid playerId');

  const db = getDb();
  if (!getPlayerById(db, playerId)) throw error(404, `player not found: ${playerId}`);

  const body = (await request.json().catch(() => ({}))) as {
    name?: unknown;
    chat_type?: unknown;
    chat_identifier?: unknown;
    age?: unknown;
  };

  const update: { name?: string; chatType?: string | null; chatIdentifier?: string | null; age?: number | null } = {};
  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || body.name.trim() === '') throw error(400, 'name must be a non-empty string');
    update.name = body.name.trim();
  }
  if (body.chat_type !== undefined) {
    if (body.chat_type !== null && body.chat_type !== 'whatsapp' && body.chat_type !== 'google-chat') {
      throw error(400, 'chat_type must be "whatsapp", "google-chat", or null');
    }
    update.chatType = body.chat_type as string | null;
  }
  if (body.chat_identifier !== undefined) {
    update.chatIdentifier = typeof body.chat_identifier === 'string' ? body.chat_identifier : null;
  }
  if (body.age !== undefined) {
    if (body.age !== null && (typeof body.age !== 'number' || !Number.isInteger(body.age) || body.age < 0 || body.age > 150)) {
      throw error(400, 'age must be a non-negative integer ≤ 150, or null');
    }
    update.age = body.age as number | null;
  }

  updatePlayer(db, playerId, update);
  const updated = getPlayerById(db, playerId);
  return json(updated);
};
