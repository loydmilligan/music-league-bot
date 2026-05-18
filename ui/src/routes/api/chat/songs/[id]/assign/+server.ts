import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { assignChatSongToRound } from '$lib/chat/chat.js';

export const POST: RequestHandler = async ({ params, request }) => {
  const body = await request.json() as { round_id?: number };
  if (typeof body.round_id !== 'number') throw error(400, 'round_id required');
  assignChatSongToRound(getDb(), params.id, body.round_id);
  return json({ ok: true }, { status: 201 });
};
