import type { PageServerLoad } from './$types.js';
import { getDb } from '$lib/db/client.js';
import { getAllLeagues, getSeasonsForLeague } from '$lib/db/leagues.js';
import { getRoundsForSeason } from '$lib/db/rounds.js';
import { getActiveLeaguesActiveRounds } from '$lib/db/activeRound.js';
import { getAllPlayers } from '$lib/db/players.js';
import type { Round } from '$lib/types.js';

interface CompetitorRow {
  id: number;
  name: string;
  ml_competitor_id: string;
  player_id: number | null;
  leagues: string | null;
}

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

  // Competitors with their linked player and leagues they appear in.
  const competitors = db.prepare<[], CompetitorRow>(`
    SELECT
      c.id,
      c.name,
      c.ml_competitor_id,
      c.player_id,
      GROUP_CONCAT(DISTINCT l.name ORDER BY l.name) AS leagues
    FROM competitors c
    LEFT JOIN ml_submissions ms ON ms.competitor_id = c.id
    LEFT JOIN rounds r ON r.id = ms.round_id
    LEFT JOIN seasons s ON s.id = r.season_id
    LEFT JOIN leagues l ON l.id = s.league_id
    GROUP BY c.id
    ORDER BY (c.player_id IS NULL) DESC, c.name ASC
  `).all();

  return { leagues, players, allSeasons, leagueRounds, competitors };
};
