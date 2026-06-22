import type { PageServerLoad } from './$types.js';
import { getDb } from '$lib/db/client.js';
import { getChatSongs, getDistinctChatNames, getUnassignedNotDismissedCount } from '$lib/chat/chat.js';
import {
  getTotalMessageCount,
  getChatGroups,
  getAllDistinctSenders,
  getDistinctSenders,
  getRoundStats,
  getChatSettings,
} from '$lib/chat/historyQuery.js';
import { getAllLeagues, getSeasonsForLeague } from '$lib/db/leagues.js';
import { getRoundsForSeason } from '$lib/db/rounds.js';

export const load: PageServerLoad = async ({ url }) => {
  const db = getDb();
  const status = (url.searchParams.get('status') as 'all' | 'unassigned' | 'assigned') || 'all';
  const chatName = url.searchParams.get('chat') ?? undefined;
  const sort = (url.searchParams.get('sort') as 'recent' | 'mentioned') || 'recent';

  // Songs tab (unchanged)
  const songs = getChatSongs(db, {
    status: status === 'all' ? undefined : status,
    chatName,
    sort,
  });
  const allSongs = getChatSongs(db);
  const chatNames = getDistinctChatNames(db);
  const unassignedCount = getUnassignedNotDismissedCount(db);

  // History tab
  const chatSettings = getChatSettings(db);
  const chatGroups = getChatGroups(db);
  const allSenders = getAllDistinctSenders(db);
  const totalMessageCount = getTotalMessageCount(db);

  // Build rounds list with stats for the history view
  const leagues = getAllLeagues(db);
  interface HistoryRound {
    id: number;
    name: string;
    seasonNumber: number;
    fromIso: string;
    toIso: string;
    platform: string;
    groupName: string;
    isLive: boolean;
    messageCount: number;
    lastTs: string | null;
    snippet: string | null;
  }
  const historyRounds: HistoryRound[] = [];

  for (const league of leagues) {
    const groupName = chatSettings.leagueGroupMap[league.slug] ?? '';
    if (!groupName) continue;

    const group = chatGroups.find(g => g.group_name === groupName);
    const platform = group?.platform ?? 'whatsapp';

    const seasons = getSeasonsForLeague(db, league.id);
    for (const season of seasons) {
      const rounds = getRoundsForSeason(db, season.id);
      for (let i = 0; i < rounds.length; i++) {
        const round = rounds[i];
        const nextRound = rounds[i + 1];
        const fromIso = round.createdAt;
        const toIso = nextRound ? nextRound.createdAt : new Date().toISOString();
        const isLive = !nextRound;

        // Buffer adjustment
        let qFrom = fromIso;
        let qTo = toIso;
        if (chatSettings.roundBoundary === 'buffer') {
          const bufMs = chatSettings.bufferDays * 86_400_000;
          qFrom = new Date(new Date(fromIso).getTime() - bufMs).toISOString();
          qTo = new Date(new Date(toIso).getTime() + bufMs).toISOString();
        }

        const stats = getRoundStats(db, groupName, qFrom, qTo);
        historyRounds.push({
          id: round.id,
          name: round.name,
          seasonNumber: season.seasonNumber,
          fromIso,
          toIso,
          platform,
          groupName,
          isLive,
          ...stats,
        });
      }
    }
  }

  // Newest-first within each league; only show rounds with messages
  historyRounds.reverse();
  const historyRoundsWithMessages = historyRounds.filter(r => r.messageCount > 0);

  // Only expose groups that are actually mapped to a league (active links)
  const linkedGroupNames = new Set(Object.values(chatSettings.leagueGroupMap).filter(Boolean));
  const linkedChatGroups = chatGroups.filter(g => linkedGroupNames.has(g.group_name));

  // Per-group sender lists for the player filter
  const sendersByGroup: Record<string, string[]> = {};
  for (const g of linkedChatGroups) {
    sendersByGroup[g.group_name] = getDistinctSenders(db, g.group_name);
  }

  return {
    songs,
    chatNames,
    unassignedCount,
    assignedCount: allSongs.filter(s => s.assignedRoundIds.length > 0).length,
    totalCount: allSongs.length,
    status,
    chatName: chatName ?? null,
    sort,
    // History tab data
    totalMessageCount,
    chatGroups: linkedChatGroups,
    allSenders,
    sendersByGroup,
    selfNames: chatSettings.selfNames,
    historyRounds: historyRoundsWithMessages,
  };
};
