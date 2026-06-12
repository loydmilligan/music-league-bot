import type { PageServerLoad } from './$types.js';
import { getDb } from '$lib/db/client.js';
import { getAllLeagues, getSeasonsForLeague } from '$lib/db/leagues.js';
import { getRoundsForSeason } from '$lib/db/rounds.js';
import { getActiveLeaguesActiveRounds } from '$lib/db/activeRound.js';
import { getAllPlayers } from '$lib/db/players.js';
import type { Round } from '$lib/types.js';

export const load: PageServerLoad = async () => {
  const db = getDb();
  const allLeagues = getAllLeagues(db);
  const activeRoundViews = getActiveLeaguesActiveRounds(db);

  const leagues = allLeagues.map(league => {
    const seasons = getSeasonsForLeague(db, league.id);
    const activeView = activeRoundViews.find(v => v.leagueId === league.id);
    // Collect all rounds for the active season to populate the round selector.
    const availableRounds = activeView?.availableRounds ?? [];
    // Also load rounds for any season that is active status so we can populate
    // the round selectors regardless of whether a manual active-round is set.
    const seasonsWithRounds = seasons.map(s => ({
      ...s,
      rounds: getRoundsForSeason(db, s.id),
    }));

    return {
      ...league,
      isActive: activeView?.isActive ?? false,
      manuallyActive: activeView?.manuallyActive ?? false,
      activeSeasonId: activeView?.activeSeasonId ?? null,
      activeRoundId: activeView?.activeRound?.id ?? null,
      activeRoundName: activeView?.activeRound?.name ?? null,
      seasons: seasonsWithRounds,
      availableRounds,
    };
  });

  const players = getAllPlayers(db);
  const allSeasons = allLeagues.flatMap(l => getSeasonsForLeague(db, l.id).map(s => ({
    ...s,
    leagueName: l.name,
    leagueSlug: l.slug,
  })));

  // Collect all rounds per league (across all seasons) for the round management section.
  const leagueRounds: Record<number, Array<Round & { seasonNumber: number }>> = {};
  for (const league of allLeagues) {
    const seasons = getSeasonsForLeague(db, league.id);
    const rounds: Array<Round & { seasonNumber: number }> = [];
    for (const s of seasons) {
      const sr = getRoundsForSeason(db, s.id);
      for (const r of sr) rounds.push({ ...r, seasonNumber: s.seasonNumber });
    }
    leagueRounds[league.id] = rounds;
  }

  return { leagues, players, allSeasons, leagueRounds };
};
