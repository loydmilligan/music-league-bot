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
import { buildRoundWindows } from '$lib/chat/roundWindow.js';

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
  // True round count per group+season, so the season header can report real
  // coverage ("5 of 43") instead of counting only the rounds that survived the
  // filter below. Season numbers repeat across leagues, so the group name has
  // to be part of the key.
  const seasonTotals: Record<string, number> = {};

  for (const league of leagues) {
    const groupName = chatSettings.leagueGroupMap[league.slug] ?? '';
    if (!groupName) continue;

    const group = chatGroups.find(g => g.group_name === groupName);
    const platform = group?.platform ?? 'whatsapp';

    const seasons = getSeasonsForLeague(db, league.id);
    for (const season of seasons) {
      const rounds = getRoundsForSeason(db, season.id);
      // Real phase timestamps (populated by the email poller) live in columns the
      // Round mapper doesn't expose — read them directly and merge by id.
      const phaseById = new Map(
        (
          db
            .prepare('SELECT id, voting_started_at, voting_ended_at FROM rounds WHERE season_id = ?')
            .all(season.id) as Array<{ id: number; voting_started_at: string | null; voting_ended_at: string | null }>
        ).map((r) => [r.id, r] as const),
      );
      const windows = buildRoundWindows(
        rounds.map((r) => ({
          id: r.id,
          name: r.name,
          seasonNumber: season.seasonNumber,
          votingStartedAt: phaseById.get(r.id)?.voting_started_at ?? null,
          votingEndedAt: phaseById.get(r.id)?.voting_ended_at ?? null,
          submissionDeadline: r.submissionDeadline ?? null,
          votingDeadline: r.votingDeadline ?? null,
          createdAt: r.createdAt,
        })),
        new Date().toISOString(),
      );

      seasonTotals[`${groupName}::${season.seasonNumber}`] = windows.length;

      for (const w of windows) {
        // Buffer adjustment
        let qFrom = w.fromIso;
        let qTo = w.toIso;
        if (chatSettings.roundBoundary === 'buffer') {
          const bufMs = chatSettings.bufferDays * 86_400_000;
          qFrom = new Date(new Date(w.fromIso).getTime() - bufMs).toISOString();
          qTo = new Date(new Date(w.toIso).getTime() + bufMs).toISOString();
        }

        const stats = getRoundStats(db, groupName, qFrom, qTo);
        historyRounds.push({
          id: w.id,
          name: w.name,
          seasonNumber: w.seasonNumber,
          fromIso: w.fromIso,
          toIso: w.toIso,
          platform,
          groupName,
          isLive: w.isLive,
          ...stats,
        });
      }
    }
  }

  // Newest-first within each league. Rounds that captured no chat are hidden —
  // most leagues predate capture, so they are noise. A *live* round is the
  // exception: zero messages there means capture may be broken right now, and
  // dropping it takes the whole league off the page with no way to tell.
  historyRounds.reverse();
  const historyRoundsWithMessages = historyRounds.filter(r => r.messageCount > 0 || r.isLive);

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
    seasonTotals,
    roundBoundary: chatSettings.roundBoundary,
    bufferDays: chatSettings.bufferDays,
    hasUnlinkedLeagues: leagues.some(l => !chatSettings.leagueGroupMap[l.slug]),
  };
};
