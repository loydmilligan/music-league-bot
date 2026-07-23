import { it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA } from '../db/schema.js';
import { buildLabData } from './labData.js';
import { saveBallotEntry, setRoundBudget } from './ballotDb.js';

function dbWithRound() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare(`INSERT INTO leagues (id, slug, name) VALUES (1, 'test', 'Test')`).run();
  db.prepare(`INSERT INTO seasons (id, league_id, season_number, status) VALUES (10, 1, 1, 'active')`).run();
  db.prepare(
    `INSERT INTO rounds (id, season_id, ml_round_id, name, description, created_at, phase)
     VALUES (100, 10, 'ml-100', 'Songs in a language other than English', 'Non-English only', '2026-07-01T00:00:00Z', 'voting')`,
  ).run();
  db.prepare(
    `INSERT INTO ml_submissions (round_id, spotify_uri, title, artists, album, album_art_url, visible_to_voters, created_at)
     VALUES (100, 'spotify:track:a', 'Song A', 'Artist A', 'Album A', 'http://art/a.jpg', 1, '2026-07-01T00:00:00Z')`,
  ).run();
  db.prepare(
    `INSERT INTO ml_submissions (round_id, spotify_uri, title, artists, album, album_art_url, visible_to_voters, created_at)
     VALUES (100, 'spotify:track:b', 'Song B', 'Artist B', 'Album B', NULL, 1, '2026-07-01T00:00:00Z')`,
  ).run();
  return db;
}

it('returns one row per submitted song with theme info', () => {
  const db = dbWithRound();
  const data = buildLabData(db, 100);
  expect(data.roundId).toBe(100);
  expect(data.themeName).toBe('Songs in a language other than English');
  expect(data.themeDescription).toBe('Non-English only');
  expect(data.rows).toHaveLength(2);
  expect(data.rows[0].song.title).toBe('Song A');
  expect(data.rows[0].song.artist).toBe('Artist A');
  db.close();
});

it('defaults every song to an empty ballot entry', () => {
  const db = dbWithRound();
  const row = buildLabData(db, 100).rows[0];
  expect(row.ballot.upPoints).toBe(0);
  expect(row.ballot.downPoints).toBe(0);
  expect(row.ballot.notes).toBe('');
  expect(row.ballot.isMine).toBe(false);
  db.close();
});

it('merges saved ballot entries onto the right song', () => {
  const db = dbWithRound();
  saveBallotEntry(db, 100, {
    spotifyUri: 'spotify:track:b', upPoints: 3, downPoints: 0, rating: 5,
    notes: 'banger', draftComment: '', isMine: false,
  });
  const rows = buildLabData(db, 100).rows;
  const b = rows.find((r) => r.song.spotifyUri === 'spotify:track:b')!;
  const a = rows.find((r) => r.song.spotifyUri === 'spotify:track:a')!;
  expect(b.ballot.upPoints).toBe(3);
  expect(b.ballot.notes).toBe('banger');
  expect(a.ballot.upPoints).toBe(0);
  db.close();
});

it('includes the resolved budget and its source', () => {
  const db = dbWithRound();
  setRoundBudget(db, 100, { upTotal: 6, downTotal: 2, perSongCap: 3 });
  const data = buildLabData(db, 100);
  expect(data.budget).toEqual({ upTotal: 6, downTotal: 2, perSongCap: 3 });
  expect(data.budgetSource).toBe('round');
  db.close();
});

it('surfaces song metadata when present', () => {
  const db = dbWithRound();
  db.prepare(
    `INSERT INTO song_popularity (spotify_uri, artist, title, listeners, spotify_popularity, tags, fetched_at)
     VALUES ('spotify:track:a', 'Artist A', 'Song A', 12345, 42, 'shoegaze, dream pop', '2026-07-01T00:00:00Z')`,
  ).run();
  db.prepare(
    `INSERT INTO song_audio_features (spotify_uri, bpm, key, scale, energy, duration_s)
     VALUES ('spotify:track:a', 128, 'C', 'major', 0.7, 200)`,
  ).run();
  db.prepare(
    `INSERT INTO song_lyrics_metrics (spotify_uri, has_lyrics, fetched_at) VALUES ('spotify:track:a', 1, '2026-07-01T00:00:00Z')`,
  ).run();
  const a = buildLabData(db, 100).rows.find((r) => r.song.spotifyUri === 'spotify:track:a')!;
  expect(a.song.listeners).toBe(12345);
  expect(a.song.spotifyPopularity).toBe(42);
  expect(a.song.bpm).toBe(128);
  expect(a.song.energy).toBeCloseTo(0.7);
  expect(a.song.hasLyrics).toBe(true);
  expect(a.song.tags).toEqual(['shoegaze', 'dream pop']);
  db.close();
});

it('gives duplicate submissions of the same track distinct submission ids', () => {
  const db = dbWithRound();
  // Two different competitors may legitimately submit the SAME track in one round.
  db.prepare(
    `INSERT INTO competitors (id, ml_competitor_id, name) VALUES (999, 'ml-999', 'Other Competitor')`,
  ).run();
  db.prepare(
    `INSERT INTO ml_submissions (round_id, competitor_id, spotify_uri, title, artists, album, album_art_url, visible_to_voters, created_at)
     VALUES (100, 999, 'spotify:track:a', 'Song A', 'Artist A', 'Album A', 'http://art/a.jpg', 1, '2026-07-01T00:00:00Z')`,
  ).run();
  const rows = buildLabData(db, 100).rows;
  const dupes = rows.filter((r) => r.song.spotifyUri === 'spotify:track:a');
  expect(dupes.length).toBe(2);
  const ids = dupes.map((r) => r.song.submissionId);
  expect(new Set(ids).size).toBe(2); // keys must be unique -> no each_key_duplicate
  db.close();
});

it('throws for an unknown round', () => {
  const db = dbWithRound();
  expect(() => buildLabData(db, 999)).toThrow();
  db.close();
});

it('preserves the hasLyrics tri-state (true / false / null)', () => {
  const db = dbWithRound();
  // track:a has lyrics; track:b is instrumental.
  db.prepare(
    `INSERT INTO song_lyrics_metrics (spotify_uri, has_lyrics, fetched_at) VALUES ('spotify:track:a', 1, '2026-07-01T00:00:00Z')`,
  ).run();
  db.prepare(
    `INSERT INTO song_lyrics_metrics (spotify_uri, has_lyrics, fetched_at) VALUES ('spotify:track:b', 0, '2026-07-01T00:00:00Z')`,
  ).run();
  const rows = buildLabData(db, 100).rows;
  expect(rows.find((r) => r.song.spotifyUri === 'spotify:track:a')!.song.hasLyrics).toBe(true);
  expect(rows.find((r) => r.song.spotifyUri === 'spotify:track:b')!.song.hasLyrics).toBe(false);
  db.close();
});

it('reports hasLyrics as null when a song has no lyrics row at all', () => {
  const db = dbWithRound();
  // Neither song has a song_lyrics_metrics row -> unknown, NOT false.
  const rows = buildLabData(db, 100).rows;
  expect(rows[0].song.hasLyrics).toBeNull();
  expect(rows[1].song.hasLyrics).toBeNull();
  // Also verify tags default to empty array when there's no song_popularity row.
  expect(rows[1].song.tags).toEqual([]);
  db.close();
});
