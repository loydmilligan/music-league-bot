import Database from 'better-sqlite3';
import { describe, it, expect } from 'vitest';
import { openLeagueDb } from './client.js';
import { randomUUID } from 'node:crypto';

describe('digest_sections.kind storylines widening', () => {
  it('widens digest_sections.kind to storylines, preserving rows + regen children', () => {
    const path = `/tmp/ds-storylines-${randomUUID()}.db`;

    // Manually construct a pre-storylines DB: minimal digest_drafts +
    // digest_sections (OLD CHECK, no 'storylines') + digest_regenerations
    // child table (FK ON DELETE CASCADE to digest_sections), with one section
    // row and one regen row referencing it.
    const seedDb = new Database(path);
    seedDb.pragma('foreign_keys = OFF');
    seedDb.exec(`
      CREATE TABLE digest_drafts (
        id TEXT PRIMARY KEY,
        round_id INTEGER
      );
      CREATE TABLE digest_sections (
        id           TEXT PRIMARY KEY,
        draft_id     TEXT NOT NULL REFERENCES digest_drafts(id) ON DELETE CASCADE,
        kind         TEXT NOT NULL CHECK(kind IN ('podium','villain','flow','consensus','quotes','chat')),
        position     INTEGER NOT NULL,
        state        TEXT NOT NULL DEFAULT 'default' CHECK(state IN ('default','excluded','locked')),
        content_json TEXT NOT NULL,
        edited_at    TEXT,
        regen_count  INTEGER NOT NULL DEFAULT 0,
        variant      TEXT NOT NULL DEFAULT 'textual' CHECK(variant IN ('textual','visual','both'))
      );
      CREATE TABLE digest_regenerations (
        id                 TEXT PRIMARY KEY,
        section_id         TEXT NOT NULL REFERENCES digest_sections(id) ON DELETE CASCADE,
        ran_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
        chips              TEXT NOT NULL,
        instructions       TEXT NOT NULL,
        prior_content_json TEXT NOT NULL,
        new_content_json   TEXT NOT NULL,
        cover_kind         TEXT
      );
    `);
    seedDb.prepare("INSERT INTO digest_drafts (id, round_id) VALUES ('draft-1', 1)").run();
    seedDb.prepare(
      `INSERT INTO digest_sections (id, draft_id, kind, position, state, content_json, edited_at, regen_count, variant)
       VALUES ('sec-1', 'draft-1', 'podium', 0, 'default', '{}', NULL, 0, 'textual')`,
    ).run();
    seedDb.prepare(
      `INSERT INTO digest_regenerations (id, section_id, ran_at, chips, instructions, prior_content_json, new_content_json, cover_kind)
       VALUES ('regen-1', 'sec-1', '2026-01-01T00:00:00.000Z', '[]', 'instr', '{}', '{}', NULL)`,
    ).run();
    seedDb.close();

    // Opening via openLeagueDb triggers the guarded rebuild.
    const db = openLeagueDb(path);

    const section = db.prepare(
      'SELECT id, draft_id, kind, position, state, content_json, edited_at, regen_count, variant FROM digest_sections WHERE id = ?',
    ).get('sec-1') as {
      id: string; draft_id: string; kind: string; position: number; state: string;
      content_json: string; edited_at: string | null; regen_count: number; variant: string;
    };
    expect(section).toEqual({
      id: 'sec-1',
      draft_id: 'draft-1',
      kind: 'podium',
      position: 0,
      state: 'default',
      content_json: '{}',
      edited_at: null,
      regen_count: 0,
      variant: 'textual',
    });

    const regen = db.prepare('SELECT id, section_id FROM digest_regenerations WHERE id = ?').get('regen-1') as
      | { id: string; section_id: string }
      | undefined;
    expect(regen).toEqual({ id: 'regen-1', section_id: 'sec-1' });

    expect(() =>
      db.prepare(
        `INSERT INTO digest_sections (id, draft_id, kind, position, state, content_json)
         VALUES ('sec-2', 'draft-1', 'storylines', 1, 'default', '{}')`,
      ).run(),
    ).not.toThrow();
  });
});
