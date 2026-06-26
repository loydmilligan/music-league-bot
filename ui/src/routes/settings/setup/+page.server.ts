import type { PageServerLoad, Actions } from './$types.js';
import { getDb } from '$lib/db/client.js';
import { getAllLeagues, getSeasonsForLeague, getActiveSeasonsWithLeague } from '$lib/db/leagues.js';
import { getRoundsForSeason, updateDeadlines } from '$lib/db/rounds.js';
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
    const availableRounds = activeView?.availableRounds ?? [];
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

  const basePlayers = getAllPlayers(db);

  // Bulk-load avatar traits + avatar-image presence so the per-player editor can
  // render the trait controls and base-avatar preview without N round-trips.
  const traitRows = db
    .prepare(
      `SELECT player_id, avatar_gender, avatar_race, avatar_style, avatar_height,
              avatar_build, avatar_hair, avatar_hair_style, avatar_hair_color, avatar_trait
       FROM player_profiles`,
    )
    .all() as Array<{
    player_id: number;
    avatar_gender: string | null;
    avatar_race: string | null;
    avatar_style: string | null;
    avatar_height: string | null;
    avatar_build: string | null;
    avatar_hair: string | null;
    avatar_hair_style: string | null;
    avatar_hair_color: string | null;
    avatar_trait: string | null;
  }>;
  const traitsByPlayer = new Map(traitRows.map(r => [r.player_id, r]));

  const avatarRows = db
    .prepare(
      `SELECT player_id, base_r2_key, themed_r2_key, base_source, base_cost_usd, themed_cost_usd
       FROM player_avatars`,
    )
    .all() as Array<{
    player_id: number;
    base_r2_key: string | null;
    themed_r2_key: string | null;
    base_source: string | null;
    base_cost_usd: number | null;
    themed_cost_usd: number | null;
  }>;
  const avatarByPlayer = new Map(avatarRows.map(r => [r.player_id, r]));

  const players = basePlayers.map(p => {
    const t = traitsByPlayer.get(p.id);
    const a = avatarByPlayer.get(p.id);
    return {
      ...p,
      avatar: {
        gender: t?.avatar_gender ?? '',
        race: t?.avatar_race ?? '',
        style: t?.avatar_style ?? '',
        height: t?.avatar_height ?? '',
        build: t?.avatar_build ?? '',
        hairStyle: t?.avatar_hair_style ?? '',
        hairColor: t?.avatar_hair_color ?? '',
        hair: t?.avatar_hair ?? '',
        trait: t?.avatar_trait ?? '',
        hasBase: !!a?.base_r2_key,
        hasThemed: !!a?.themed_r2_key,
        baseSource: a?.base_source ?? null,
        baseCostUsd: a?.base_cost_usd ?? null,
        themedCostUsd: a?.themed_cost_usd ?? null,
      },
    };
  });

  const allSeasons = allLeagues.flatMap(l => getSeasonsForLeague(db, l.id).map(s => ({
    ...s,
    leagueName: l.name,
    leagueSlug: l.slug,
  })));

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

  // Deadline management: active rounds across all leagues/seasons.
  const activeRounds = getActiveSeasonsWithLeague(db).flatMap(s => {
    const rounds = getRoundsForSeason(db, s.id);
    return rounds.map(r => ({ ...r, leagueName: s.league.name, seasonNumber: s.seasonNumber }));
  });

  return { leagues, players, allSeasons, leagueRounds, competitors, allLeagues, activeRounds };
};

export const actions: Actions = {
  updateDeadline: async ({ request }) => {
    const db = getDb();
    const fd = await request.formData();
    const roundId = Number(fd.get('roundId'));
    // Empty inputs mean "don't change this column" — important because legacy
    // ML-imported deadlines are non-ISO strings (e.g. "22 June @ 12:00am")
    // which a datetime-local input renders empty. The previous code coerced
    // empty → null and wiped the existing value on every save.
    const subRaw  = ((fd.get('submissionDeadline') as string | null) ?? '').trim();
    const voteRaw = ((fd.get('votingDeadline')    as string | null) ?? '').trim();
    const sub  = subRaw  === '' ? undefined : subRaw;
    const vote = voteRaw === '' ? undefined : voteRaw;
    if (sub === undefined && vote === undefined) return { success: true, noop: true };
    updateDeadlines(db, roundId, sub, vote);
    return { success: true };
  },
};
