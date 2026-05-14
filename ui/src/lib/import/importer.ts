import type Database from 'better-sqlite3';
import type { ParsedZip } from './zipParser.js';
import { getLeagueBySlug, upsertSeason } from '../db/leagues.js';
import { upsertRound } from '../db/rounds.js';
import { upsertCompetitor, upsertSubmission, upsertVote } from '../db/submissions.js';

export interface ImportResult { roundsCount: number; submissionsCount: number; votesCount: number; status: 'success'|'partial'|'error'; error?: string; }

export function importZipData(db: Database.Database, leagueSlug: string, seasonNumber: number, parsed: ParsedZip): ImportResult {
  const league = getLeagueBySlug(db, leagueSlug);
  if (!league) return { roundsCount: 0, submissionsCount: 0, votesCount: 0, status: 'error', error: `Unknown league: ${leagueSlug}` };
  let rc = 0, sc = 0, vc = 0;
  try {
    db.transaction(() => {
      const status = parsed.rounds.length > 0 && parsed.votes.length > 0 ? 'complete' : 'active';
      const seasonId = upsertSeason(db, league.id, seasonNumber, status);
      const cMap = new Map<string,number>();
      for (const c of parsed.competitors) cMap.set(c.id, upsertCompetitor(db, c.id, c.name));
      const rMap = new Map<string,number>();
      for (const r of parsed.rounds) {
        rMap.set(r.id, upsertRound(db, seasonId, { mlRoundId: r.id, name: r.name, description: r.description, spotifyPlaylistUrl: r.playlistUrl, createdAt: r.createdAt }));
        rc++;
      }
      for (const s of parsed.submissions) {
        const roundId = rMap.get(s.roundId), competitorId = cMap.get(s.submitterId);
        if (!roundId || !competitorId) continue;
        upsertSubmission(db, { roundId, competitorId, spotifyUri: s.spotifyUri, title: s.title, album: s.album, artists: s.artists, comment: s.comment, createdAt: s.createdAt, visibleToVoters: s.visibleToVoters });
        sc++;
      }
      for (const v of parsed.votes) {
        const roundId = rMap.get(v.roundId), voterId = cMap.get(v.voterId);
        if (!roundId || !voterId) continue;
        upsertVote(db, { roundId, voterId, spotifyUri: v.spotifyUri, points: v.points, comment: v.comment, createdAt: v.createdAt });
        vc++;
      }
    })();
    return { roundsCount: rc, submissionsCount: sc, votesCount: vc, status: 'success' };
  } catch (err) {
    return { roundsCount: rc, submissionsCount: sc, votesCount: vc, status: 'error', error: String(err) };
  }
}
