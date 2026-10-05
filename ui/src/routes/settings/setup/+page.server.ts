import type { PageServerLoad, Actions } from './$types.js';
import { getDb } from '$lib/db/client.js';
import { getAllLeagues, getSeasonsForLeague, getActiveSeasonsWithLeague } from '$lib/db/leagues.js';
import { getRoundsForSeason, getRoundById, updateDeadlines } from '$lib/db/rounds.js';
import { fail } from '@sveltejs/kit';
import { runSurveySync, getSurveySyncStatus } from '$lib/surveySync/runner.js';
import {
  getVideoPlaylistDefaults,
  resolveVideoPlaylistConfig,
  type VideoPlaylistConfig,
} from '$lib/db/videoPlaylist.js';
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

    const statsDisplayName = db.prepare('SELECT value FROM settings WHERE key = ?').get(`ml_stats_display_name:${league.id}`) as { value?: string } | undefined;
    return {
      ...league,
      statsDisplayName: statsDisplayName?.value === 'identity' ? 'identity' as const : 'bot' as const,
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
        // Unique per image version — the preview <img> cache-busts on this so a
        // re-upload/regenerate never serves the stale prior image.
        baseKey: a?.base_r2_key ?? null,
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

  // Video-playlist config per round: the EFFECTIVE value (defaults merged with
  // the round's overrides) plus whether it is still inheriting, so the UI can
  // show "inherited" without a round-trip per row.
  const videoDefaults = getVideoPlaylistDefaults(db);
  const videoDefaultsJson = JSON.stringify(videoDefaults);
  const videoOverrides = new Map(
    (db.prepare('SELECT id, video_playlist_config AS c FROM rounds WHERE video_playlist_config IS NOT NULL')
      .all() as Array<{ id: number; c: string }>).map((r) => [r.id, r.c]),
  );

  type RoundWithVideo = Round & {
    seasonNumber: number;
    videoPlaylist: VideoPlaylistConfig;
    videoPlaylistInherited: boolean;
  };
  const leagueRounds: Record<number, RoundWithVideo[]> = {};
  for (const league of allLeagues) {
    const seasons = getSeasonsForLeague(db, league.id);
    const rounds: RoundWithVideo[] = [];
    for (const s of seasons) {
      const sr = getRoundsForSeason(db, s.id);
      for (const r of sr) {
        const override = videoOverrides.get(r.id) ?? null;
        rounds.push({
          ...r,
          seasonNumber: s.seasonNumber,
          videoPlaylist: resolveVideoPlaylistConfig(override, videoDefaultsJson),
          videoPlaylistInherited: override === null,
        });
      }
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

  const surveySync = {
    enabled: Boolean(process.env.SURVEY_DATA_DIR),
    status: getSurveySyncStatus(db),
  };

  return { leagues, players, allSeasons, leagueRounds, competitors, allLeagues, activeRounds, videoPlaylistDefaults: videoDefaults, surveySync };
};

export const actions: Actions = {
  surveySync: async () => {
    const dir = process.env.SURVEY_DATA_DIR;
    if (!dir) return fail(400, { error: 'SURVEY_DATA_DIR is not set on this instance.' });
    return { success: true, surveySync: runSurveySync(getDb(), dir) };
  },
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
    if (getRoundById(db, roundId)?.managedBy) return fail(409, { error: 'Deadlines for this round are managed in the survey admin.' });
    updateDeadlines(db, roundId, sub, vote);
    return { success: true };
  },
};
