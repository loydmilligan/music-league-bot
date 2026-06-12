import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openLeagueDb } from '../db/client.js';
import {
  addShortlistSong, getShortlistSongs,
  deleteShortlistSongById, deleteShortlistSongByUri,
  patchShortlistRating, patchShortlistNotes,
  patchSubmittedElsewhere, assignToRound, unassignFromRound,
  getOpenRounds,
} from './shortlist.js';
import { unlinkSync, existsSync } from 'node:fs';
import type Database from 'better-sqlite3';

const TMP = '/tmp/test-shortlist.db';
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

beforeEach(() => {
  cleanup();
  db = openLeagueDb(TMP);
});
afterEach(cleanup);

describe('addShortlistSong', () => {
  it('inserts a new song and returns it', () => {
    const s = addShortlistSong(db, { spotifyUri: 'spotify:track:abc', title: 'Song A', artist: 'Artist X' });
    expect(s.spotifyUri).toBe('spotify:track:abc');
    expect(s.title).toBe('Song A');
    expect(s.ratingDiscovery).toBe(0);
    expect(s.submittedElsewhere).toBe(false);
    expect(s.assignments).toEqual([]);
  });

  it('is idempotent — duplicate URI returns existing row without throwing', () => {
    addShortlistSong(db, { spotifyUri: 'spotify:track:abc', title: 'Song A', artist: 'Artist X' });
    expect(() => addShortlistSong(db, { spotifyUri: 'spotify:track:abc', title: 'Song A again', artist: 'X' })).not.toThrow();
    expect(getShortlistSongs(db)).toHaveLength(1);
  });
});

describe('getShortlistSongs', () => {
  it('returns songs in descending added_at order', () => {
    addShortlistSong(db, { spotifyUri: 'spotify:track:a1', title: 'First', artist: 'A' });
    // Force an earlier timestamp on the first song so ordering is deterministic
    db.prepare("UPDATE shortlist_songs SET added_at='2026-01-01T00:00:00Z' WHERE spotify_uri='spotify:track:a1'").run();
    addShortlistSong(db, { spotifyUri: 'spotify:track:a2', title: 'Second', artist: 'B' });
    db.prepare("UPDATE shortlist_songs SET added_at='2026-01-02T00:00:00Z' WHERE spotify_uri='spotify:track:a2'").run();
    const songs = getShortlistSongs(db);
    expect(songs[0].title).toBe('Second');
    expect(songs[1].title).toBe('First');
  });
});

describe('deleteShortlistSongById', () => {
  it('removes the song', () => {
    const s = addShortlistSong(db, { spotifyUri: 'spotify:track:del', title: 'D', artist: 'X' });
    deleteShortlistSongById(db, s.id);
    expect(getShortlistSongs(db)).toHaveLength(0);
  });
});

describe('deleteShortlistSongByUri', () => {
  it('removes the song by URI', () => {
    addShortlistSong(db, { spotifyUri: 'spotify:track:del2', title: 'D2', artist: 'X' });
    deleteShortlistSongByUri(db, 'spotify:track:del2');
    expect(getShortlistSongs(db)).toHaveLength(0);
  });
});

describe('patchShortlistRating', () => {
  it('updates the given dimension', () => {
    const s = addShortlistSong(db, { spotifyUri: 'spotify:track:rate', title: 'R', artist: 'X' });
    patchShortlistRating(db, s.id, 'discovery', 4);
    const updated = getShortlistSongs(db).find(x => x.id === s.id)!;
    expect(updated.ratingDiscovery).toBe(4);
    expect(updated.ratingThemeFit).toBe(0);
  });
});

describe('patchShortlistNotes', () => {
  it('updates notes', () => {
    const s = addShortlistSong(db, { spotifyUri: 'spotify:track:note', title: 'N', artist: 'X' });
    patchShortlistNotes(db, s.id, 'great vibe');
    expect(getShortlistSongs(db).find(x => x.id === s.id)!.notes).toBe('great vibe');
  });
});

describe('patchSubmittedElsewhere', () => {
  it('toggles the flag', () => {
    const s = addShortlistSong(db, { spotifyUri: 'spotify:track:sub', title: 'S', artist: 'X' });
    patchSubmittedElsewhere(db, s.id, true);
    expect(getShortlistSongs(db).find(x => x.id === s.id)!.submittedElsewhere).toBe(true);
    patchSubmittedElsewhere(db, s.id, false);
    expect(getShortlistSongs(db).find(x => x.id === s.id)!.submittedElsewhere).toBe(false);
  });
});

describe('getOpenRounds', () => {
  it('returns the active round for each derived-active league', () => {
    db.exec(`
      INSERT OR IGNORE INTO leagues (id, slug, name, is_active) VALUES (1, 'league-a', 'League A', 0);
      INSERT OR IGNORE INTO leagues (id, slug, name, is_active) VALUES (2, 'league-b', 'League B', 0);
      INSERT OR IGNORE INTO seasons (id, league_id, season_number, status) VALUES (1, 1, 1, 'active');
      INSERT OR IGNORE INTO seasons (id, league_id, season_number, status) VALUES (2, 2, 1, 'active');
      INSERT OR IGNORE INTO rounds (id, season_id, ml_round_id, name, description, submission_deadline, created_at)
        VALUES (10, 1, 'rA', 'Round A', 'Theme A', NULL, '2026-01-01T00:00:00Z');
      INSERT OR IGNORE INTO rounds (id, season_id, ml_round_id, name, description, submission_deadline, created_at)
        VALUES (20, 2, 'rB', 'Round B', 'Theme B', NULL, '2026-01-01T00:00:00Z');
      UPDATE leagues SET active_round_id = 10 WHERE id = 1;
      UPDATE leagues SET active_round_id = 20 WHERE id = 2;
    `);
    const rounds = getOpenRounds(db);
    const leagueNames = rounds.map(r => r.leagueName).sort();
    expect(leagueNames).toEqual(['League A', 'League B']);
  });

  it('omits leagues with no derived active season (is_active=0 and no active season)', () => {
    // All rounds have past deadlines → archive phase → seasonHasLiveRound=false
    db.exec(`
      INSERT OR IGNORE INTO leagues (id, slug, name, is_active) VALUES (1, 'inactive', 'Inactive', 0);
      INSERT OR IGNORE INTO seasons (id, league_id, season_number, status) VALUES (1, 1, 1, 'complete');
      INSERT OR IGNORE INTO rounds (id, season_id, ml_round_id, name, description, submission_deadline, voting_deadline, created_at)
        VALUES (10, 1, 'rX', 'Round X', 'Theme X', '2020-01-01T00:00:00Z', '2020-01-07T00:00:00Z', '2020-01-01T00:00:00Z');
    `);
    expect(getOpenRounds(db)).toHaveLength(0);
  });
});

describe('assignToRound / unassignFromRound', () => {
  it('assigns a song to a round and mirrors into research_songs', () => {
    seedRound(db);
    const s = addShortlistSong(db, { spotifyUri: 'spotify:track:asgn', title: 'A', artist: 'X' });
    assignToRound(db, s.id, 1);
    const songs = getShortlistSongs(db);
    expect(songs[0].assignments).toHaveLength(1);
    expect(songs[0].assignments![0].roundId).toBe(1);
    const research = db.prepare("SELECT * FROM research_songs WHERE round_id=1 AND spotify_uri='spotify:track:asgn'").get();
    expect(research).toBeTruthy();
  });

  it('unassigns a song', () => {
    seedRound(db);
    const s = addShortlistSong(db, { spotifyUri: 'spotify:track:unasgn', title: 'U', artist: 'X' });
    assignToRound(db, s.id, 1);
    unassignFromRound(db, s.id, 1);
    expect(getShortlistSongs(db)[0].assignments).toHaveLength(0);
  });
});
