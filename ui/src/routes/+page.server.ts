import type { PageServerLoad } from './$types.js';
import { getDb } from '$lib/db/client.js';
import { getActiveSeasonsWithLeague, getAllLeagues, getSeasonsForLeague } from '$lib/db/leagues.js';
import { getCurrentRoundForSeason } from '$lib/db/rounds.js';
import { getAllMentions } from '$lib/submissionsDb.js';

export const load: PageServerLoad = async () => {
  const db = getDb();

  const activeSeasons = getActiveSeasonsWithLeague(db).map(s => {
    const currentRound = getCurrentRoundForSeason(db, s.id);
    const researchCount = currentRound
      ? (db.prepare('SELECT COUNT(*) n FROM research_songs WHERE round_id=?').get(currentRound.id) as any).n
      : 0;
    return { ...s, currentRound, researchCount };
  });

  const allLeagues = getAllLeagues(db);
  const leagueActiveStates = (db.prepare(
    'SELECT id, slug, is_active FROM leagues ORDER BY id',
  ).all() as { id: number; slug: string; is_active: number }[])
    .map(l => ({ id: l.id, slug: l.slug, manuallyActive: !!l.is_active }));
  const pastLeagues = allLeagues.filter(l => !l.excludeFromCombined).map(league => {
    const seasons = getSeasonsForLeague(db, league.id).filter(s => s.status === 'complete');
    const totalRounds = seasons.reduce((sum, s) =>
      sum + (db.prepare('SELECT COUNT(*) n FROM rounds WHERE season_id=?').get(s.id) as any).n, 0);
    const totalSongs = (db.prepare(`SELECT COUNT(DISTINCT ms.spotify_uri) n FROM ml_submissions ms
      JOIN rounds r ON ms.round_id=r.id JOIN seasons s ON r.season_id=s.id WHERE s.league_id=?`)
      .get(league.id) as any).n;
    return { league, seasons, totalRounds, totalSongs };
  }).filter(l => l.seasons.length > 0);

  const mlSongs = (db.prepare(`SELECT DISTINCT ms.title,ms.artists,ms.spotify_uri,'ml' src,
    l.slug league_slug,l.name league_name,s.season_number,r.name round_name
    FROM ml_submissions ms JOIN rounds r ON ms.round_id=r.id JOIN seasons s ON r.season_id=s.id
    JOIN leagues l ON s.league_id=l.id WHERE l.exclude_from_combined=0
    ORDER BY r.created_at DESC`).all() as any[]);
  const chatMentions = getAllMentions();

  return { activeSeasons, pastLeagues, leagueActiveStates, mlSongs, chatMentions };
};
