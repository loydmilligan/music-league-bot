/**
 * FB-2 regression tests — stale digest next-round override no longer hides
 * deadline updates (C3 fix). When a deadline write lands on a round, any
 * digest_drafts deadline overrides that shadow that round as "next round" are
 * cleared automatically so the GET endpoint returns live rounds-table values.
 */
import { it, expect, beforeEach } from 'vitest';
import { openLeagueDb } from './client.js';
import { seedLeagues, upsertSeason } from './leagues.js';
import { upsertRound, patchRound, updateRound, updateDeadlines } from './rounds.js';
import type Database from 'better-sqlite3';

let db: Database.Database;
beforeEach(() => { db = openLeagueDb(':memory:'); seedLeagues(db); });

function leagueId(slug = 'hip-jammers'): number {
  return (db.prepare('SELECT id FROM leagues WHERE slug = ?').get(slug) as { id: number }).id;
}

/** Seed two consecutive rounds and return their ids, plus a digest draft for round1. */
function seedTwoRoundsWithDraft(): { round1: number; round2: number; draftId: string } {
  const lid = leagueId();
  const sid = upsertSeason(db, lid, 1, 'active');
  const round1 = upsertRound(db, sid, {
    mlRoundId: 'r1', name: 'Round 1', description: 'Theme 1',
    spotifyPlaylistUrl: '', createdAt: '2026-01-01T00:00:00Z',
  });
  const round2 = upsertRound(db, sid, {
    mlRoundId: 'r2', name: 'Round 2', description: 'Theme 2',
    spotifyPlaylistUrl: '', createdAt: '2026-01-08T00:00:00Z',
  });
  // Seed a digest draft for round1 with deadline overrides shadowing round2.
  const draftId = 'draft-test-001';
  db.prepare(`
    INSERT INTO digest_drafts (id, round_id, generated_at, rel_context, prep_checks,
      next_round_sub_deadline_override, next_round_vote_deadline_override)
    VALUES (?, ?, datetime('now'), '{}', '[]', ?, ?)
  `).run(draftId, round1, '2099-01-01T00:00:00Z', '2099-01-15T00:00:00Z');
  return { round1, round2, draftId };
}

function getDraftOverrides(draftId: string): { sub: string | null; vote: string | null } {
  const row = db.prepare(
    'SELECT next_round_sub_deadline_override AS sub, next_round_vote_deadline_override AS vote FROM digest_drafts WHERE id = ?'
  ).get(draftId) as { sub: string | null; vote: string | null };
  return row;
}

it('patchRound deadline update clears stale next-round override on the predecessor draft (C3 repro)', () => {
  const { round2, draftId } = seedTwoRoundsWithDraft();
  // Sanity: override is set
  expect(getDraftOverrides(draftId).sub).toBe('2099-01-01T00:00:00Z');

  // Update round2 deadlines via patchRound (W3 path).
  patchRound(db, round2, { submissionDeadline: '2026-06-14T07:00:00Z', votingDeadline: '2026-06-19T07:00:00Z' });

  // Override on the predecessor draft should now be cleared.
  const overrides = getDraftOverrides(draftId);
  expect(overrides.sub).toBeNull();
  expect(overrides.vote).toBeNull();
});

it('updateDeadlines clears stale next-round override (W11/W12 path)', () => {
  const { round2, draftId } = seedTwoRoundsWithDraft();
  expect(getDraftOverrides(draftId).sub).not.toBeNull();

  // updateDeadlines is used by the settings form (W11) and auto-fill (W12).
  updateDeadlines(db, round2, '2026-07-01T00:00:00Z', '2026-07-08T00:00:00Z');

  const overrides = getDraftOverrides(draftId);
  expect(overrides.sub).toBeNull();
  expect(overrides.vote).toBeNull();
});

it('updateRound deadline update clears stale next-round override', () => {
  const { round2, draftId } = seedTwoRoundsWithDraft();
  expect(getDraftOverrides(draftId).sub).not.toBeNull();

  updateRound(db, round2, { submission_deadline: '2026-08-01T00:00:00Z' });

  const overrides = getDraftOverrides(draftId);
  expect(overrides.sub).toBeNull();
  expect(overrides.vote).toBeNull();
});

it('patchRound on name/theme only does NOT clear deadline overrides', () => {
  const { round2, draftId } = seedTwoRoundsWithDraft();
  const before = getDraftOverrides(draftId);

  // Name-only patch — no deadline change.
  patchRound(db, round2, { name: 'Renamed Round 2' });

  const after = getDraftOverrides(draftId);
  expect(after.sub).toBe(before.sub);   // unchanged
  expect(after.vote).toBe(before.vote); // unchanged
});

it('theme-only override is preserved when only deadlines are cleared', () => {
  const { round2, draftId } = seedTwoRoundsWithDraft();
  // Add a theme override to the same draft.
  db.prepare('UPDATE digest_drafts SET next_round_theme_override = ? WHERE id = ?')
    .run('OVERRIDE-THEME', draftId);

  updateDeadlines(db, round2, '2026-09-01T00:00:00Z', null);

  const row = db.prepare(
    'SELECT next_round_theme_override, next_round_sub_deadline_override FROM digest_drafts WHERE id = ?'
  ).get(draftId) as { next_round_theme_override: string | null; next_round_sub_deadline_override: string | null };
  expect(row.next_round_theme_override).toBe('OVERRIDE-THEME'); // preserved
  expect(row.next_round_sub_deadline_override).toBeNull();      // cleared
});

it('clearing is a no-op when no deadline overrides exist', () => {
  const lid = leagueId();
  const sid = upsertSeason(db, lid, 1, 'active');
  const round1 = upsertRound(db, sid, {
    mlRoundId: 'solo-r1', name: 'Solo Round 1', description: '',
    spotifyPlaylistUrl: '', createdAt: '2026-01-01T00:00:00Z',
  });
  const round2 = upsertRound(db, sid, {
    mlRoundId: 'solo-r2', name: 'Solo Round 2', description: '',
    spotifyPlaylistUrl: '', createdAt: '2026-01-08T00:00:00Z',
  });
  // Draft with no overrides.
  db.prepare(`INSERT INTO digest_drafts (id, round_id, generated_at, rel_context, prep_checks) VALUES (?, ?, datetime('now'), '{}', '[]')`)
    .run('no-override-draft', round1);

  // Should complete without throwing.
  expect(() => updateDeadlines(db, round2, '2026-07-01T00:00:00Z', null)).not.toThrow();
});
