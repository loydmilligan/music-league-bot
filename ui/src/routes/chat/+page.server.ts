import type { PageServerLoad } from './$types.js';
import { getDb } from '$lib/db/client.js';
import { getChatSongs, getDistinctChatNames, getUnassignedNotDismissedCount } from '$lib/chat/chat.js';

export const load: PageServerLoad = async ({ url }) => {
  const db = getDb();
  const status = (url.searchParams.get('status') as 'all' | 'unassigned' | 'assigned') || 'all';
  const chatName = url.searchParams.get('chat') ?? undefined;
  const sort = (url.searchParams.get('sort') as 'recent' | 'mentioned') || 'recent';

  const songs = getChatSongs(db, {
    status: status === 'all' ? undefined : status,
    chatName,
    sort,
  });
  const allSongs = getChatSongs(db);
  const chatNames = getDistinctChatNames(db);
  const unassignedCount = getUnassignedNotDismissedCount(db);

  return {
    songs,
    chatNames,
    unassignedCount,
    assignedCount: allSongs.filter(s => s.assignedRoundIds.length > 0).length,
    totalCount: allSongs.length,
    status,
    chatName: chatName ?? null,
    sort,
  };
};
