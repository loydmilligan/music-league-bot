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

  return { league, season, round, mlSubmissions, chatMentions, research, settings };
};
