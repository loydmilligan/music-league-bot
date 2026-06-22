import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getDb } from '$lib/db/client.js';
import { getRoundMessages } from '$lib/chat/historyQuery.js';

export const GET: RequestHandler = ({ url }) => {
  const groupName = url.searchParams.get('groupName');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');

  if (!groupName || !from || !to) throw error(400, 'groupName, from, to required');

  const db = getDb();
  const messages = getRoundMessages(db, groupName, from, to);
  return json(messages);
};
