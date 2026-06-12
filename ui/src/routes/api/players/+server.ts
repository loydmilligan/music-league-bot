import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { getAllPlayers, createPlayer } from '$lib/db/players.js';

// GET /api/players — list all players with season memberships.
export const GET: RequestHandler = () => {
  const db = getDb();
  return json(getAllPlayers(db));
};

// POST /api/players — create a new player.
// Body: { name, chat_type?, chat_identifier?, ml_competitor_id? }
export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => ({}))) as {
    name?: unknown;
    chat_type?: unknown;
    chat_identifier?: unknown;
    ml_competitor_id?: unknown;
  };

  if (typeof body.name !== 'string' || body.name.trim() === '') {
    throw error(400, 'name must be a non-empty string');
  }
  const validChatTypes = ['whatsapp', 'google-chat', null, undefined];
  if (!validChatTypes.includes(body.chat_type as null)) {
    throw error(400, 'chat_type must be "whatsapp", "google-chat", or omitted');
  }

  const db = getDb();
  const player = createPlayer(db, {
    name: body.name.trim(),
    chatType: (body.chat_type as string | null | undefined) ?? null,
    chatIdentifier: typeof body.chat_identifier === 'string' ? body.chat_identifier : null,
    mlCompetitorId: typeof body.ml_competitor_id === 'string' ? body.ml_competitor_id : null,
  });
  return json(player, { status: 201 });
};
