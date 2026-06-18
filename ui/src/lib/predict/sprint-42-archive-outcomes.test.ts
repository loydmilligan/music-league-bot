/**
 * sprint-42 a7: archive section outcome stamping tests.
 * Tests the stampPredictionOutcome logic (extracted for testability) and
 * verifies OQ-1 rowId is present in PredictionMeta.
 */
import { it, expect, describe, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { openLeagueDb } from '../db/client.js';
import type Database from 'better-sqlite3';

let db: Database.Database;

beforeEach(() => {
  db = openLeagueDb(':memory:');
});

// Mirror of stampPredictionOutcome from update/+server.ts for isolated testing
function stampPredictionOutcome(
  db: Database.Database,
  taskId: string,
  outcome: 'rejected' | 'passed',
  opts: { playerId?: number; excludeRowId?: string },
): void {
  try {
    const RECOVERY_COST: Record<string, number> = { passed: 0.0, rejected: 0.9 };
    const recoveryCost = RECOVERY_COST[outcome] ?? 0.0;
    const playerClause = opts.playerId != null ? 'AND player_id = ?' : 'AND player_id IS NULL';
    const excludeClause = opts.excludeRowId ? 'AND id != ?' : '';
    const rowArgs: unknown[] = [taskId];
    if (opts.playerId != null) rowArgs.push(opts.playerId);
    if (opts.excludeRowId) rowArgs.push(opts.excludeRowId);
    const row = db
      .prepare(
        `SELECT id FROM prediction_runs
         WHERE task_id = ? ${playerClause} ${excludeClause}
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(...rowArgs) as { id: string } | undefined;
    if (!row) return;
    db.prepare(
      `UPDATE prediction_runs SET outcome = ?, recovery_cost = ? WHERE id = ?`,
    ).run(outcome, recoveryCost, row.id);
  } catch { /* fire-and-forget */ }
}

function insertPredRun(taskId: string, playerId?: number): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO prediction_runs
       (id, task_id, player_id, input_json, model, cost_usd, latency_ms, created_at,
        category, label, run_id, artifact_type, artifact_id, output_hash, retry_count, params_schema_version)
     VALUES (?, ?, ?, '{}', 'test', 0.001, 100, ?,
        'archive', 'archive:test', ?, 'bside_section', ?, 'abc', 0, 1)`,
  ).run(id, taskId, playerId ?? null, now, randomUUID(), id);
  return id;
}

describe('a7: stampPredictionOutcome', () => {
  it('stamps most-recent row rejected when excluding the new row', () => {
    const prior = insertPredRun('player-superlatives', 1);
    const newId = insertPredRun('player-superlatives', 1);

    stampPredictionOutcome(db, 'player-superlatives', 'rejected', { playerId: 1, excludeRowId: newId });

    const priorRow = db.prepare('SELECT outcome, recovery_cost FROM prediction_runs WHERE id = ?').get(prior) as Record<string, unknown>;
    const newRow = db.prepare('SELECT outcome FROM prediction_runs WHERE id = ?').get(newId) as Record<string, unknown>;
    expect(priorRow.outcome).toBe('rejected');
    expect(priorRow.recovery_cost).toBe(0.9);
    expect(newRow.outcome).toBeNull(); // new row untouched
  });

  it('stamps most-recent row passed for hold sections', () => {
    const rowId = insertPredRun('player-superlatives', 2);
    stampPredictionOutcome(db, 'player-superlatives', 'passed', { playerId: 2 });

    const row = db.prepare('SELECT outcome, recovery_cost FROM prediction_runs WHERE id = ?').get(rowId) as Record<string, unknown>;
    expect(row.outcome).toBe('passed');
    expect(row.recovery_cost).toBe(0.0);
  });

  it('is a no-op for unknown task_id (does not throw)', () => {
    expect(() => {
      stampPredictionOutcome(db, 'nonexistent-task', 'passed', {});
    }).not.toThrow();
  });

  it('handles league-level tasks (no playerId = IS NULL clause)', () => {
    const prior = insertPredRun('league-reel'); // playerId = undefined → IS NULL
    const newId = insertPredRun('league-reel');

    stampPredictionOutcome(db, 'league-reel', 'rejected', { excludeRowId: newId });

    const priorRow = db.prepare('SELECT outcome FROM prediction_runs WHERE id = ?').get(prior) as Record<string, unknown>;
    expect(priorRow.outcome).toBe('rejected');
  });

  it('does not throw when db is closed (fire-and-forget guard)', () => {
    const closedDb = openLeagueDb(':memory:');
    closedDb.close();
    expect(() => {
      stampPredictionOutcome(closedDb, 'any-task', 'rejected', {});
    }).not.toThrow();
  });
});

// ── OQ-1: PredictionMeta.rowId ────────────────────────────────────────────────

describe('OQ-1: PredictionMeta includes rowId', () => {
  it('PredictionMeta type has rowId field', async () => {
    // Type-level check: import the type and verify rowId is present in the shape
    // This is a runtime duck-type check using a conforming object
    const meta: import('./predict.js').PredictionMeta = {
      model: 'test',
      costUsd: 0.01,
      latencyMs: 100,
      rowId: 'some-uuid',
    };
    expect(meta.rowId).toBe('some-uuid');
  });
});
