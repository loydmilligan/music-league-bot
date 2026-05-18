import Database from 'better-sqlite3';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { classifyIntent, type Intent } from '../bot/intentClassifier.js';

let _db: Database.Database | null = null;

function getChatLeagueDb(): Database.Database | null {
  if (_db) return _db;
  const path = resolve(process.env.DATA_DIR ?? 'data', 'league.db');
  try {
    _db = new Database(path);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
    _db.exec(`
      CREATE TABLE IF NOT EXISTS chat_songs (
        id TEXT PRIMARY KEY, spotify_uri TEXT NOT NULL UNIQUE,
        artist TEXT NOT NULL, title TEXT NOT NULL, album TEXT,
        year INTEGER, duration_sec INTEGER, album_art_url TEXT,
        dismissed INTEGER NOT NULL DEFAULT 0,
        first_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      );
      CREATE TABLE IF NOT EXISTS chat_mentions (
        id TEXT PRIMARY KEY, song_id TEXT NOT NULL REFERENCES chat_songs(id) ON DELETE CASCADE,
        chat_name TEXT NOT NULL, sender_name TEXT NOT NULL, captured_at TEXT NOT NULL,
        raw_message TEXT NOT NULL, prior_messages TEXT NOT NULL DEFAULT '[]',
        intent TEXT NOT NULL DEFAULT 'unclassified'
      );
      CREATE TABLE IF NOT EXISTS chat_assignments (
        chat_song_id TEXT NOT NULL REFERENCES chat_songs(id) ON DELETE CASCADE,
        round_id INTEGER NOT NULL, assigned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
        PRIMARY KEY (chat_song_id, round_id)
      );
    `);
    return _db;
  } catch (err) {
    console.error('[chatDb] Could not open league.db:', err);
    return null;
  }
}

function autoAssignRoundId(db: Database.Database, capturedAt: string): number | null {
  const ts = Date.parse(capturedAt);

  const voting = db.prepare(`
    SELECT id FROM rounds
    WHERE submission_deadline IS NOT NULL
    AND voting_deadline IS NOT NULL
    AND datetime(submission_deadline) < datetime(?)
    AND datetime(?) <= datetime(voting_deadline)
    ORDER BY voting_deadline ASC
    LIMIT 1
  `).get(capturedAt, capturedAt) as { id: number } | undefined;
  if (voting) return voting.id;

  const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
  const recent = db.prepare(`
    SELECT id, voting_deadline FROM rounds
    WHERE voting_deadline IS NOT NULL
    AND datetime(voting_deadline) < datetime(?)
    ORDER BY voting_deadline DESC
    LIMIT 1
  `).get(capturedAt) as { id: number; voting_deadline: string } | undefined;

  if (recent) {
    const gap = ts - Date.parse(recent.voting_deadline);
    if (gap <= TWO_HOURS_MS) return recent.id;
  }

  return null;
}

export interface ChatCaptureInput {
  spotifyUri: string;
  title: string;
  artist: string;
  album?: string | null;
  albumArtUrl?: string | null;
  year?: number | null;
  durationSec?: number | null;
  chatName: string;
  senderName: string;
  capturedAt: string;
  rawMessage: string;
  priorMessages: Array<{ sender: string; timeMs: number; text: string }>;
}

export function insertChatCapture(input: ChatCaptureInput): void {
  const db = getChatLeagueDb();
  if (!db) return;

  const existing = db.prepare('SELECT id FROM chat_songs WHERE spotify_uri=?').get(input.spotifyUri) as { id: string } | undefined;
  let songId: string;
  if (existing) {
    songId = existing.id;
  } else {
    songId = randomUUID();
    db.prepare(`INSERT INTO chat_songs (id, spotify_uri, title, artist, album, album_art_url, year, duration_sec)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(songId, input.spotifyUri, input.title, input.artist,
        input.album ?? null, input.albumArtUrl ?? null, input.year ?? null, input.durationSec ?? null);
  }

  const lastPrior = input.priorMessages.at(-1)?.text;
  const intent: Intent = classifyIntent(input.rawMessage, lastPrior);

  const mentionId = randomUUID();
  db.prepare(`INSERT INTO chat_mentions (id, song_id, chat_name, sender_name, captured_at, raw_message, prior_messages, intent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(mentionId, songId, input.chatName, input.senderName, input.capturedAt,
      input.rawMessage, JSON.stringify(input.priorMessages), intent);

  const roundId = autoAssignRoundId(db, input.capturedAt);
  if (roundId) {
    db.prepare(`INSERT OR IGNORE INTO chat_assignments (chat_song_id, round_id) VALUES (?, ?)`).run(songId, roundId);
    const song = db.prepare('SELECT * FROM chat_songs WHERE id=?').get(songId) as any;
    if (song) {
      db.prepare(`INSERT OR IGNORE INTO research_songs (round_id, spotify_uri, title, artist, album, added_at)
        VALUES (?, ?, ?, ?, ?, ?)`)
        .run(roundId, song.spotify_uri, song.title, song.artist, song.album ?? null, input.capturedAt);
    }
  }
}
