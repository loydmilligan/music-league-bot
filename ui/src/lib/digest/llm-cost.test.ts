/**
 * a2-llmresult: tests for logLlmCall, LLMResult shape, and callOpenRouter extension.
 */
import { it, expect, describe, vi, beforeEach } from 'vitest';
import { openLeagueDb } from '../db/client.js';
import { logLlmCall, type LLMResult, type LLMCallMeta } from './llm.js';
import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';

let db: Database.Database;
beforeEach(() => {
  db = openLeagueDb(':memory:');
});

function mkResult(overrides: Partial<LLMResult> = {}): LLMResult {
  return {
    content: 'hello world',
    costUsd: 0.005,
    promptTokens: 100,
    completionTokens: 50,
    totalTokens: 150,
    latencyMs: 1200,
    ...overrides,
  };
}

function mkMeta(overrides: Partial<LLMCallMeta> = {}): LLMCallMeta {
  return {
    category: 'digest',
    label: 'digest:full',
    db,
    leagueId: 1,
    roundId: 42,
    ...overrides,
  };
}

describe('logLlmCall — basic insertion', () => {
  it('inserts a row with cost, latency, and token counts', () => {
    const result = mkResult();
    logLlmCall(result, { model: 'anthropic/claude-sonnet-4-5' }, mkMeta());

    const row = db.prepare('SELECT * FROM llm_cost_log').get() as Record<string, unknown>;
    expect(row).toBeTruthy();
    expect(row.cost_usd).toBe(0.005);
    expect(row.latency_ms).toBe(1200);
    expect(row.prompt_tokens).toBe(100);
    expect(row.completion_tokens).toBe(50);
    expect(row.total_tokens).toBe(150);
    expect(row.category).toBe('digest');
    expect(row.label).toBe('digest:full');
    expect(row.league_id).toBe(1);
    expect(row.round_id).toBe(42);
  });

  it('sets output_hash to sha256 of content', () => {
    const content = 'test content for hashing';
    const expectedHash = createHash('sha256').update(content).digest('hex');
    logLlmCall(mkResult({ content }), { model: 'test' }, mkMeta());

    const row = db.prepare('SELECT output_hash FROM llm_cost_log').get() as { output_hash: string };
    expect(row.output_hash).toBe(expectedHash);
  });

  it('stores params blob with schema version 1 when params present in body', () => {
    const body = {
      model: 'anthropic/claude-sonnet-4-5',
      temperature: 0.7,
      max_tokens: 4096,
      response_format: { type: 'json_object' },
    };
    logLlmCall(mkResult(), body, mkMeta());

    const row = db.prepare('SELECT params, params_schema_version FROM llm_cost_log').get() as {
      params: string;
      params_schema_version: number;
    };
    expect(row.params_schema_version).toBe(1);
    const params = JSON.parse(row.params);
    expect(params.temperature).toBe(0.7);
    expect(params.max_tokens).toBe(4096);
    expect(params.response_format).toEqual({ type: 'json_object' });
  });

  it('stores null params when body has no known param keys', () => {
    logLlmCall(mkResult(), { model: 'test', messages: [] }, mkMeta());

    const row = db.prepare('SELECT params, params_schema_version FROM llm_cost_log').get() as {
      params: string | null;
      params_schema_version: number | null;
    };
    expect(row.params).toBeNull();
    expect(row.params_schema_version).toBeNull();
  });
});

describe('logLlmCall — passive capture fields', () => {
  it('stores run_id, artifact_type, artifact_id, prompt_version from meta', () => {
    logLlmCall(mkResult(), { model: 'test' }, mkMeta({
      runId: 'run-abc-123',
      artifactType: 'digest_draft',
      artifactId: 'draft-42-x1y2',
      promptVersion: 'v1.2',
    }));

    const row = db.prepare('SELECT run_id, artifact_type, artifact_id, prompt_version FROM llm_cost_log').get() as Record<string, string>;
    expect(row.run_id).toBe('run-abc-123');
    expect(row.artifact_type).toBe('digest_draft');
    expect(row.artifact_id).toBe('draft-42-x1y2');
    expect(row.prompt_version).toBe('v1.2');
  });

  it('stores retry_count correctly', () => {
    logLlmCall(mkResult(), { model: 'test' }, mkMeta(), 2);

    const row = db.prepare('SELECT retry_count FROM llm_cost_log').get() as { retry_count: number };
    expect(row.retry_count).toBe(2);
  });

  it('stores outcome=unusable when provided', () => {
    logLlmCall(mkResult(), { model: 'test' }, mkMeta(), 0, 'unusable');

    const row = db.prepare('SELECT outcome FROM llm_cost_log').get() as { outcome: string };
    expect(row.outcome).toBe('unusable');
  });

  it('stores null outcome when not provided', () => {
    logLlmCall(mkResult(), { model: 'test' }, mkMeta());

    const row = db.prepare('SELECT outcome FROM llm_cost_log').get() as { outcome: string | null };
    expect(row.outcome).toBeNull();
  });
});

describe('logLlmCall — fire-and-forget error resilience', () => {
  it('does not throw when db write fails (closed db)', () => {
    const closed = openLeagueDb(':memory:');
    closed.close();
    expect(() => logLlmCall(mkResult(), { model: 'test' }, { ...mkMeta(), db: closed })).not.toThrow();
  });
});

describe('LLMResult — shape contract', () => {
  it('LLMResult includes promptTokens, completionTokens, totalTokens, latencyMs', () => {
    // Type-level check: this compiles if the interface has the fields
    const r: LLMResult = {
      content: 'hi',
      costUsd: 0,
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
      latencyMs: 500,
    };
    expect(r.promptTokens).toBe(10);
    expect(r.completionTokens).toBe(5);
    expect(r.totalTokens).toBe(15);
    expect(r.latencyMs).toBe(500);
  });
});
