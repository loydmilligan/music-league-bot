import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getDb } from '$lib/db/client.js';
import { getRoundMessages, getRoundStats } from '$lib/chat/historyQuery.js';

const PAGE_SIZE = 25;

export const GET: RequestHandler = ({ url }) => {
  const groupName = url.searchParams.get('groupName');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');

  if (!groupName || !from || !to) throw error(400, 'groupName, from, to required');

  const before = url.searchParams.get('before') ?? undefined;
  // strictFrom/strictTo: if provided, messages outside this window are tagged isBuffer
  const strictFrom = url.searchParams.get('strictFrom') ?? null;
  const strictTo = url.searchParams.get('strictTo') ?? null;
  const db = getDb();

  const rawMessages = getRoundMessages(db, groupName, from, to, { limit: PAGE_SIZE, before });

  const messages = rawMessages.map(m => ({
    ...m,
    isBuffer: strictFrom && strictTo
      ? m.ts < strictFrom || m.ts > strictTo
      : false,
  }));

  // hasMore: true if there are older messages before the first one we returned
  const oldestTs = rawMessages[0]?.ts;
  let hasMore = false;
  if (oldestTs) {
    const stats = getRoundStats(db, groupName, from, oldestTs);
    hasMore = stats.messageCount > 0;
  }

  return json({ messages, hasMore });
};
