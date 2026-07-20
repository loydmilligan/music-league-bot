import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync, unlinkSync } from 'node:fs';
import { openLeagueDb } from './client.js';

describe('seasons source columns', () => {
  it('fresh DB has source (default music_league) + source_competition_id', () => {
    const db = openLeagueDb(':memory:');
    const cols = (db.prepare('PRAGMA table_info(seasons)').all() as { name: string }[]).map(c => c.name);
    expect(cols).toContain('source');
    expect(cols).toContain('source_competition_id');
    db.prepare("INSERT INTO leagues (slug,name) VALUES ('x','X')").run();
    const lid = (db.prepare("SELECT id FROM leagues WHERE slug='x'").get() as { id: number }).id;
    db.prepare("INSERT INTO seasons (league_id,season_number,status) VALUES (?,1,'active')").run(lid);
    const s = db.prepare('SELECT source, source_competition_id FROM seasons').get() as any;
    expect(s.source).toBe('music_league');
    expect(s.source_competition_id).toBeNull();
    const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_seasons_source_comp'").get();
    expect(idx).toBeTruthy();
  });

  it('migrates an existing DB that lacks the columns', () => {
    const p = '/tmp/test-seasons-migrate.db';
    if (existsSync(p)) unlinkSync(p);
    const old = new Database(p);
    old.exec(`
      CREATE TABLE leagues (id INTEGER PRIMARY KEY, slug TEXT UNIQUE, name TEXT);
      CREATE TABLE seasons (id INTEGER PRIMARY KEY, league_id INTEGER, season_number INTEGER,
        status TEXT NOT NULL DEFAULT 'active', status_source TEXT NOT NULL DEFAULT 'derived');
      INSERT INTO leagues (slug,name) VALUES ('x','X');
      INSERT INTO seasons (league_id,season_number,status) VALUES (1,1,'active');`);
    old.close();
    const db = openLeagueDb(p); // SCHEMA (IF NOT EXISTS = no-op on seasons) + guarded ALTER
    const cols = (db.prepare('PRAGMA table_info(seasons)').all() as { name: string }[]).map(c => c.name);
    expect(cols).toContain('source');
    expect(cols).toContain('source_competition_id');
    const s = db.prepare('SELECT source FROM seasons WHERE id=1').get() as any;
    expect(s.source).toBe('music_league'); // NOT NULL DEFAULT backfills the existing row
    db.close();
    unlinkSync(p);
  });
});
