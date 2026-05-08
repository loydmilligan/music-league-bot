import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../src/storage/db.js';
import { insertSubmission } from '../src/storage/submissions.js';
import type Database from 'better-sqlite3';

const sampleTrack = {
  title: 'No Ordinary Love',
  artist: 'Sade',
  album: 'Love Deluxe',
  durationMs: 290000,
  spotifyTrackId: 'abc123',
  spotifyUri: 'spotify:track:abc123',
  sourceUrl: 'https://open.spotify.com/track/abc123',
  confidence: 1.0,
};

describe('storage', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDb(':memory:');
  });

  it('openDb creates the submissions table without error', () => {
    const result = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='submissions'`)
      .get() as { name: string } | undefined;
    expect(result).toBeDefined();
    expect(result?.name).toBe('submissions');
  });

  it('insertSubmission with status added and full track inserts a row with all fields', () => {
    insertSubmission(db, {
      submitterId: 'user1@c.us',
      submitterName: 'Alice',
      rawText: 'https://open.spotify.com/track/abc123',
      track: sampleTrack,
      playlistId: 'playlist123',
      playlistName: 'Music League',
      status: 'added',
    });

    const row = db
      .prepare('SELECT * FROM submissions WHERE submitter_id = ?')
      .get('user1@c.us') as Record<string, unknown> | undefined;

    expect(row).toBeDefined();
    expect(row?.submitter_id).toBe('user1@c.us');
    expect(row?.submitter_name).toBe('Alice');
    expect(row?.raw_text).toBe('https://open.spotify.com/track/abc123');
    expect(row?.track_title).toBe('No Ordinary Love');
    expect(row?.track_artist).toBe('Sade');
    expect(row?.spotify_uri).toBe('spotify:track:abc123');
    expect(row?.playlist_id).toBe('playlist123');
    expect(row?.playlist_name).toBe('Music League');
    expect(row?.status).toBe('added');
  });

  it('insertSubmission with status not-found inserts with null track fields', () => {
    insertSubmission(db, {
      submitterId: 'user2@c.us',
      submitterName: 'Bob',
      rawText: 'some random text',
      track: null,
      status: 'not-found',
    });

    const row = db
      .prepare('SELECT * FROM submissions WHERE submitter_id = ?')
      .get('user2@c.us') as Record<string, unknown> | undefined;

    expect(row).toBeDefined();
    expect(row?.track_title).toBeNull();
    expect(row?.track_artist).toBeNull();
    expect(row?.spotify_uri).toBeNull();
    expect(row?.status).toBe('not-found');
  });

  it('insertSubmission with status duplicate inserts correctly', () => {
    insertSubmission(db, {
      submitterId: 'user3@c.us',
      submitterName: 'Carol',
      rawText: 'spotify:track:abc123',
      track: sampleTrack,
      playlistId: 'playlist123',
      playlistName: 'Music League',
      status: 'duplicate',
    });

    const row = db
      .prepare('SELECT * FROM submissions WHERE submitter_id = ?')
      .get('user3@c.us') as Record<string, unknown> | undefined;

    expect(row).toBeDefined();
    expect(row?.status).toBe('duplicate');
    expect(row?.track_title).toBe('No Ordinary Love');
  });

  it('created_at field is a positive integer', () => {
    insertSubmission(db, {
      submitterId: 'user4@c.us',
      submitterName: 'Dave',
      rawText: 'test',
      status: 'no-rule',
    });

    const row = db
      .prepare('SELECT created_at FROM submissions WHERE submitter_id = ?')
      .get('user4@c.us') as { created_at: number } | undefined;

    expect(row).toBeDefined();
    expect(typeof row?.created_at).toBe('number');
    expect(row!.created_at).toBeGreaterThan(0);
  });
});
