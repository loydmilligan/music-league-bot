/**
 * R3-ghost regression — Sprint 35
 *
 * The original bug: regenerating an old round (R3 "Second Best") cited future-round songs
 * ("Cottonfield Blues", "Johnny Lang") as "last round" context because the live
 * `relationship_contexts` blob accumulated forward through R4–R6 by regen time.
 *
 * Two independent leak vectors fixed by sprint-35:
 *   1. relContext blob — scoped via relContextOverride (relctx-scope task)
 *   2. bundle cross-round record — filtered to round_number <= N (bundle task)
 *
 * These tests pin BOTH leaks at the assembled-prompt level, which is what the LLM
 * actually sees. The pre-fix assertions show the ghost exists on the old code path;
 * the post-fix assertions show the fix eliminates it.
 */
import { it, expect, describe, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openLeagueDb } from '../db/client.js';
import { seedLeagues, upsertSeason } from '../db/leagues.js';
import { upsertRound } from '../db/rounds.js';
import { upsertCompetitor, upsertSubmission, upsertVote } from '../db/submissions.js';
import { gatherRoundData, buildUserPrompt } from './llm.js';

let db: Database.Database;
beforeEach(() => { db = openLeagueDb(':memory:'); });

/** Seeds R1–R3 (complete) + R4 (future), plus a forward-contaminated live blob. */
function seedGhostScenario(db: Database.Database): { leagueId: number; r3Id: number } {
  seedLeagues(db);
  const leagueId = (
    db.prepare("SELECT id FROM leagues WHERE slug='hip-jammers'").get() as { id: number }
  ).id;
  const seasonId = upsertSeason(db, leagueId, 1, 'active');

  const r1Id = upsertRound(db, seasonId, { mlRoundId: 'r1', name: 'Round 1', description: '', spotifyPlaylistUrl: '', createdAt: '2026-01-01T00:00:00Z' });
  const r2Id = upsertRound(db, seasonId, { mlRoundId: 'r2', name: 'Round 2', description: '', spotifyPlaylistUrl: '', createdAt: '2026-01-02T00:00:00Z' });
  const r3Id = upsertRound(db, seasonId, { mlRoundId: 'r3', name: 'Second Best', description: '', spotifyPlaylistUrl: '', createdAt: '2026-01-03T00:00:00Z' });
  const r4Id = upsertRound(db, seasonId, { mlRoundId: 'r4', name: 'Future Round', description: '', spotifyPlaylistUrl: '', createdAt: '2026-01-04T00:00:00Z' });

  db.prepare('UPDATE rounds SET round_number = 1 WHERE id = ?').run(r1Id);
  db.prepare('UPDATE rounds SET round_number = 2 WHERE id = ?').run(r2Id);
  db.prepare('UPDATE rounds SET round_number = 3 WHERE id = ?').run(r3Id);
  db.prepare('UPDATE rounds SET round_number = 4 WHERE id = ?').run(r4Id);

  const alice = upsertCompetitor(db, 'c-alice', 'Alice');
  const bob   = upsertCompetitor(db, 'c-bob',   'Bob');
  const carol = upsertCompetitor(db, 'c-carol', 'Carol');

  // R1 and R2: minimal submissions so bundle is non-empty
  upsertSubmission(db, { roundId: r1Id, competitorId: alice, spotifyUri: 'sp:r1:a', title: 'R1 Song', album: '', artists: 'X', comment: '', createdAt: '2026-01-01T00:00:00Z', visibleToVoters: true });
  upsertVote(db, { roundId: r1Id, voterId: bob, spotifyUri: 'sp:r1:a', points: 3, comment: '', createdAt: '2026-01-01T01:00:00Z' });

  upsertSubmission(db, { roundId: r2Id, competitorId: bob, spotifyUri: 'sp:r2:b', title: 'R2 Song', album: '', artists: 'Y', comment: '', createdAt: '2026-01-02T00:00:00Z', visibleToVoters: true });
  upsertVote(db, { roundId: r2Id, voterId: alice, spotifyUri: 'sp:r2:b', points: 3, comment: '', createdAt: '2026-01-02T01:00:00Z' });

  // R3 (current)
  upsertSubmission(db, { roundId: r3Id, competitorId: carol, spotifyUri: 'sp:r3:c', title: 'Second Best Song', album: '', artists: 'Z', comment: '', createdAt: '2026-01-03T00:00:00Z', visibleToVoters: true });
  upsertVote(db, { roundId: r3Id, voterId: alice, spotifyUri: 'sp:r3:c', points: 3, comment: '', createdAt: '2026-01-03T01:00:00Z' });

  // R4 (future): "Cottonfield Blues" by "Johnny Lang" — the ghost content
  upsertSubmission(db, { roundId: r4Id, competitorId: bob, spotifyUri: 'sp:r4:cotton', title: 'Cottonfield Blues', album: '', artists: 'Johnny Lang', comment: '', createdAt: '2026-01-04T00:00:00Z', visibleToVoters: true });
  upsertVote(db, { roundId: r4Id, voterId: alice, spotifyUri: 'sp:r4:cotton', points: 5, comment: '', createdAt: '2026-01-04T01:00:00Z' });

  // Forward-accumulated live blob — written AFTER R4/R5/R6 by the rel-context
  // updater, so it carries future-round narrative at R3 regen time.
  db.prepare(
    `INSERT INTO relationship_contexts (league_id, text) VALUES (?, ?)`,
  ).run(leagueId, 'FUTURE NARRATIVE: Cottonfield Blues (R4), Johnny Lang won R4, everything after R3');

  return { leagueId, r3Id };
}

describe('R3-ghost regression — relContext leak (pre-fix vs post-fix)', () => {
  it('pre-fix path: live blob contaminates R3 data with future-round content (demonstrating the bug)', () => {
    const { r3Id } = seedGhostScenario(db);

    // Old code path: no relContextOverride → reads the live forward-accumulated blob
    const data = gatherRoundData(db, r3Id);
    expect(data.relContext).toContain('Cottonfield Blues');
    expect(data.relContext).toContain('Johnny Lang');

    // The ghost reaches the prompt — the LLM was seeing this
    const prompt = buildUserPrompt(data);
    expect(prompt).toContain('Cottonfield Blues');
  });

  it('post-fix path: relContextOverride with era-correct snapshot excludes future content from data', () => {
    const { r3Id } = seedGhostScenario(db);
    const r3EraSnapshot = 'R1–R3 only: Alice likes jazz, Bob likes hip-hop.';

    // Fixed code path: regen route passes the draft snapshot as override
    const data = gatherRoundData(db, r3Id, { relContextOverride: r3EraSnapshot });
    expect(data.relContext).not.toContain('Cottonfield Blues');
    expect(data.relContext).not.toContain('Johnny Lang');
    expect(data.relContext).toContain('R1–R3 only');
  });

  it('post-fix path: prompt assembled with era-correct snapshot contains no future-round ghost', () => {
    const { r3Id } = seedGhostScenario(db);
    const r3EraSnapshot = 'R1–R3 only: Alice likes jazz, Bob likes hip-hop.';

    const data = gatherRoundData(db, r3Id, { relContextOverride: r3EraSnapshot });
    const prompt = buildUserPrompt(data);

    expect(prompt).not.toContain('Cottonfield Blues');
    expect(prompt).not.toContain('Johnny Lang');
    // Era-correct content is present
    expect(prompt).toContain('R1–R3 only');
  });
});

describe('R3-ghost regression — bundle leak (cross-round record must not cite future rounds)', () => {
  it('R3 bundle contains no round-4 entries', () => {
    const { r3Id } = seedGhostScenario(db);
    const { bundle } = gatherRoundData(db, r3Id);

    expect(bundle.every(e => e.round_number <= 3)).toBe(true);
    expect(bundle.find(e => e.round_number === 4)).toBeUndefined();
  });

  it('future-round songs do not appear in the cross-round record section of the prompt', () => {
    const { r3Id } = seedGhostScenario(db);
    const r3EraSnapshot = 'R1–R3 context only.';

    const data = gatherRoundData(db, r3Id, { relContextOverride: r3EraSnapshot });
    const prompt = buildUserPrompt(data);

    // "Cottonfield Blues" is in R4 — must not surface in the Cross-round record block
    expect(prompt).not.toContain('Cottonfield Blues');
    // The prompt SHOULD contain the round-3 current round name
    expect(prompt).toContain('Second Best');
  });
});
