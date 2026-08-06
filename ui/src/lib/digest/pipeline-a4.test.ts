/**
 * sprint-43 a4: Tests for cover_kind column and writePipelineCovers.
 *
 * Verifies:
 *   - cover_kind column exists after openLeagueDb
 *   - writePipelineCovers inserts a digest_regenerations row with cover_kind='pipeline_cover'
 *   - original section remains in sections; cover in _covers
 *   - no cover rows when _covers is absent
 */

import { it, expect, describe, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openLeagueDb } from '../db/client.js';
import { writeDraft, writePipelineCovers, type DraftLLMOutput } from './llm.js';
import type { RoundData, RoundBundleEntry } from './llm.js';

let db: Database.Database;

function mkBundleEntry(round_number: number, name: string): RoundBundleEntry {
  return { round_number, name, top3: [], bottom1: null, winner: null, isCurrent: false, isPrev: false };
}

function mkData(): RoundData {
  return {
    round: { id: 42, name: 'Cover Test Round', description: null },
    league: { id: 1, name: 'Test League' },
    roundSequence: { number: 1, total: 1 },
    priorRounds: [],
    bundle: [mkBundleEntry(1, 'Cover Test Round')],
    submissions: [],
    votes: [],
    chatMentions: [],
    relContext: '',
  };
}

// A minimal DraftLLMOutput with the required sections.
function mkOutput(overrides: Partial<DraftLLMOutput> = {}): DraftLLMOutput {
  return {
    sections: {
      podium: { title: 'Podium', items: [], body: 'p' },
      villain: { title: 'Villain', body: 'v' },
      flow: { title: 'Flow', body: 'f' },
      consensus: { title: 'Consensus', items: [] },
      quotes: { title: 'Quotes', items: [] },
      chat: { title: 'Chat', summary: '', moments: [] },
      storylines: { title: 'Storylines', cast: [] },
    },
    costUsd: 0.01,
    draftId: `draft-42-testcvr`,
    runId: 'run-test-cover',
    ...overrides,
  };
}

beforeEach(() => {
  db = openLeagueDb(':memory:');
  // Insert fixture rows so writeDraft FK constraints pass (insert in FK-safe order).
  db.prepare("INSERT OR IGNORE INTO leagues (id, slug, name) VALUES (?, ?, ?)").run(1, 'test-league', 'Test League');
  db.prepare("INSERT OR IGNORE INTO seasons (id, league_id, season_number, status) VALUES (?, ?, ?, ?)").run(1, 1, 1, 'active');
  db.prepare("INSERT OR IGNORE INTO rounds (id, name, season_id, ml_round_id, created_at) VALUES (?, ?, ?, ?, ?)").run(42, 'Cover Test Round', 1, 'ml-round-42', new Date().toISOString());
});

describe('schema: cover_kind column', () => {
  it('digest_regenerations has cover_kind column after openLeagueDb', () => {
    const cols = db.prepare("PRAGMA table_info(digest_regenerations)").all() as { name: string }[];
    const colNames = cols.map(c => c.name);
    expect(colNames).toContain('cover_kind');
  });
});

describe('writePipelineCovers', () => {
  it('inserts a digest_regenerations row with cover_kind=pipeline_cover', () => {
    const output = mkOutput({
      _covers: {
        villain: { title: 'Villain Cover', body: 'cover villain body' },
      },
    });

    // First write the draft so the section row exists for the FK.
    writeDraft(db, 42, mkData(), output, {});

    // Now write the covers.
    writePipelineCovers(db, output.draftId!, output);

    const rows = db.prepare(
      "SELECT * FROM digest_regenerations WHERE cover_kind = 'pipeline_cover'"
    ).all() as { cover_kind: string; section_id: string; prior_content_json: string; new_content_json: string }[];

    expect(rows).toHaveLength(1);
    expect(rows[0].cover_kind).toBe('pipeline_cover');
    expect(rows[0].section_id).toBe(`${output.draftId}-villain`);

    // prior = original; new = cover.
    const prior = JSON.parse(rows[0].prior_content_json) as { body?: string };
    expect(prior.body).toBe('v');
    const newContent = JSON.parse(rows[0].new_content_json) as { body?: string };
    expect(newContent.body).toBe('cover villain body');
  });

  it('inserts one row per cover section', () => {
    const output = mkOutput({
      _covers: {
        villain: { title: 'Villain Cover', body: 'cv' },
        flow: { title: 'Flow Cover', body: 'cf' },
      },
    });

    writeDraft(db, 42, mkData(), output, {});
    writePipelineCovers(db, output.draftId!, output);

    const rows = db.prepare(
      "SELECT * FROM digest_regenerations WHERE cover_kind = 'pipeline_cover'"
    ).all() as { section_id: string }[];
    expect(rows).toHaveLength(2);
    const sectionIds = rows.map(r => r.section_id);
    expect(sectionIds).toContain(`${output.draftId}-villain`);
    expect(sectionIds).toContain(`${output.draftId}-flow`);
  });

  it('no-op when _covers is absent', () => {
    const output = mkOutput(); // no _covers
    writeDraft(db, 42, mkData(), output, {});
    writePipelineCovers(db, output.draftId!, output);

    const rows = db.prepare(
      "SELECT * FROM digest_regenerations WHERE cover_kind = 'pipeline_cover'"
    ).all();
    expect(rows).toHaveLength(0);
  });

  it('original section is preserved in output.sections even when cover exists', () => {
    const output = mkOutput({
      _covers: {
        villain: { title: 'Villain Cover', body: 'cover' },
      },
    });
    // Original villain.body should remain 'v'.
    const original = output.sections['villain'] as { body: string };
    expect(original.body).toBe('v');
    // Cover in _covers.
    const cover = output._covers!['villain'] as { body: string };
    expect(cover.body).toBe('cover');
  });
});
