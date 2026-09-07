import { describe, expect, it, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  DEFAULT_VIDEO_PLAYLIST_CONFIG,
  getVideoPlaylistDefaults,
  updateVideoPlaylistDefaults,
  getRoundVideoPlaylistConfig,
  getRoundVideoPlaylistOverride,
  setRoundVideoPlaylistConfig,
} from '../ui/src/lib/db/videoPlaylist.js';
// @ts-expect-error — plain .mjs, no types
import { readRoundVideoConfig } from '../scripts/ytm-drop/videoConfig.mjs';

let db: Database.Database;
beforeEach(() => {
  db = new Database(':memory:');
  db.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE rounds (id INTEGER PRIMARY KEY, video_playlist_config TEXT);
    INSERT INTO rounds (id) VALUES (143), (150);
  `);
});

describe('defaults', () => {
  it('reads the shipped defaults before anything is stored', () => {
    expect(getVideoPlaylistDefaults(db)).toEqual(DEFAULT_VIDEO_PLAYLIST_CONFIG);
  });

  it('merges a partial update instead of replacing the whole config', () => {
    updateVideoPlaylistDefaults(db, { enabled: true, searchAutoAcceptPct: 55 });
    updateVideoPlaylistDefaults(db, { useSearch: false });
    expect(getVideoPlaylistDefaults(db)).toEqual({
      enabled: true, useComments: true, useSearch: false, searchAutoAcceptPct: 55,
    });
  });

  it('survives a corrupted stored value rather than throwing', () => {
    db.prepare("INSERT INTO settings (key, value) VALUES ('video_playlist_defaults', '{oops')").run();
    expect(getVideoPlaylistDefaults(db)).toEqual(DEFAULT_VIDEO_PLAYLIST_CONFIG);
  });
});

describe('per-round override', () => {
  it('inherits until something is stored', () => {
    updateVideoPlaylistDefaults(db, { enabled: true });
    expect(getRoundVideoPlaylistOverride(db, 143)).toBeNull();
    expect(getRoundVideoPlaylistConfig(db, 143).enabled).toBe(true);
  });

  it('an inheriting round follows a later default change', () => {
    updateVideoPlaylistDefaults(db, { searchAutoAcceptPct: 40 });
    expect(getRoundVideoPlaylistConfig(db, 143).searchAutoAcceptPct).toBe(40);
    updateVideoPlaylistDefaults(db, { searchAutoAcceptPct: 90 });
    expect(getRoundVideoPlaylistConfig(db, 143).searchAutoAcceptPct).toBe(90);
  });

  it('an overriding round does NOT follow a later default change', () => {
    setRoundVideoPlaylistConfig(db, 143, { searchAutoAcceptPct: 40 });
    updateVideoPlaylistDefaults(db, { searchAutoAcceptPct: 90 });
    expect(getRoundVideoPlaylistConfig(db, 143).searchAutoAcceptPct).toBe(40);
  });

  it('overriding one round leaves its neighbours inheriting', () => {
    updateVideoPlaylistDefaults(db, { enabled: false });
    setRoundVideoPlaylistConfig(db, 143, { enabled: true });
    expect(getRoundVideoPlaylistConfig(db, 143).enabled).toBe(true);
    expect(getRoundVideoPlaylistConfig(db, 150).enabled).toBe(false);
    expect(getRoundVideoPlaylistOverride(db, 150)).toBeNull();
  });

  it('null RESETS to inheriting, it does not freeze the current value', () => {
    setRoundVideoPlaylistConfig(db, 143, { searchAutoAcceptPct: 40 });
    setRoundVideoPlaylistConfig(db, 143, null);
    expect(getRoundVideoPlaylistOverride(db, 143)).toBeNull();
    updateVideoPlaylistDefaults(db, { searchAutoAcceptPct: 90 });
    expect(getRoundVideoPlaylistConfig(db, 143).searchAutoAcceptPct).toBe(90);
  });

  it('a round can turn the playlist OFF against an on-by-default global', () => {
    updateVideoPlaylistDefaults(db, { enabled: true });
    setRoundVideoPlaylistConfig(db, 143, { enabled: false });
    expect(getRoundVideoPlaylistConfig(db, 143).enabled).toBe(false);
    expect(getRoundVideoPlaylistConfig(db, 150).enabled).toBe(true);
  });
});

describe('the drop script reads the same answer as the UI', () => {
  it('agrees on inherit, override and reset, against one real database', () => {
    updateVideoPlaylistDefaults(db, { enabled: true, searchAutoAcceptPct: 80 });
    expect(readRoundVideoConfig(db, 143)).toEqual(getRoundVideoPlaylistConfig(db, 143));

    setRoundVideoPlaylistConfig(db, 143, { useSearch: false, searchAutoAcceptPct: 25 });
    expect(readRoundVideoConfig(db, 143)).toEqual(getRoundVideoPlaylistConfig(db, 143));
    expect(readRoundVideoConfig(db, 143).useSearch).toBe(false);
    // The neighbour must be unaffected — this is the check that catches a
    // reader that ignores the round id.
    expect(readRoundVideoConfig(db, 150).useSearch).toBe(true);

    setRoundVideoPlaylistConfig(db, 143, null);
    expect(readRoundVideoConfig(db, 143)).toEqual(getRoundVideoPlaylistConfig(db, 143));
  });
});
