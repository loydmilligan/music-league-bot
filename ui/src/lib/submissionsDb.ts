import Database from 'better-sqlite3';
import { resolve } from 'node:path';

let _db: Database.Database | null = null;

export function getSubmissionsDb(): Database.Database | null {
  if (_db) return _db;
  const path = resolve(process.env.DATA_DIR ?? 'data', 'submissions.db');
  try { _db = new Database(path, { readonly: true }); return _db; }
  catch { return null; }
}

export interface ChatMention {
  id: number; trackTitle: string | null; trackArtist: string | null;
  spotifyUri: string | null; submitterName: string; sourcePlatform: string | null;
  sourceUrl: string | null; createdAt: number;
}

export function getChatMentionsBetween(fromMs: number, toMs: number): ChatMention[] {
  const db = getSubmissionsDb();
  if (!db) return [];
  return (db.prepare(`SELECT id,track_title,track_artist,spotify_uri,submitter_name,source_platform,source_url,created_at
    FROM submissions WHERE created_at>=? AND created_at<? AND status IN ('added','duplicate') ORDER BY created_at`)
    .all(fromMs, toMs) as any[]).map(r => ({
    id: r.id, trackTitle: r.track_title, trackArtist: r.track_artist, spotifyUri: r.spotify_uri,
    submitterName: r.submitter_name, sourcePlatform: r.source_platform, sourceUrl: r.source_url, createdAt: r.created_at,
  }));
}

export function getAllMentions(): ChatMention[] {
  const db = getSubmissionsDb();
  if (!db) return [];
  return (db.prepare(`SELECT id,track_title,track_artist,spotify_uri,submitter_name,source_platform,source_url,created_at
    FROM submissions WHERE status IN ('added','duplicate') ORDER BY created_at DESC`).all() as any[]).map(r => ({
    id: r.id, trackTitle: r.track_title, trackArtist: r.track_artist, spotifyUri: r.spotify_uri,
    submitterName: r.submitter_name, sourcePlatform: r.source_platform, sourceUrl: r.source_url, createdAt: r.created_at,
  }));
}
