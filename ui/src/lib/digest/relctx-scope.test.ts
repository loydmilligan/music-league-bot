import { it, expect, describe, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openLeagueDb } from '../db/client.js';
import { seedLeagues, upsertSeason } from '../db/leagues.js';
import { upsertRound } from '../db/rounds.js';
import { gatherRoundData } from './llm.js';

let db: Database.Database;
beforeEach(() => { db = openLeagueDb(':memory:'); });

function seedScenario(db: Database.Database): { leagueId: number; r3Id: number } {
  seedLeagues(db);
  const leagueId = (db.prepare("SELECT id FROM leagues WHERE slug='hip-jammers'").get() as { id: number }).id;
  const seasonId = upsertSeason(db, leagueId, 1, 'active');

  const r1Id = upsertRound(db, seasonId, { mlRoundId: 'r1', name: 'Round 1', description: '', spotifyPlaylistUrl: '', createdAt: '2026-01-01T00:00:00Z' });
  const r2Id = upsertRound(db, seasonId, { mlRoundId: 'r2', name: 'Round 2', description: '', spotifyPlaylistUrl: '', createdAt: '2026-01-02T00:00:00Z' });
  const r3Id = upsertRound(db, seasonId, { mlRoundId: 'r3', name: 'Round 3', description: '', spotifyPlaylistUrl: '', createdAt: '2026-01-03T00:00:00Z' });

  // Assign round_number so the bundle filter is deterministic
  db.prepare('UPDATE rounds SET round_number = 1 WHERE id = ?').run(r1Id);
  db.prepare('UPDATE rounds SET round_number = 2 WHERE id = ?').run(r2Id);
  db.prepare('UPDATE rounds SET round_number = 3 WHERE id = ?').run(r3Id);

  // Forward-accumulated live blob — contains R4/R5 future narrative
  db.prepare(
    `INSERT INTO relationship_contexts (league_id, text) VALUES (?, ?)`,
  ).run(leagueId, 'FUTURE: Cottonfield Blues (R5), Johnny Lang (R5), everything after R3');

  return { leagueId, r3Id };
}

describe('relctx-scope — gatherRoundData relContextOverride', () => {
  it('without override: returns the forward-accumulated live blob', () => {
    const { r3Id } = seedScenario(db);
    const data = gatherRoundData(db, r3Id);
    expect(data.relContext).toContain('FUTURE');
    expect(data.relContext).toContain('Cottonfield Blues');
  });

  it('with override: returns the caller-supplied snapshot, not the live blob', () => {
    const { r3Id } = seedScenario(db);
    const r3EraContext = 'R1-R3 only: Bone Thugs. No future rounds.';
    const data = gatherRoundData(db, r3Id, { relContextOverride: r3EraContext });
    expect(data.relContext).toBe(r3EraContext);
    expect(data.relContext).not.toContain('FUTURE');
    expect(data.relContext).not.toContain('Cottonfield Blues');
  });

  it('with empty-string override: returns empty string, not the live blob', () => {
    const { r3Id } = seedScenario(db);
    const data = gatherRoundData(db, r3Id, { relContextOverride: '' });
    expect(data.relContext).toBe('');
  });

  it('round-N regen context excludes later-round material when snapshot is supplied', () => {
    const { r3Id } = seedScenario(db);
    // Simulate what writeDraft stored at original R3 gen time — only R1–R3 narrative
    const r3Snapshot = 'jac submitted Malagueña. Bone Thugs was last round.';
    const data = gatherRoundData(db, r3Id, { relContextOverride: r3Snapshot });

    // The R4–R6 future content from the live blob must not appear
    expect(data.relContext).not.toContain('Cottonfield Blues');
    expect(data.relContext).not.toContain('Johnny Lang');
    // The era-correct content must be present
    expect(data.relContext).toContain('Malagueña');
    expect(data.relContext).toContain('Bone Thugs');
  });
});
