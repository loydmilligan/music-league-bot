/**
 * sprint-42 a5: delight route unit tests — validates that the delight insert
 * logic (core of the route) works correctly against a real in-memory DB.
 * Does not test the SvelteKit route handler wrapper; tests the data contract.
 */
import { it, expect, describe, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { openLeagueDb } from '../db/client.js';
import { seedLeagues, upsertSeason } from '../db/leagues.js';
import { upsertRound } from '../db/rounds.js';
import type Database from 'better-sqlite3';

let db: Database.Database;

beforeEach(() => {
  db = openLeagueDb(':memory:');
});

// Track whether leagues were seeded (once per test suite — each beforeEach gets fresh :memory: db)
function seedRoundAndDraft(key: string, draftId: string, sectionId: string): void {
  seedLeagues(db);
  const leagueId = (db.prepare("SELECT id FROM leagues WHERE slug='hip-jammers'").get() as { id: number }).id;
  const seasonId = upsertSeason(db, leagueId, 1, 'active');
  const roundId = upsertRound(db, seasonId, {
    mlRoundId: key + '-round', name: 'Test Round', description: '',
    spotifyPlaylistUrl: '', createdAt: '2026-01-01T00:00:00Z',
  });
  db.prepare(
    `INSERT OR IGNORE INTO digest_drafts (id, round_id, rel_context, prep_checks)
     VALUES (?, ?, '', '')`,
  ).run(draftId, roundId);
  db.prepare(
    `INSERT OR IGNORE INTO digest_sections (id, draft_id, kind, position, state, content_json, regen_count)
     VALUES (?, ?, 'podium', 0, 'default', '{}', 0)`,
  ).run(sectionId, draftId);
}

function insertCostLogForSection(sectionId: string): number {
  const r = db.prepare(
    `INSERT INTO llm_cost_log
       (model, prompt_tokens, completion_tokens, total_tokens, cost_usd, latency_ms,
        category, label, artifact_type, artifact_id)
     VALUES ('test-model', 10, 5, 15, 0.001, 100, 'digest', 'digest:podium', 'digest_section', ?)`,
  ).run(sectionId);
  return r.lastInsertRowid as number;
}

// Mirrors the delight route logic inline for testing purposes
function insertDelight(
  sectionId: string,
  span: string,
  subsection: string | null,
  note: string | null,
): { ok: boolean; delightId: string } | { error: string; status: number } {
  // Validate section exists
  const section = db
    .prepare(
      `SELECT s.id FROM digest_sections s
       JOIN digest_drafts d ON d.id = s.draft_id
       WHERE s.id = ?`,
    )
    .get(sectionId) as { id: string } | undefined;
  if (!section) return { error: 'section not found', status: 404 };
  if (!span || !span.trim()) return { error: 'span is required', status: 400 };

  const costLogRow = db
    .prepare(`SELECT id FROM llm_cost_log WHERE artifact_id = ? ORDER BY id DESC LIMIT 1`)
    .get(sectionId) as { id: number } | undefined;
  const costLogId = costLogRow?.id ?? null;

  const delightId = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO llm_delight (id, cost_log_id, span, subsection, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(delightId, costLogId, span.trim(), subsection, note, now);

  return { ok: true, delightId };
}

describe('a5: delight insert logic', () => {
  it('inserts a delight row with correct cost_log_id', () => {
    seedRoundAndDraft('d1', 'draft-d1-abc', 'draft-d1-abc-podium');
    const costLogId = insertCostLogForSection('draft-d1-abc-podium');

    const result = insertDelight('draft-d1-abc-podium', 'Great line here', 'body', null);
    expect((result as { ok: boolean }).ok).toBe(true);

    const row = db.prepare('SELECT * FROM llm_delight').get() as Record<string, unknown>;
    expect(row.span).toBe('Great line here');
    expect(Number(row.cost_log_id)).toBe(Number(costLogId));
    expect(row.subsection).toBe('body');
    expect(row.note).toBeNull();
  });

  it('inserts delight row with null cost_log_id when no llm_cost_log row exists', () => {
    seedRoundAndDraft('d2', 'draft-d2-abc', 'draft-d2-abc-podium');
    // No cost log row inserted

    const result = insertDelight('draft-d2-abc-podium', 'Another great line', null, 'nice!');
    expect((result as { ok: boolean }).ok).toBe(true);

    const row = db.prepare('SELECT * FROM llm_delight').get() as Record<string, unknown>;
    expect(row.cost_log_id).toBeNull();
    expect(row.note).toBe('nice!');
  });

  it('returns 404 for unknown sectionId', () => {
    const result = insertDelight('nonexistent-section-id', 'some span', null, null);
    expect((result as { status: number }).status).toBe(404);
  });

  it('returns 400 for empty span', () => {
    seedRoundAndDraft('d3', 'draft-d3-abc', 'draft-d3-abc-podium');
    const result = insertDelight('draft-d3-abc-podium', '   ', null, null);
    expect((result as { status: number }).status).toBe(400);
  });
});
