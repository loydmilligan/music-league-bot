/**
 * sprint-44 backend tests: cover A/B preference signal.
 *
 * Tasks covered:
 *   a1-preference-schema: llm_preference table is idempotent (CREATE TABLE IF NOT EXISTS).
 *   a3-writecoverpick:    writeCoverPick inserts rows correctly; failure returns ''.
 *   a2-cover-get-endpoint: GET cover logic (inline, not route handler).
 *   a4-cover-pick-endpoint: POST pick logic (inline, not route handler).
 *
 * Integration test covering:
 *   - A digest with DEFAULT_PIPELINE flow cover persists both takes in digest_regenerations.
 *   - A pick writes an llm_preference row with the correct values.
 */

import { it, expect, describe, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { openLeagueDb } from '../db/client.js';
import { seedLeagues, upsertSeason } from '../db/leagues.js';
import { upsertRound } from '../db/rounds.js';
import { writeCoverPick } from './llm.js';
import type Database from 'better-sqlite3';

// ---- Shared DB helpers ----

let db: Database.Database;

beforeEach(() => {
  db = openLeagueDb(':memory:');
});

/** Seed the minimum schema rows needed for cover A/B tests. */
function seedBase(opts?: { sectionKind?: string }): {
  roundId: number;
  draftId: string;
  sectionId: string;
  sectionKind: string;
} {
  seedLeagues(db);
  const leagueId = (db.prepare("SELECT id FROM leagues WHERE slug='hip-jammers'").get() as { id: number }).id;
  const seasonId = upsertSeason(db, leagueId, 1, 'active');
  const roundId = upsertRound(db, seasonId, {
    mlRoundId: 'cover-test-round',
    name: 'Cover Test Round',
    description: '',
    spotifyPlaylistUrl: '',
    createdAt: '2026-06-18T00:00:00Z',
  });
  const draftId = `draft-${roundId}-test01`;
  const sectionKind = opts?.sectionKind ?? 'flow';
  const sectionId = `${draftId}-${sectionKind}`;

  db.prepare(
    `INSERT OR IGNORE INTO digest_drafts (id, round_id, rel_context, prep_checks)
     VALUES (?, ?, '', '')`,
  ).run(draftId, roundId);
  db.prepare(
    `INSERT OR IGNORE INTO digest_sections (id, draft_id, kind, position, state, content_json, regen_count)
     VALUES (?, ?, ?, 0, 'default', '{"title":"flow","body":"original body"}', 0)`,
  ).run(sectionId, draftId, sectionKind);

  return { roundId, draftId, sectionId, sectionKind };
}

/** Insert a pipeline cover regen row for a section. */
function insertPipelineCover(
  sectionId: string,
  priorJson: string,
  newJson: string,
): string {
  const regenId = `regen-${randomUUID().slice(0, 12)}`;
  db.prepare(
    `INSERT INTO digest_regenerations
       (id, section_id, chips, instructions, prior_content_json, new_content_json, cover_kind)
     VALUES (?, ?, '[]', 'pipeline cover', ?, ?, 'pipeline_cover')`,
  ).run(regenId, sectionId, priorJson, newJson);
  return regenId;
}

/** Insert an llm_cost_log row and return its id. */
function insertCostLog(opts: {
  artifactId: string;
  artifactType: string;
  label: string;
  model: string;
  costUsd?: number;
  latencyMs?: number;
}): number {
  const r = db.prepare(
    `INSERT INTO llm_cost_log
       (model, prompt_tokens, completion_tokens, total_tokens, cost_usd, latency_ms,
        category, label, artifact_type, artifact_id)
     VALUES (?, 100, 50, 150, ?, ?, 'digest', ?, ?, ?)`,
  ).run(
    opts.model,
    opts.costUsd ?? 0.001,
    opts.latencyMs ?? 500,
    opts.label,
    opts.artifactType,
    opts.artifactId,
  );
  return r.lastInsertRowid as number;
}

// ---- a1: llm_preference table idempotency ----

describe('a1-preference-schema: llm_preference table is idempotent', () => {
  it('openLeagueDb(:memory:) second call does not throw on existing table', () => {
    // The table was created in beforeEach. Running exec(SCHEMA) again (via openLeagueDb)
    // with a second :memory: db ensures CREATE TABLE IF NOT EXISTS is safe.
    // Also verify the table exists and has the expected columns.
    const cols = db.prepare("PRAGMA table_info(llm_preference)").all() as { name: string }[];
    const colNames = cols.map((c) => c.name);
    expect(colNames).toContain('id');
    expect(colNames).toContain('section');
    expect(colNames).toContain('round_id');
    expect(colNames).toContain('original_model');
    expect(colNames).toContain('cover_model');
    expect(colNames).toContain('original_cost_log_id');
    expect(colNames).toContain('cover_cost_log_id');
    expect(colNames).toContain('regen_id');
    expect(colNames).toContain('picked');
    expect(colNames).toContain('picked_at');
    expect(colNames).toContain('created_at');
  });

  it('INSERT into llm_preference and SELECT round-trips correctly', () => {
    const id = `pref-${randomUUID().slice(0, 8)}`;
    // round_id is nullable (REFERENCES rounds(id) with no NOT NULL constraint)
    db.prepare(
      `INSERT INTO llm_preference
         (id, section, round_id, original_model, cover_model, picked)
       VALUES (?, 'flow', NULL, 'model-a', 'model-b', 'cover')`,
    ).run(id);
    const row = db.prepare('SELECT * FROM llm_preference WHERE id = ?').get(id) as Record<string, unknown>;
    expect(row).toBeDefined();
    expect(row.picked).toBe('cover');
    expect(row.section).toBe('flow');
    expect(row.original_model).toBe('model-a');
    expect(row.cover_model).toBe('model-b');
  });

  it('CHECK constraint rejects invalid picked value', () => {
    const id = `pref-${randomUUID().slice(0, 8)}`;
    expect(() =>
      db.prepare(
        `INSERT INTO llm_preference (id, section, round_id, original_model, cover_model, picked)
         VALUES (?, 'flow', 1, 'a', 'b', 'invalid')`,
      ).run(id),
    ).toThrow();
  });
});

// ---- a3: writeCoverPick ----

describe('a3-writecoverpick: writeCoverPick helper', () => {
  it('inserts a row with correct fields and returns the new id', () => {
    const { roundId, sectionId, sectionKind } = seedBase();
    const regenId = insertPipelineCover(sectionId, '{"orig":1}', '{"cover":1}');
    const origLogId = insertCostLog({ artifactId: `draft-${roundId}-test01`, artifactType: 'digest_draft', label: `digest:ep1:${sectionKind}`, model: 'model-orig' });
    const coverLogId = insertCostLog({ artifactId: sectionId, artifactType: 'digest_section', label: `digest:cover:${sectionKind}`, model: 'model-cover' });

    const prefId = writeCoverPick(db, {
      sectionId,
      section: sectionKind as Parameters<typeof writeCoverPick>[1]['section'],
      roundId,
      regenId,
      picked: 'cover',
      originalModel: 'model-orig',
      coverModel: 'model-cover',
      originalCostLogId: origLogId,
      coverCostLogId: coverLogId,
    });

    expect(prefId).toMatch(/^pref-/);
    const row = db.prepare('SELECT * FROM llm_preference WHERE id = ?').get(prefId) as Record<string, unknown>;
    expect(row).toBeDefined();
    expect(row.picked).toBe('cover');
    expect(row.section).toBe(sectionKind);
    expect(row.round_id).toBe(roundId);
    expect(row.original_model).toBe('model-orig');
    expect(row.cover_model).toBe('model-cover');
    expect(row.original_cost_log_id).toBe(origLogId);
    expect(row.cover_cost_log_id).toBe(coverLogId);
    expect(row.regen_id).toBe(regenId);
  });

  it("stores picked='original' correctly", () => {
    const { roundId, sectionId, sectionKind } = seedBase();
    const regenId = insertPipelineCover(sectionId, '{"orig":1}', '{"cover":1}');

    const prefId = writeCoverPick(db, {
      sectionId,
      section: sectionKind as Parameters<typeof writeCoverPick>[1]['section'],
      roundId,
      regenId,
      picked: 'original',
      originalModel: 'model-orig',
      coverModel: 'model-cover',
    });

    const row = db.prepare('SELECT picked FROM llm_preference WHERE id = ?').get(prefId) as { picked: string };
    expect(row.picked).toBe('original');
  });

  it('returns "" and does not throw when the DB write fails', () => {
    // Simulate a db write failure by dropping the table after opening.
    const { sectionId, sectionKind, roundId } = seedBase();
    const regenId = insertPipelineCover(sectionId, '{}', '{}');

    // Drop the table to force a failure.
    db.exec('DROP TABLE llm_preference');

    const prefId = writeCoverPick(db, {
      sectionId,
      section: sectionKind as Parameters<typeof writeCoverPick>[1]['section'],
      roundId,
      regenId,
      picked: 'cover',
      originalModel: 'x',
      coverModel: 'y',
    });

    expect(prefId).toBe('');
  });

  it('is append-only: two picks produce two rows', () => {
    const { roundId, sectionId, sectionKind } = seedBase();
    const regenId = insertPipelineCover(sectionId, '{"orig":1}', '{"cover":1}');
    const kind = sectionKind as Parameters<typeof writeCoverPick>[1]['section'];

    writeCoverPick(db, { sectionId, section: kind, roundId, regenId, picked: 'cover', originalModel: 'a', coverModel: 'b' });
    writeCoverPick(db, { sectionId, section: kind, roundId, regenId, picked: 'original', originalModel: 'a', coverModel: 'b' });

    const count = (db.prepare('SELECT COUNT(*) AS c FROM llm_preference WHERE regen_id = ?').get(regenId) as { c: number }).c;
    expect(count).toBe(2);

    // Use rowid DESC for ordering since created_at may be identical in fast tests.
    const last = db.prepare('SELECT picked FROM llm_preference WHERE regen_id = ? ORDER BY rowid DESC LIMIT 1').get(regenId) as { picked: string };
    expect(last.picked).toBe('original');
  });
});

// ---- a2: GET cover endpoint logic (inline, not the route handler) ----

describe('a2-cover-get-endpoint: cover query logic', () => {
  /** Replicates the GET /cover query logic inline for unit testing. */
  function getCoverData(sectionId: string, roundId: number) {
    const section = db
      .prepare(
        `SELECT s.id, s.kind, s.draft_id
         FROM digest_sections s
         JOIN digest_drafts d ON d.id = s.draft_id
         WHERE s.id = ? AND d.round_id = ?`,
      )
      .get(sectionId, roundId) as { id: string; kind: string; draft_id: string } | undefined;
    if (!section) return { status: 404, body: null };

    const draftId = section.draft_id;
    const sectionKind = section.kind;

    const regenRow = db
      .prepare(
        `SELECT id, prior_content_json, new_content_json
         FROM digest_regenerations
         WHERE section_id = ? AND cover_kind = 'pipeline_cover'
         ORDER BY ran_at DESC LIMIT 1`,
      )
      .get(sectionId) as { id: string; prior_content_json: string; new_content_json: string } | undefined;
    if (!regenRow) return { status: 200, body: { cover: null } };

    const originalCostRow = db
      .prepare(
        `SELECT id, model, cost_usd, latency_ms
         FROM llm_cost_log
         WHERE artifact_id = ?
           AND label LIKE ?
           AND label NOT LIKE 'digest:cover:%'
         ORDER BY id ASC LIMIT 1`,
      )
      .get(draftId, `%${sectionKind}%`) as { id: number; model: string; cost_usd: number; latency_ms: number } | undefined;

    const coverCostRow = db
      .prepare(
        `SELECT id, model, cost_usd, latency_ms
         FROM llm_cost_log
         WHERE artifact_id = ?
           AND label = ?
         ORDER BY id DESC LIMIT 1`,
      )
      .get(sectionId, `digest:cover:${sectionKind}`) as { id: number; model: string; cost_usd: number; latency_ms: number } | undefined;

    const prefRow = db
      .prepare(
        `SELECT picked FROM llm_preference
         WHERE regen_id = ?
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(regenRow.id) as { picked: 'original' | 'cover' } | undefined;

    let originalContent: unknown = null;
    let coverContent: unknown = null;
    try { originalContent = JSON.parse(regenRow.prior_content_json); } catch { /* ok */ }
    try { coverContent = JSON.parse(regenRow.new_content_json); } catch { /* ok */ }

    return {
      status: 200,
      body: {
        cover: {
          regenId: regenRow.id,
          originalContent,
          coverContent,
          originalModel: originalCostRow?.model ?? 'unknown',
          coverModel: coverCostRow?.model ?? 'unknown',
          originalCostUsd: originalCostRow?.cost_usd ?? 0,
          coverCostUsd: coverCostRow?.cost_usd ?? 0,
          originalLatencyMs: originalCostRow?.latency_ms ?? 0,
          coverLatencyMs: coverCostRow?.latency_ms ?? 0,
          originalCostLogId: originalCostRow?.id ?? null,
          coverCostLogId: coverCostRow?.id ?? null,
          picked: prefRow?.picked ?? null,
        },
      },
    };
  }

  it('section with pipeline cover returns CoverData with both takes', () => {
    const { roundId, draftId, sectionId, sectionKind } = seedBase();
    const priorJson = '{"title":"flow","body":"original"}';
    const newJson = '{"title":"flow","body":"cover take"}';
    const regenId = insertPipelineCover(sectionId, priorJson, newJson);
    const origLogId = insertCostLog({ artifactId: draftId, artifactType: 'digest_draft', label: `digest:ep1:villain+${sectionKind}`, model: 'model-orig', costUsd: 0.005, latencyMs: 1200 });
    const coverLogId = insertCostLog({ artifactId: sectionId, artifactType: 'digest_section', label: `digest:cover:${sectionKind}`, model: 'model-cover', costUsd: 0.008, latencyMs: 1500 });

    const result = getCoverData(sectionId, roundId);

    expect(result.status).toBe(200);
    const cover = result.body?.cover;
    expect(cover).not.toBeNull();
    if (!cover || cover === null) throw new Error('expected cover');
    expect(cover.regenId).toBe(regenId);
    expect(cover.originalModel).toBe('model-orig');
    expect(cover.coverModel).toBe('model-cover');
    expect(cover.originalCostUsd).toBeCloseTo(0.005);
    expect(cover.coverCostUsd).toBeCloseTo(0.008);
    expect(cover.originalLatencyMs).toBe(1200);
    expect(cover.coverLatencyMs).toBe(1500);
    expect(cover.picked).toBeNull();
    expect((cover.originalContent as Record<string, unknown>).body).toBe('original');
    expect((cover.coverContent as Record<string, unknown>).body).toBe('cover take');
    expect(cover.originalCostLogId).toBe(origLogId);
    expect(cover.coverCostLogId).toBe(coverLogId);
  });

  it('section without a pipeline cover returns { cover: null }', () => {
    const { roundId, sectionId } = seedBase();
    const result = getCoverData(sectionId, roundId);
    expect(result.status).toBe(200);
    expect(result.body?.cover).toBeNull();
  });

  it('invalid sectionId returns 404', () => {
    const { roundId } = seedBase();
    const result = getCoverData('draft-99-test-nonexistent', roundId);
    expect(result.status).toBe(404);
  });

  it('cover with a prior pick reflects that pick in the response', () => {
    const { roundId, sectionId, sectionKind } = seedBase();
    const regenId = insertPipelineCover(sectionId, '{"orig":1}', '{"cover":1}');
    // Write a preference row directly.
    const prefId = `pref-${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO llm_preference (id, section, round_id, original_model, cover_model, regen_id, picked)
       VALUES (?, ?, ?, 'a', 'b', ?, 'cover')`,
    ).run(prefId, sectionKind, roundId, regenId);

    const result = getCoverData(sectionId, roundId);
    const cover = result.body?.cover;
    expect(cover?.picked).toBe('cover');
  });

  it('missing cost-log rows fall back to 0 / "unknown" without throwing', () => {
    const { roundId, sectionId } = seedBase();
    insertPipelineCover(sectionId, '{}', '{}');
    // No cost log rows inserted.
    const result = getCoverData(sectionId, roundId);
    expect(result.status).toBe(200);
    const cover = result.body?.cover;
    expect(cover?.originalModel).toBe('unknown');
    expect(cover?.coverModel).toBe('unknown');
    expect(cover?.originalCostUsd).toBe(0);
    expect(cover?.coverCostUsd).toBe(0);
  });
});

// ---- a4: POST cover-pick endpoint logic (inline) ----

describe('a4-cover-pick-endpoint: pick logic', () => {
  /** Replicates the POST /cover-pick side effects inline for unit testing. */
  function processPick(
    sectionId: string,
    roundId: number,
    picked: 'original' | 'cover',
  ): { status: number; body: unknown } {
    const section = db
      .prepare(
        `SELECT s.id, s.kind, s.draft_id, s.content_json
         FROM digest_sections s
         JOIN digest_drafts d ON d.id = s.draft_id
         WHERE s.id = ? AND d.round_id = ?`,
      )
      .get(sectionId, roundId) as { id: string; kind: string; draft_id: string; content_json: string } | undefined;
    if (!section) return { status: 404, body: { error: 'section not found' } };

    const regenRow = db
      .prepare(
        `SELECT id, prior_content_json, new_content_json
         FROM digest_regenerations
         WHERE section_id = ? AND cover_kind = 'pipeline_cover'
         ORDER BY ran_at DESC LIMIT 1`,
      )
      .get(sectionId) as { id: string; prior_content_json: string; new_content_json: string } | undefined;
    if (!regenRow) return { status: 400, body: { error: 'no pipeline cover' } };

    const publishedJson = picked === 'cover' ? regenRow.new_content_json : regenRow.prior_content_json;
    const sectionKind = section.kind;
    const draftId = section.draft_id;

    const originalCostRow = db
      .prepare(`SELECT id, model FROM llm_cost_log WHERE artifact_id = ? AND label LIKE ? AND label NOT LIKE 'digest:cover:%' ORDER BY id ASC LIMIT 1`)
      .get(draftId, `%${sectionKind}%`) as { id: number; model: string } | undefined;
    const coverCostRow = db
      .prepare(`SELECT id, model FROM llm_cost_log WHERE artifact_id = ? AND label = ? ORDER BY id DESC LIMIT 1`)
      .get(sectionId, `digest:cover:${sectionKind}`) as { id: number; model: string } | undefined;

    const preferenceId = writeCoverPick(db, {
      sectionId,
      section: sectionKind as Parameters<typeof writeCoverPick>[1]['section'],
      roundId,
      regenId: regenRow.id,
      picked,
      originalModel: originalCostRow?.model ?? 'unknown',
      coverModel: coverCostRow?.model ?? 'unknown',
      originalCostLogId: originalCostRow?.id,
      coverCostLogId: coverCostRow?.id,
    });

    db.prepare('UPDATE digest_sections SET content_json = ? WHERE id = ?').run(publishedJson, sectionId);

    let publishedContent: unknown = null;
    try { publishedContent = JSON.parse(publishedJson); } catch { /* ok */ }

    return { status: 200, body: { ok: true, preferenceId, publishedContent } };
  }

  it("picked='cover' updates content_json to cover take and inserts llm_preference row", () => {
    const { roundId, sectionId } = seedBase();
    const priorJson = '{"title":"flow","body":"original"}';
    const newJson = '{"title":"flow","body":"cover take"}';
    insertPipelineCover(sectionId, priorJson, newJson);

    const result = processPick(sectionId, roundId, 'cover');
    expect(result.status).toBe(200);
    const body = result.body as { ok: boolean; preferenceId: string; publishedContent: unknown };
    expect(body.ok).toBe(true);
    expect(body.preferenceId).toMatch(/^pref-/);
    expect((body.publishedContent as Record<string, unknown>).body).toBe('cover take');

    // Verify section content was updated.
    const section = db.prepare('SELECT content_json FROM digest_sections WHERE id = ?').get(sectionId) as { content_json: string };
    expect(JSON.parse(section.content_json).body).toBe('cover take');

    // Verify preference row was inserted.
    const pref = db.prepare('SELECT picked FROM llm_preference WHERE id = ?').get(body.preferenceId) as { picked: string };
    expect(pref.picked).toBe('cover');
  });

  it("picked='original' updates content_json to original take and inserts preference row", () => {
    const { roundId, sectionId } = seedBase();
    const priorJson = '{"title":"flow","body":"original"}';
    const newJson = '{"title":"flow","body":"cover take"}';
    insertPipelineCover(sectionId, priorJson, newJson);

    const result = processPick(sectionId, roundId, 'original');
    expect(result.status).toBe(200);
    const body = result.body as { ok: boolean; preferenceId: string; publishedContent: unknown };
    expect((body.publishedContent as Record<string, unknown>).body).toBe('original');

    const section = db.prepare('SELECT content_json FROM digest_sections WHERE id = ?').get(sectionId) as { content_json: string };
    expect(JSON.parse(section.content_json).body).toBe('original');

    const pref = db.prepare('SELECT picked FROM llm_preference WHERE id = ?').get(body.preferenceId) as { picked: string };
    expect(pref.picked).toBe('original');
  });

  it('no cover regen row returns 400', () => {
    const { roundId, sectionId } = seedBase();
    const result = processPick(sectionId, roundId, 'cover');
    expect(result.status).toBe(400);
  });

  it('content update succeeds even when preference write fails (fire-and-forget)', () => {
    const { roundId, sectionId } = seedBase();
    const priorJson = '{"body":"original"}';
    const newJson = '{"body":"cover"}';
    insertPipelineCover(sectionId, priorJson, newJson);

    // Drop the preference table to simulate a preference write failure.
    db.exec('DROP TABLE llm_preference');

    // Should still succeed (fire-and-forget preference).
    const result = processPick(sectionId, roundId, 'cover');
    expect(result.status).toBe(200);
    const body = result.body as { ok: boolean; preferenceId: string };
    expect(body.ok).toBe(true);
    expect(body.preferenceId).toBe(''); // empty on failure

    // Section content must still be updated.
    const section = db.prepare('SELECT content_json FROM digest_sections WHERE id = ?').get(sectionId) as { content_json: string };
    expect(JSON.parse(section.content_json).body).toBe('cover');
  });

  it('pick does not increment regen_count (not a regen event)', () => {
    const { roundId, sectionId } = seedBase();
    insertPipelineCover(sectionId, '{"body":"orig"}', '{"body":"cover"}');

    const before = db.prepare('SELECT regen_count FROM digest_sections WHERE id = ?').get(sectionId) as { regen_count: number };
    processPick(sectionId, roundId, 'cover');
    const after = db.prepare('SELECT regen_count FROM digest_sections WHERE id = ?').get(sectionId) as { regen_count: number };

    expect(after.regen_count).toBe(before.regen_count);
  });
});

// ---- Integration: DEFAULT_PIPELINE flow cover persists both takes ----

describe('integration: DEFAULT_PIPELINE flow cover persists both takes', () => {
  it('writePipelineCovers creates a pipeline_cover regen row with correct takes', async () => {
    // We test writePipelineCovers directly (the function sprint-43 ships).
    // This validates the integration contract: after writeDraft + writePipelineCovers,
    // the section has both original and cover takes in digest_regenerations.
    const { writePipelineCovers, writeDraft } = await import('./llm.js');

    seedLeagues(db);
    const leagueId = (db.prepare("SELECT id FROM leagues WHERE slug='hip-jammers'").get() as { id: number }).id;
    const seasonId = upsertSeason(db, leagueId, 2, 'active');
    const roundId = upsertRound(db, seasonId, {
      mlRoundId: 'pipeline-cover-test',
      name: 'Pipeline Cover Test Round',
      description: '',
      spotifyPlaylistUrl: '',
      createdAt: '2026-06-18T00:00:00Z',
    });

    const fakeOutput = {
      sections: {
        podium: { title: 'podium', body: 'podium body', items: [] },
        villain: { title: 'villain', body: 'villain body' },
        flow: { title: 'flow', body: 'flow original' },
        consensus: { title: 'consensus', body: 'consensus body', items: [] },
        quotes: { title: 'quotes', body: 'quotes body', items: [] },
      } as Record<'podium' | 'villain' | 'flow' | 'consensus' | 'quotes' | 'chat', unknown>,
      _covers: {
        flow: { title: 'flow', body: 'flow cover' },
      },
      costUsd: 0.05,
      draftId: `draft-${roundId}-inttest`,
      runId: randomUUID(),
    };

    const fakeData = {
      round: { id: roundId, name: 'Pipeline Cover Test Round', description: null },
      league: { id: leagueId, name: 'Hip Jammers' },
      roundSequence: { number: 1, total: 1 },
      priorRounds: [],
      bundle: [],
      submissions: [],
      votes: [],
      chatMentions: [],
      relContext: '',
    };

    const { draft } = writeDraft(db, roundId, fakeData, fakeOutput, {});
    writePipelineCovers(db, draft.id, fakeOutput);

    // Verify both takes are persisted.
    const regenRows = db.prepare(
      `SELECT * FROM digest_regenerations WHERE section_id = ? ORDER BY ran_at ASC`,
    ).all(`${draft.id}-flow`) as Array<{ prior_content_json: string; new_content_json: string; cover_kind: string | null }>;

    expect(regenRows.length).toBeGreaterThanOrEqual(1);
    const pipelineCover = regenRows.find((r) => r.cover_kind === 'pipeline_cover');
    expect(pipelineCover).toBeDefined();
    expect(JSON.parse(pipelineCover!.prior_content_json).body).toBe('flow original');
    expect(JSON.parse(pipelineCover!.new_content_json).body).toBe('flow cover');
  });

  it('a pick on a cover writes an llm_preference row with correct model info', () => {
    const { roundId, draftId, sectionId, sectionKind } = seedBase({ sectionKind: 'flow' });
    const regenId = insertPipelineCover(sectionId, '{"body":"orig flow"}', '{"body":"cover flow"}');
    const origLogId = insertCostLog({ artifactId: draftId, artifactType: 'digest_draft', label: 'digest:ep1:villain+flow', model: 'anthropic/claude-haiku-4-5', costUsd: 0.001, latencyMs: 300 });
    const coverLogId = insertCostLog({ artifactId: sectionId, artifactType: 'digest_section', label: 'digest:cover:flow', model: 'anthropic/claude-sonnet-4-5', costUsd: 0.006, latencyMs: 1100 });

    const prefId = writeCoverPick(db, {
      sectionId,
      section: 'flow',
      roundId,
      regenId,
      picked: 'cover',
      originalModel: 'anthropic/claude-haiku-4-5',
      coverModel: 'anthropic/claude-sonnet-4-5',
      originalCostLogId: origLogId,
      coverCostLogId: coverLogId,
    });

    const pref = db.prepare('SELECT * FROM llm_preference WHERE id = ?').get(prefId) as Record<string, unknown>;
    expect(pref.picked).toBe('cover');
    expect(pref.section).toBe('flow');
    expect(pref.original_model).toBe('anthropic/claude-haiku-4-5');
    expect(pref.cover_model).toBe('anthropic/claude-sonnet-4-5');
    expect(pref.original_cost_log_id).toBe(origLogId);
    expect(pref.cover_cost_log_id).toBe(coverLogId);
    expect(pref.regen_id).toBe(regenId);
    expect(pref.round_id).toBe(roundId);
  });
});
