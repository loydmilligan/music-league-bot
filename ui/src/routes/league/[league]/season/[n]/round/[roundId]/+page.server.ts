import type { PageServerLoad } from './$types.js';
import { error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { getLeagueBySlug, getSeasonsForLeague } from '$lib/db/leagues.js';
import { getRoundById, getRoundsForSeason } from '$lib/db/rounds.js';
import { getSubmissionsForRound } from '$lib/db/submissions.js';
import { getResearchSongs } from '$lib/db/research.js';
import { getSettings } from '$lib/db/settings.js';
import { computeScore } from '$lib/scoring.js';
import { getChatMentionsBetween } from '$lib/submissionsDb.js';
import {
  getChatSettings,
  getChatGroups,
  getRoundMessages,
  getRoundStats,
  getDistinctSenders,
} from '$lib/chat/historyQuery.js';

export const load: PageServerLoad = async ({ params }) => {
  const db = getDb();
  const league = getLeagueBySlug(db, params.league);
  if (!league) throw error(404, 'League not found');
  const seasons = getSeasonsForLeague(db, league.id);
  const season = seasons.find(s => s.seasonNumber === Number(params.n));
  if (!season) throw error(404, 'Season not found');
  const round = getRoundById(db, Number(params.roundId));
  if (!round || round.seasonId !== season.id) throw error(404, 'Round not found');

  const mlSubmissions = getSubmissionsForRound(db, round.id);

  const allRounds = getRoundsForSeason(db, season.id);
  const idx = allRounds.findIndex(r => r.id === round.id);
  const nextRound = allRounds[idx + 1];
  const fromMs = new Date(round.createdAt).getTime();
  const toMs = nextRound ? new Date(nextRound.createdAt).getTime() : Date.now();
  const chatMentions = getChatMentionsBetween(fromMs, toMs);

  const settings = getSettings(db);
  const research = getResearchSongs(db, round.id).map(s => ({
    ...s, score: computeScore(s, settings),
  }));

  // Chat History tab data
  const chatSettings = getChatSettings(db);
  const roundGroupName = chatSettings.leagueGroupMap[league.slug] ?? '';
  const roundFromIso = round.createdAt;
  const roundToIso = nextRound ? nextRound.createdAt : new Date().toISOString();

  let qFrom = roundFromIso;
  let qTo = roundToIso;
  if (chatSettings.roundBoundary === 'buffer') {
    const bufMs = chatSettings.bufferDays * 86_400_000;
    qFrom = new Date(new Date(roundFromIso).getTime() - bufMs).toISOString();
    qTo = new Date(new Date(roundToIso).getTime() + bufMs).toISOString();
  }

  const groups = getChatGroups(db);
  const roundGroup = groups.find(g => g.group_name === roundGroupName);
  const roundPlatform = roundGroup?.platform ?? 'whatsapp';

  const PAGE_SIZE = 100;
  const roundStats = roundGroupName ? getRoundStats(db, roundGroupName, qFrom, qTo) : null;
  const roundMessageCount = roundStats?.messageCount ?? 0;

  // Load only the last PAGE_SIZE messages — client fetches older pages on demand
  const roundMessages = roundGroupName
    ? getRoundMessages(db, roundGroupName, qFrom, qTo, { limit: PAGE_SIZE })
    : [];
  const roundHasMore = roundMessageCount > PAGE_SIZE;

  const roundSenders = roundGroupName
    ? getDistinctSenders(db, roundGroupName)
    : [];

  return {
    league,
    season,
    round,
    mlSubmissions,
    chatMentions,
    research,
    settings,
    // Chat History
    roundGroupName,
    roundFromIso: qFrom,
    roundToIso: qTo,
    roundPlatform,
    roundMessages,
    roundHasMore,
    roundSenders,
    roundMessageCount,
    selfNames: chatSettings.selfNames,
  };
};
