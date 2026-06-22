import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getDb } from '$lib/db/client.js';
import { searchMessages, getChatSettings } from '$lib/chat/historyQuery.js';
import { getRoundById, getRoundsForSeason } from '$lib/db/rounds.js';
import { getSeasonsForLeague } from '$lib/db/leagues.js';
import { getLeagueBySlug } from '$lib/db/leagues.js';

export const GET: RequestHandler = async ({ url }) => {
  const q = url.searchParams.get('q')?.trim();
  if (!q) throw error(400, 'q required');

  const groupName = url.searchParams.get('groupName') ?? '';
  const from = url.searchParams.get('from') ?? undefined;
  const to = url.searchParams.get('to') ?? undefined;
  const sender = url.searchParams.get('sender') ?? undefined;
  const mediaOnly = url.searchParams.get('mediaOnly') === '1';

  const db = getDb();
  const settings = getChatSettings(db);

  // If no group specified, search across all groups mapped from league→group config
  const groupsToSearch = groupName
    ? [groupName]
    : Object.values(settings.leagueGroupMap);

  if (groupsToSearch.length === 0) return json([]);

  const results: unknown[] = [];
  for (const gn of groupsToSearch) {
    const msgs = searchMessages(db, { groupName: gn, query: q, fromIso: from, toIso: to, sender, mediaOnly });
    // We need to map each message back to which round it belongs to
    // For now, return messages with basic round info from context
    for (const msg of msgs) {
      results.push({
        ...msg,
        roundId: 0,
        roundName: gn,
        fromIso: from ?? '',
        toIso: to ?? '',
        groupName: gn,
      });
    }
  }

  return json(results);
};
