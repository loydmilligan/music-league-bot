import type Database from 'better-sqlite3';
import type { ResolvedTrack } from '../music/types.js';

export type SubmissionStatus = 'added' | 'duplicate' | 'not-found' | 'low-confidence' | 'no-rule';

export interface SubmissionRecord {
  submitterId: string;
  submitterName: string;
  rawText: string;
  track?: ResolvedTrack | null;
  playlistId?: string | null;
  playlistName?: string | null;
  status: SubmissionStatus;
  sourcePlatform?: string | null;
  sourceUrl?: string | null;
}

export function insertSubmission(db: Database.Database, record: SubmissionRecord): void {
  db.prepare(`
    INSERT INTO submissions
      (submitter_id, submitter_name, raw_text, track_title, track_artist,
       spotify_uri, playlist_id, playlist_name, status, created_at,
       source_platform, source_url)
    VALUES
      (@submitterId, @submitterName, @rawText, @trackTitle, @trackArtist,
       @spotifyUri, @playlistId, @playlistName, @status, @createdAt,
       @sourcePlatform, @sourceUrl)
  `).run({
    submitterId: record.submitterId,
    submitterName: record.submitterName,
    rawText: record.rawText,
    trackTitle: record.track?.title ?? null,
    trackArtist: record.track?.artist ?? null,
    spotifyUri: record.track?.spotifyUri ?? null,
    playlistId: record.playlistId ?? null,
    playlistName: record.playlistName ?? null,
    status: record.status,
    createdAt: Date.now(),
    sourcePlatform: record.sourcePlatform ?? null,
    sourceUrl: record.sourceUrl ?? null,
  });
}
