import type { RequestHandler } from './$types.js';
import { error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { unassignChatSongFromRound } from '$lib/chat/chat.js';

export const DELETE: RequestHandler = async ({ params }) => {
  const roundId = Number(params.roundId);
  if (!roundId) throw error(400, 'invalid roundId');
  unassignChatSongFromRound(getDb(), params.id, roundId);
  return new Response(null, { status: 204 });
};
