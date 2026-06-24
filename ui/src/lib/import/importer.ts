import type Database from 'better-sqlite3';
import type { ParsedZip } from './zipParser.js';
import { getLeagueBySlug, upsertSeason } from '../db/leagues.js';
import { getCurrentRoundForSeason, upsertRound, upsertRoundWithDeadlines } from '../db/rounds.js';
import { upsertCompetitor, upsertSubmission, upsertVote } from '../db/submissions.js';
import { enqueueMany } from '../db/metadataQueue.js';

export interface ImportResult { roundsCount: number; submissionsCount: number; votesCount: number; status: 'success'|'partial'|'error'; error?: string; }

export interface LiveRoundSnapshot {
  id: string;
  number: number;
  name: string;
  description?: string | null;
  playlistUrl?: string | null;
  submissionsDueUtc?: string | null;
  votesDueUtc?: string | null;
}

function inferSeasonStatus(db: Database.Database, leagueId: number, seasonNumber: number, parsed: ParsedZip): 'active' | 'complete' {
  const existing = db.prepare(
    'SELECT status FROM seasons WHERE league_id = ? AND season_number = ?',
  ).get(leagueId, seasonNumber) as { status: 'active' | 'complete' } | undefined;
  if (existing?.status === 'active') return 'active';

  if (parsed.rounds.length === 0) return 'active';
  const votedRounds = new Set(parsed.votes.map((v) => v.roundId));
  return parsed.rounds.every((r) => votedRounds.has(r.id)) ? 'complete' : 'active';
}

export interface ImportZipOptions {
  /** When true, also enqueue 'audio' job type after import. */
  autoAnalyzeAudio?: boolean;
}

export function importZipData(db: Database.Database, leagueSlug: string, seasonNumber: number, parsed: ParsedZip, opts: ImportZipOptions = {}): ImportResult {
  const league = getLeagueBySlug(db, leagueSlug);
  if (!league) return { roundsCount: 0, submissionsCount: 0, votesCount: 0, status: 'error', error: `Unknown league: ${leagueSlug}` };
  let rc = 0, sc = 0, vc = 0;
  const newUris: string[] = [];
  try {
    db.transaction(() => {
      const status = inferSeasonStatus(db, league.id, seasonNumber, parsed);
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
        newUris.push(s.spotifyUri);
        sc++;
      }
      for (const v of parsed.votes) {
        const roundId = rMap.get(v.roundId), voterId = cMap.get(v.voterId);
        if (!roundId || !voterId) continue;
        upsertVote(db, { roundId, voterId, spotifyUri: v.spotifyUri, points: v.points, comment: v.comment, createdAt: v.createdAt });
        vc++;
      }
    })();
    // Enqueue metadata jobs for all submission URIs (idempotent via INSERT OR IGNORE).
    if (newUris.length > 0) {
      enqueueMany(db, newUris, ['ytm', 'lastfm_pop', 'lastfm_tags', 'lyrics']);
      if (opts.autoAnalyzeAudio) {
        enqueueMany(db, newUris, ['audio']);
      }
    }
    return { roundsCount: rc, submissionsCount: sc, votesCount: vc, status: 'success' };
  } catch (err) {
    return { roundsCount: rc, submissionsCount: sc, votesCount: vc, status: 'error', error: String(err) };
  }
}

export function importLiveRoundsData(
  db: Database.Database,
  leagueSlug: string,
  seasonNumber: number,
  liveRounds: LiveRoundSnapshot[],
): ImportResult {
  const league = getLeagueBySlug(db, leagueSlug);
  if (!league) return { roundsCount: 0, submissionsCount: 0, votesCount: 0, status: 'error', error: `Unknown league: ${leagueSlug}` };

  let rc = 0;
  try {
    db.transaction(() => {
      const seasonId = upsertSeason(db, league.id, seasonNumber, 'active');
      for (const r of [...liveRounds].sort((a, b) => a.number - b.number)) {
        if (!r.id || !Number.isFinite(r.number)) continue;
        upsertRoundWithDeadlines(db, seasonId, {
          mlRoundId: r.id,
          name: r.name,
          description: r.description ?? '',
          spotifyPlaylistUrl: r.playlistUrl ?? null,
          submissionDeadline: r.submissionsDueUtc ?? null,
          votingDeadline: r.votesDueUtc ?? null,
          createdAt: new Date().toISOString(),
        });
        rc++;
      }

      const current = getCurrentRoundForSeason(db, seasonId);
      const status: 'active' | 'complete' =
        current && current.phase !== 'archive' ? 'active' : 'complete';
      upsertSeason(db, league.id, seasonNumber, status);
    })();
    return { roundsCount: rc, submissionsCount: 0, votesCount: 0, status: 'success' };
  } catch (err) {
    return { roundsCount: rc, submissionsCount: 0, votesCount: 0, status: 'error', error: String(err) };
  }
}
