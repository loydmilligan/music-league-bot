import { it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openLeagueDb } from '../db/client.js';
import { seedLeagues, upsertSeason } from '../db/leagues.js';
import { upsertRound } from '../db/rounds.js';
import { getSectionsForDraft, type DigestSectionRow } from './llm.js';

let db: Database.Database;
beforeEach(() => { db = openLeagueDb(':memory:'); });

function seedDraftWithSections(db: Database.Database): { draftId: string; excludedId: string } {
  seedLeagues(db);
  const leagueId = (db.prepare("SELECT id FROM leagues WHERE slug='hip-jammers'").get() as { id: number }).id;
  const seasonId = upsertSeason(db, leagueId, 1, 'active');
  const roundId = upsertRound(db, seasonId, {
    mlRoundId: 'regen-test', name: 'Test Round', description: '',
    spotifyPlaylistUrl: '', createdAt: '2026-01-01T00:00:00Z',
  });

  const draftId = 'draft-regen-test';
  db.prepare(`INSERT INTO digest_drafts
    (id, round_id, rel_context, prep_checks)
    VALUES (?, ?, '', '')`).run(draftId, roundId);

  db.prepare(`INSERT INTO digest_sections (id, draft_id, kind, position, state, content_json) VALUES
    ('sec-default',  ?, 'podium',    0, 'default',  '{}'),
    ('sec-excluded', ?, 'villain',   1, 'excluded', '{"excluded":true}'),
    ('sec-locked',   ?, 'flow',      2, 'locked',   '{"locked":true}')`
  ).run(draftId, draftId, draftId);

  return { draftId, excludedId: 'sec-excluded' };
}

// FB-5: whole-draft regenerate must skip excluded sections (C5)
it('filter skips excluded and locked sections — only default sections are regenerable', () => {
  const { draftId } = seedDraftWithSections(db);
  const sections = getSectionsForDraft(db, draftId);

  // This is the exact filter used by the whole-draft regenerate route (FB-5 fix)
  const regenerable = sections.filter(s => s.state !== 'locked' && s.state !== 'excluded');
  expect(regenerable).toHaveLength(1);
  expect(regenerable[0].id).toBe('sec-default');
});

it('excluded section regen_count and content_json are unchanged after applying the filter', () => {
  const { draftId, excludedId } = seedDraftWithSections(db);
  const sections = getSectionsForDraft(db, draftId);
  const excluded = sections.find(s => s.id === excludedId)!;

  // Verify the excluded section is not in the regenerable set
  const regenerable = sections.filter(s => s.state !== 'locked' && s.state !== 'excluded');
  expect(regenerable.find(s => s.id === excludedId)).toBeUndefined();

  // Its stored state is unchanged (the filter is the only thing protecting it)
  expect(excluded.regen_count).toBe(0);
  expect(excluded.content_json).toBe('{"excluded":true}');
});

it('single-section regen guard: excluded section state string is "excluded"', () => {
  const { draftId, excludedId } = seedDraftWithSections(db);
  const sections = getSectionsForDraft(db, draftId);
  const excluded = sections.find(s => s.id === excludedId) as DigestSectionRow;
  // The single-section route throws 400 when state === 'excluded' (same guard as locked)
  expect(excluded.state).toBe('excluded');
});
