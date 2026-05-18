import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openLeagueDb } from '../db/client.js';
import {
  upsertChatSong, insertChatMention, getChatSongs, getChatSongById,
  setChatSongDismissed, assignChatSongToRound, unassignChatSongFromRound,
  getDistinctChatNames, getUnassignedNotDismissedCount,
} from './chat.js';
import { unlinkSync, existsSync } from 'node:fs';
import type Database from 'better-sqlite3';

const TMP = '/tmp/test-chat-watcher.db';
let db: Database.Database;

function cleanup() {
  if (db) { try { db.close(); } catch {} }
  for (const s of ['', '-wal', '-shm']) {
    const p = `${TMP}${s}`;
    if (existsSync(p)) unlinkSync(p);
  }
}

function seedRound(db: Database.Database): number {
  db.exec(`
    INSERT OR IGNORE INTO leagues (id, slug, name) VALUES (1, 'test', 'Test League');
    INSERT OR IGNORE INTO seasons (id, league_id, season_number, status) VALUES (1, 1, 1, 'active');
    INSERT OR IGNORE INTO rounds (id, season_id, ml_round_id, name, description, spotify_playlist_url, created_at)
      VALUES (1, 1, 'r1', 'Round 1', null, null, '2026-01-01T00:00:00Z');
  `);
  return 1;
}

beforeEach(() => { cleanup(); db = openLeagueDb(TMP); });
afterEach(cleanup);

describe('upsertChatSong', () => {
  it('inserts a new song and returns its id', () => {
    const id = upsertChatSong(db, { spotifyUri: 'spotify:track:abc', title: 'Song A', artist: 'Artist X' });
    expect(id).toBeTypeOf('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('is idempotent — duplicate URI returns same id', () => {
    const id1 = upsertChatSong(db, { spotifyUri: 'spotify:track:abc', title: 'Song A', artist: 'X' });
    const id2 = upsertChatSong(db, { spotifyUri: 'spotify:track:abc', title: 'Song A again', artist: 'X' });
    expect(id1).toBe(id2);
  });
});

describe('insertChatMention', () => {
  it('inserts a mention and links it to the song', () => {
    const songId = upsertChatSong(db, { spotifyUri: 'spotify:track:m1', title: 'M', artist: 'X' });
    insertChatMention(db, {
      songId, chatName: 'Hip Jammers', senderName: 'Matt',
      capturedAt: '2026-05-01T20:00:00Z', rawMessage: 'check this https://open.spotify.com/track/m1',
      priorMessages: [{ sender: 'Kieran', timeMs: 1000, text: 'anyone?' }],
      intent: 'found',
    });
    const song = getChatSongById(db, songId)!;
    expect(song.mentions).toHaveLength(1);
    expect(song.mentions![0].senderName).toBe('Matt');
    expect(song.mentions![0].intent).toBe('found');
    expect(song.mentions![0].priorMessages).toHaveLength(1);
  });
});

describe('getChatSongs', () => {
  function seed() {
    const id1 = upsertChatSong(db, { spotifyUri: 'spotify:track:s1', title: 'First', artist: 'A' });
    const id2 = upsertChatSong(db, { spotifyUri: 'spotify:track:s2', title: 'Second', artist: 'B' });
    insertChatMention(db, { songId: id1, chatName: 'Hip Jammers', senderName: 'Matt',
      capturedAt: '2026-05-01T10:00:00Z', rawMessage: 'a', priorMessages: [], intent: 'found' });
    insertChatMention(db, { songId: id2, chatName: 'The Lads', senderName: 'Sam',
      capturedAt: '2026-05-02T10:00:00Z', rawMessage: 'b', priorMessages: [], intent: 'alt' });
    return { id1, id2 };
  }

  it('returns songs sorted by most recent mention by default', () => {
    const { } = seed();
    const songs = getChatSongs(db);
    expect(songs[0].title).toBe('Second');
    expect(songs[1].title).toBe('First');
  });

  it('filters by chat name', () => {
    seed();
    const songs = getChatSongs(db, { chatName: 'Hip Jammers' });
    expect(songs).toHaveLength(1);
    expect(songs[0].title).toBe('First');
  });

  it('filters unassigned', () => {
    seedRound(db);
    const { id1 } = seed();
    assignChatSongToRound(db, id1, 1);
    const unassigned = getChatSongs(db, { status: 'unassigned' });
    expect(unassigned.every(s => s.assignedRoundIds.length === 0)).toBe(true);
    expect(unassigned.find(s => s.title === 'First')).toBeUndefined();
  });

  it('excludes dismissed songs by default', () => {
    seed();
    const songs = getChatSongs(db);
    const id = songs[0].id;
    setChatSongDismissed(db, id, true);
    expect(getChatSongs(db)).toHaveLength(1);
    expect(getChatSongs(db, { includeDismissed: true })).toHaveLength(2);
  });
});

describe('assignChatSongToRound / unassign', () => {
  it('assigns and mirrors into research_songs', () => {
    seedRound(db);
    const id = upsertChatSong(db, { spotifyUri: 'spotify:track:asgn', title: 'Assign Me', artist: 'X' });
    insertChatMention(db, { songId: id, chatName: 'Hip Jammers', senderName: 'Matt',
      capturedAt: '2026-05-01T10:00:00Z', rawMessage: 'x', priorMessages: [], intent: 'maybe' });
    assignChatSongToRound(db, id, 1);
    const songs = getChatSongs(db);
    expect(songs[0].assignedRoundIds).toContain(1);
    const research = db.prepare("SELECT * FROM research_songs WHERE round_id=1 AND spotify_uri='spotify:track:asgn'").get();
    expect(research).toBeTruthy();
  });

  it('unassigns correctly', () => {
    seedRound(db);
    const id = upsertChatSong(db, { spotifyUri: 'spotify:track:u1', title: 'U', artist: 'X' });
    insertChatMention(db, { songId: id, chatName: 'Hip Jammers', senderName: 'Matt',
      capturedAt: '2026-05-01T10:00:00Z', rawMessage: 'x', priorMessages: [], intent: 'found' });
    assignChatSongToRound(db, id, 1);
    unassignChatSongFromRound(db, id, 1);
    expect(getChatSongs(db)[0].assignedRoundIds).toHaveLength(0);
  });
});

describe('getUnassignedNotDismissedCount', () => {
  it('counts correctly', () => {
    seedRound(db);
    const id1 = upsertChatSong(db, { spotifyUri: 'spotify:track:c1', title: 'C1', artist: 'X' });
    const id2 = upsertChatSong(db, { spotifyUri: 'spotify:track:c2', title: 'C2', artist: 'X' });
    insertChatMention(db, { songId: id1, chatName: 'Hip Jammers', senderName: 'Matt',
      capturedAt: '2026-05-01T10:00:00Z', rawMessage: 'x', priorMessages: [], intent: 'found' });
    insertChatMention(db, { songId: id2, chatName: 'Hip Jammers', senderName: 'Sam',
      capturedAt: '2026-05-01T11:00:00Z', rawMessage: 'y', priorMessages: [], intent: 'found' });
    expect(getUnassignedNotDismissedCount(db)).toBe(2);
    assignChatSongToRound(db, id1, 1);
    expect(getUnassignedNotDismissedCount(db)).toBe(1);
    setChatSongDismissed(db, id2, true);
    expect(getUnassignedNotDismissedCount(db)).toBe(0);
  });
});
