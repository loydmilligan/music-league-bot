import Database from 'better-sqlite3';
import { describe, it, expect } from 'vitest';
import { openLeagueDb } from './client.js';
import { randomUUID } from 'node:crypto';

describe('discord identity type', () => {
  it('accepts identity_type = discord after migration', () => {
    const db = openLeagueDb(`/tmp/pi-${randomUUID()}.db`);
    const p = db.prepare("INSERT INTO players (name) VALUES ('x') RETURNING id").get() as { id: number };
    expect(() =>
      db.prepare(
        "INSERT INTO player_identities (player_id, identity_type, identifier) VALUES (?, 'discord', 'Dogsweat')",
      ).run(p.id),
    ).not.toThrow();
  });

  it('preserves existing player_identities rows through the CHECK-widening rebuild', () => {
    const path = `/tmp/pi-preserve-${randomUUID()}.db`;

    // Manually construct a pre-discord DB: minimal players table + player_identities
    // table with the OLD CHECK (no 'discord'), plus one known row.
    const seedDb = new Database(path);
    seedDb.pragma('foreign_keys = OFF');
    seedDb.exec(`
      CREATE TABLE players (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        chat_type TEXT CHECK(chat_type IN ('whatsapp','google-chat')),
        chat_identifier TEXT,
        ml_competitor_id TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE player_identities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        league_id INTEGER REFERENCES leagues(id) ON DELETE SET NULL,
        identity_type TEXT NOT NULL CHECK(identity_type IN ('whatsapp','google-chat','music-league')),
        identifier TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      );
    `);
    seedDb.prepare("INSERT INTO players (id, name) VALUES (1, 'Matt')").run();
    seedDb.prepare(
      `INSERT INTO player_identities (id, player_id, league_id, identity_type, identifier, created_at)
       VALUES (1, 1, NULL, 'whatsapp', '16617476822@c.us', '2026-01-01T00:00:00.000Z')`,
    ).run();
    seedDb.close();

    // Opening via openLeagueDb triggers the guarded rebuild.
    const db = openLeagueDb(path);

    const row = db.prepare(
      'SELECT id, player_id, league_id, identity_type, identifier, created_at FROM player_identities WHERE id = 1',
    ).get() as {
      id: number; player_id: number; league_id: number | null;
      identity_type: string; identifier: string; created_at: string;
    };
    expect(row).toEqual({
      id: 1,
      player_id: 1,
      league_id: null,
      identity_type: 'whatsapp',
      identifier: '16617476822@c.us',
      created_at: '2026-01-01T00:00:00.000Z',
    });

    expect(() =>
      db.prepare(
        "INSERT INTO player_identities (player_id, identity_type, identifier) VALUES (1, 'discord', 'Dogsweat')",
      ).run(),
    ).not.toThrow();
  });
});
