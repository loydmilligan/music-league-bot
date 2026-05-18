import type { RequestHandler } from './$types.js';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { setChatSongDismissed } from '$lib/chat/chat.js';

export const POST: RequestHandler = async ({ params }) => {
  setChatSongDismissed(getDb(), params.id, true);
  return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ params }) => {
  setChatSongDismissed(getDb(), params.id, false);
  return json({ ok: true });
};
