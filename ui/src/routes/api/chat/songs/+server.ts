import type { RequestHandler } from './$types.js';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { getChatSongs, type ChatSongsFilter } from '$lib/chat/chat.js';
import { attachYtmLinks } from '$lib/db/ytmLinks.js';

export const GET: RequestHandler = async ({ url }) => {
  const status = url.searchParams.get('status') as ChatSongsFilter['status'] | null;
  const chatName = url.searchParams.get('chat') ?? undefined;
  const sort = (url.searchParams.get('sort') ?? 'recent') as ChatSongsFilter['sort'];
  const includeDismissed = url.searchParams.get('include_dismissed') === '1';
  const db = getDb();
  return json(attachYtmLinks(db, getChatSongs(db, { status: status ?? undefined, chatName, sort, includeDismissed })));
};
