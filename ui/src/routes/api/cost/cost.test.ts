/**
 * a6-cost-api: tests for /api/cost/summary, /api/cost/daily, /api/cost/calls
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { openLeagueDb } from '$lib/db/client.js';
import type Database from 'better-sqlite3';

let db: Database.Database;

vi.mock('$lib/db/client.js', async (orig) => {
  const actual = await orig<typeof import('$lib/db/client.js')>();
  return { ...actual, getDb: () => db };
});

// Import handlers AFTER mock is set up
import { GET as summaryGET } from './summary/+server.js';
import { GET as dailyGET } from './daily/+server.js';
import { GET as callsGET } from './calls/+server.js';

beforeEach(() => {
  db = openLeagueDb(':memory:');
});

// Helper: build a minimal SvelteKit-like request event
function mkEvent(search: string = ''): Parameters<typeof summaryGET>[0] {
  const url = new URL(`http://localhost/api/cost/summary${search}`);
  return { url } as Parameters<typeof summaryGET>[0];
}

function mkDailyEvent(search: string = ''): Parameters<typeof dailyGET>[0] {
  const url = new URL(`http://localhost/api/cost/daily${search}`);
  return { url } as Parameters<typeof dailyGET>[0];
}

function mkCallsEvent(search: string = ''): Parameters<typeof callsGET>[0] {
  const url = new URL(`http://localhost/api/cost/calls${search}`);
  return { url } as Parameters<typeof callsGET>[0];
}

// Helper: insert rows into both source tables
function insertDigestRow(opts: {
  model?: string; category?: string; label?: string;
  cost_usd?: number; latency_ms?: number;
  prompt_tokens?: number; completion_tokens?: number;
  created_at?: string;
} = {}) {
  const now = opts.created_at ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  db.prepare(`
    INSERT INTO llm_cost_log (model, category, label, cost_usd, latency_ms,
      prompt_tokens, completion_tokens, total_tokens, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    opts.model ?? 'anthropic/claude-sonnet-4-5',
    opts.category ?? 'digest',
    opts.label ?? 'digest:full',
    opts.cost_usd ?? 0.01,
    opts.latency_ms ?? 1000,
    opts.prompt_tokens ?? 100,
    opts.completion_tokens ?? 50,
    (opts.prompt_tokens ?? 100) + (opts.completion_tokens ?? 50),
    now,
  );
}

function insertPredictRow(opts: {
  model?: string; category?: string; label?: string;
  cost_usd?: number; latency_ms?: number;
  prompt_tokens?: number; completion_tokens?: number;
  created_at?: string;
} = {}) {
  const now = opts.created_at ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const id = `run-${Math.random().toString(36).slice(2)}`;
  db.prepare(`
    INSERT INTO prediction_runs (id, task_id, model, cost_usd, latency_ms,
      prompt_tokens, completion_tokens, total_tokens, category, label, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, 'test-task',
    opts.model ?? 'anthropic/claude-haiku-4-5',
    opts.cost_usd ?? 0.002,
    opts.latency_ms ?? 500,
    opts.prompt_tokens ?? 80,
    opts.completion_tokens ?? 40,
    (opts.prompt_tokens ?? 80) + (opts.completion_tokens ?? 40),
    opts.category ?? 'predict',
    opts.label ?? 'predict:test-task',
    now,
  );
}

describe('GET /api/cost/summary', () => {
  it('returns zeroes when no rows exist for the date', async () => {
    const res = await summaryGET(mkEvent('?date=2020-01-01'));
    const body = await res.json();
    expect(body).toEqual({ digest: 0, archive: 0, predict: 0, avatar: 0, total: 0 });
  });

  it('sums digest and predict rows from both tables', async () => {
    insertDigestRow({ cost_usd: 0.01, category: 'digest' });
    insertPredictRow({ cost_usd: 0.002, category: 'predict' });

    const today = new Date().toISOString().slice(0, 10);
    const res = await summaryGET(mkEvent(`?date=${today}`));
    const body = await res.json();

    expect(body.digest).toBeCloseTo(0.01);
    expect(body.predict).toBeCloseTo(0.002);
    expect(body.total).toBeCloseTo(0.012);
  });

  it('defaults to today when no date param given', async () => {
    insertDigestRow({ cost_usd: 0.005, category: 'digest' });

    const res = await summaryGET(mkEvent());
    const body = await res.json();
    expect(body.digest).toBeCloseTo(0.005);
    expect(body.total).toBeCloseTo(0.005);
  });

  it('does not include rows from a different date', async () => {
    insertDigestRow({ cost_usd: 0.01, created_at: '2020-06-01T12:00:00Z' });

    const res = await summaryGET(mkEvent('?date=2020-06-02'));
    const body = await res.json();
    expect(body.total).toBe(0);
  });
});

describe('GET /api/cost/daily', () => {
  it('returns 14 entries by default with zero-fill for gap days', async () => {
    const res = await dailyGET(mkDailyEvent());
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(14);
    // All entries should have the three categories
    for (const entry of body) {
      expect(typeof entry.date).toBe('string');
      expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof entry.digest).toBe('number');
      expect(typeof entry.archive).toBe('number');
      expect(typeof entry.predict).toBe('number');
    }
  });

  it('returns N entries when days param is specified', async () => {
    const res = await dailyGET(mkDailyEvent('?days=7'));
    const body = await res.json();
    expect(body).toHaveLength(7);
  });

  it('zero-fills a day with no rows', async () => {
    // No rows inserted — all days should be zero
    const res = await dailyGET(mkDailyEvent('?days=3'));
    const body = await res.json();
    for (const entry of body) {
      expect(entry.digest).toBe(0);
      expect(entry.archive).toBe(0);
      expect(entry.predict).toBe(0);
    }
  });

  it('includes today costs in the last entry', async () => {
    insertDigestRow({ cost_usd: 0.007, category: 'archive' });

    const res = await dailyGET(mkDailyEvent('?days=3'));
    const body = await res.json();
    const last = body[body.length - 1];
    expect(last.archive).toBeCloseTo(0.007);
  });
});

describe('GET /api/cost/calls', () => {
  it('returns empty array when no rows for the date', async () => {
    const res = await callsGET(mkCallsEvent('?date=2020-01-01'));
    const body = await res.json();
    expect(body).toEqual([]);
  });

  it('returns rows from both digest and predict tables', async () => {
    insertDigestRow({ cost_usd: 0.01, category: 'digest', label: 'digest:full' });
    insertPredictRow({ cost_usd: 0.003, category: 'predict', label: 'predict:vote-probe' });

    const today = new Date().toISOString().slice(0, 10);
    const res = await callsGET(mkCallsEvent(`?date=${today}`));
    const body = await res.json() as { category: string }[];
    expect(body).toHaveLength(2);
    const categories = body.map(r => r.category).sort();
    expect(categories).toEqual(['digest', 'predict']);
  });

  it('returns newest-first (desc by ts)', async () => {
    insertDigestRow({ cost_usd: 0.001, created_at: '2025-06-18T10:00:00Z' });
    insertDigestRow({ cost_usd: 0.002, created_at: '2025-06-18T11:00:00Z' });

    const res = await callsGET(mkCallsEvent('?date=2025-06-18'));
    const body = await res.json() as { ts: string; cost_usd: number }[];
    expect(body).toHaveLength(2);
    expect(body[0].ts > body[1].ts).toBe(true);
    expect(body[0].cost_usd).toBeCloseTo(0.002);
  });

  it('defaults to today when no date param given', async () => {
    insertDigestRow({ cost_usd: 0.005 });

    const res = await callsGET(mkCallsEvent());
    const body = await res.json() as { cost_usd: number }[];
    expect(body.length).toBeGreaterThan(0);
    expect(body[0].cost_usd).toBeCloseTo(0.005);
  });

  it('caps at 500 rows', async () => {
    // Insert 510 rows
    for (let i = 0; i < 510; i++) {
      insertDigestRow({ cost_usd: 0.0001 });
    }
    const today = new Date().toISOString().slice(0, 10);
    const res = await callsGET(mkCallsEvent(`?date=${today}`));
    const body = await res.json() as unknown[];
    expect(body.length).toBeLessThanOrEqual(500);
  });

  it('includes ts, model, category, label, cost_usd, latency_ms, prompt_tokens, completion_tokens', async () => {
    insertDigestRow({ cost_usd: 0.01, latency_ms: 1200, prompt_tokens: 100, completion_tokens: 50 });
    const today = new Date().toISOString().slice(0, 10);
    const res = await callsGET(mkCallsEvent(`?date=${today}`));
    const body = await res.json() as Record<string, unknown>[];
    expect(body[0]).toMatchObject({
      cost_usd: expect.any(Number),
      latency_ms: expect.any(Number),
      prompt_tokens: expect.any(Number),
      completion_tokens: expect.any(Number),
      model: expect.any(String),
      category: expect.any(String),
      label: expect.any(String),
      ts: expect.any(String),
    });
  });
});
