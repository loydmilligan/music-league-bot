import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

export interface ChatSong {
  id: string;
  spotifyUri: string;
  artist: string;
  title: string;
  album: string | null;
  year: number | null;
  durationSec: number | null;
  albumArtUrl: string | null;
  dismissed: boolean;
  firstSeenAt: string;
  mentionCount: number;
  latestMentionAt: string;
  chatNames: string[];
  assignedRoundIds: number[];
  onShortlist: boolean;
  mentions?: ChatMention[];
}

export interface ChatMention {
  id: string;
  songId: string;
  chatName: string;
  senderName: string;
  capturedAt: string;
  rawMessage: string;
  priorMessages: PriorMessage[];
  intent: Intent;
}

export type Intent = 'alt' | 'retro' | 'found' | 'maybe' | 'unclassified';

export interface PriorMessage {
  sender: string;
  timeMs: number;
  text: string;
}

function songRow(r: any, mentions: ChatMention[], assignedRoundIds: number[], onShortlist: boolean): ChatSong {
  return {
    id: r.id,
    spotifyUri: r.spotify_uri,
    artist: r.artist,
    title: r.title,
    album: r.album,
    year: r.year,
    durationSec: r.duration_sec,
    albumArtUrl: r.album_art_url,
    dismissed: !!r.dismissed,
    firstSeenAt: r.first_seen_at,
    mentionCount: mentions.length,
    latestMentionAt: mentions.length > 0 ? mentions[mentions.length - 1].capturedAt : r.first_seen_at,
    chatNames: [...new Set(mentions.map(m => m.chatName))],
    assignedRoundIds,
    onShortlist,
  };
}

function mentionRow(r: any): ChatMention {
  return {
    id: r.id,
    songId: r.song_id,
    chatName: r.chat_name,
    senderName: r.sender_name,
    capturedAt: r.captured_at,
    rawMessage: r.raw_message,
    priorMessages: JSON.parse(r.prior_messages ?? '[]'),
    intent: r.intent as Intent,
  };
}

export interface ChatSongsFilter {
  status?: 'unassigned' | 'assigned';
  chatName?: string;
  sort?: 'recent' | 'mentioned';
  includeDismissed?: boolean;
}

export function getChatSongs(db: Database.Database, filter: ChatSongsFilter = {}): ChatSong[] {
  let where = filter.includeDismissed ? '' : 'WHERE cs.dismissed = 0';
  if (filter.status === 'unassigned') {
    where += (where ? ' AND' : 'WHERE') + ' NOT EXISTS (SELECT 1 FROM chat_assignments ca WHERE ca.chat_song_id = cs.id)';
  } else if (filter.status === 'assigned') {
    where += (where ? ' AND' : 'WHERE') + ' EXISTS (SELECT 1 FROM chat_assignments ca WHERE ca.chat_song_id = cs.id)';
  }

  const order = filter.sort === 'mentioned'
    ? 'ORDER BY mention_count DESC, latest_at DESC'
    : 'ORDER BY latest_at DESC';

  const rows = db.prepare(`
    SELECT cs.*,
      COUNT(cm.id) AS mention_count,
      MAX(cm.captured_at) AS latest_at
    FROM chat_songs cs
    LEFT JOIN chat_mentions cm ON cm.song_id = cs.id
    ${where}
    GROUP BY cs.id
    ${order}
  `).all() as any[];

  if (rows.length === 0) return [];

  const allMentions = (db.prepare('SELECT * FROM chat_mentions ORDER BY captured_at ASC').all() as any[]).map(mentionRow);
  const allAssignments = db.prepare('SELECT * FROM chat_assignments').all() as any[];
  const shortlistUris = new Set(
    (db.prepare('SELECT spotify_uri FROM shortlist_songs').all() as any[]).map((r: any) => r.spotify_uri)
  );

  const mentionsBySong: Record<string, ChatMention[]> = {};
  for (const m of allMentions) {
    (mentionsBySong[m.songId] ??= []).push(m);
  }
  const assignmentsBySong: Record<string, number[]> = {};
  for (const a of allAssignments) {
    (assignmentsBySong[a.chat_song_id] ??= []).push(a.round_id);
  }

  let result = rows.map(r => songRow(
    r,
    mentionsBySong[r.id] ?? [],
    assignmentsBySong[r.id] ?? [],
    shortlistUris.has(r.spotify_uri),
  ));

  if (filter.chatName) {
    result = result.filter(s => s.chatNames.includes(filter.chatName!));
  }

  return result;
}

export function getChatSongById(db: Database.Database, id: string): ChatSong | null {
  const r = db.prepare('SELECT * FROM chat_songs WHERE id=?').get(id) as any;
  if (!r) return null;
  const mentions = (db.prepare('SELECT * FROM chat_mentions WHERE song_id=? ORDER BY captured_at ASC').all(id) as any[]).map(mentionRow);
  const assignedRoundIds = (db.prepare('SELECT round_id FROM chat_assignments WHERE chat_song_id=?').all(id) as any[]).map((a: any) => a.round_id);
  const onShortlist = !!(db.prepare('SELECT 1 FROM shortlist_songs WHERE spotify_uri=?').get(r.spotify_uri));
  return { ...songRow(r, mentions, assignedRoundIds, onShortlist), mentions };
}

export function upsertChatSong(db: Database.Database, s: {
  spotifyUri: string; title: string; artist: string;
  album?: string | null; albumArtUrl?: string | null;
  year?: number | null; durationSec?: number | null;
}): string {
  const existing = db.prepare('SELECT id FROM chat_songs WHERE spotify_uri=?').get(s.spotifyUri) as any;
  if (existing) return existing.id;
  const id = randomUUID();
  db.prepare(`INSERT INTO chat_songs (id, spotify_uri, title, artist, album, album_art_url, year, duration_sec)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, s.spotifyUri, s.title, s.artist, s.album ?? null, s.albumArtUrl ?? null, s.year ?? null, s.durationSec ?? null);
  return id;
}

export function insertChatMention(db: Database.Database, m: {
  songId: string; chatName: string; senderName: string;
  capturedAt: string; rawMessage: string;
  priorMessages: PriorMessage[]; intent: Intent;
}): string {
  const id = randomUUID();
  db.prepare(`INSERT INTO chat_mentions (id, song_id, chat_name, sender_name, captured_at, raw_message, prior_messages, intent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, m.songId, m.chatName, m.senderName, m.capturedAt, m.rawMessage,
      JSON.stringify(m.priorMessages), m.intent);
  return id;
}

export function setChatSongDismissed(db: Database.Database, id: string, dismissed: boolean): void {
  db.prepare('UPDATE chat_songs SET dismissed=? WHERE id=?').run(dismissed ? 1 : 0, id);
}

export function assignChatSongToRound(db: Database.Database, chatSongId: string, roundId: number): void {
  db.prepare(`INSERT OR IGNORE INTO chat_assignments (chat_song_id, round_id) VALUES (?, ?)`)
    .run(chatSongId, roundId);
  const song = db.prepare('SELECT * FROM chat_songs WHERE id=?').get(chatSongId) as any;
  if (song) {
    db.prepare(`INSERT OR IGNORE INTO research_songs (round_id, spotify_uri, title, artist, album, added_at)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run(roundId, song.spotify_uri, song.title, song.artist, song.album ?? null, new Date().toISOString());
  }
}

export function unassignChatSongFromRound(db: Database.Database, chatSongId: string, roundId: number): void {
  db.prepare('DELETE FROM chat_assignments WHERE chat_song_id=? AND round_id=?').run(chatSongId, roundId);
}

export function getDistinctChatNames(db: Database.Database): string[] {
  return (db.prepare('SELECT DISTINCT chat_name FROM chat_mentions ORDER BY chat_name').all() as any[]).map(r => r.chat_name);
}

export function getUnassignedNotDismissedCount(db: Database.Database): number {
  const r = db.prepare(`
    SELECT COUNT(*) AS n FROM chat_songs cs
    WHERE cs.dismissed = 0
    AND NOT EXISTS (SELECT 1 FROM chat_assignments ca WHERE ca.chat_song_id = cs.id)
  `).get() as any;
  return r.n;
}
