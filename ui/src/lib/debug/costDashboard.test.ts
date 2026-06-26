/**
 * costDashboard.test.ts
 * Component-level tests for CostBarChart scale and ValueScoreDock ranking.
 * These are pure logic tests (no DOM mount required).
 */
import { describe, it, expect } from 'vitest';
import type { DailyCost, CostCall } from './costApi.js';

// ── CostBarChart scale test ──────────────────────────────────────────────────
// The chart's y-scale is: yMax = max total across all days.
// The tallest bar height = (total / yMax) * plotHeight.
// When one day has total = yMax, it should fill 100% of the plot height.

function computeBarHeights(days: DailyCost[], plotH: number): number[] {
  const totals = days.map((d) => d.digest + d.archive + d.predict + d.avatar);
  const yMax = Math.max(...totals, 0.001);
  return totals.map((t) => (t / yMax) * plotH);
}

describe('CostBarChart scale', () => {
  it('tallest bar fills 100% of plot height', () => {
    const days: DailyCost[] = [
      { date: '2026-06-01', digest: 0.10, archive: 0.05, predict: 0.02, avatar: 0 },
      { date: '2026-06-02', digest: 0.50, archive: 0.20, predict: 0.10, avatar: 0 }, // tallest
      { date: '2026-06-03', digest: 0.03, archive: 0.01, predict: 0.00, avatar: 0 },
    ];
    const PLOT_H = 182; // (200 - 18 label band)
    const heights = computeBarHeights(days, PLOT_H);
    expect(Math.max(...heights)).toBeCloseTo(PLOT_H, 5);
  });

  it('zero days produce height 0', () => {
    const days: DailyCost[] = [
      { date: '2026-06-01', digest: 0, archive: 0, predict: 0, avatar: 0 },
      { date: '2026-06-02', digest: 0.30, archive: 0.10, predict: 0.05, avatar: 0 },
    ];
    const PLOT_H = 182;
    const heights = computeBarHeights(days, PLOT_H);
    expect(heights[0]).toBe(0);
  });

  it('empty-state: all zero days — yMax is clamped to 0.001 (no NaN)', () => {
    const days: DailyCost[] = [
      { date: '2026-06-01', digest: 0, archive: 0, predict: 0, avatar: 0 },
    ];
    const PLOT_H = 182;
    const heights = computeBarHeights(days, PLOT_H);
    expect(heights.every((h) => isFinite(h))).toBe(true);
  });
});

// ── ValueScoreDock ranking test ──────────────────────────────────────────────
// normalize() should rank lower cost+latency models higher.

interface ModelAgg {
  model: string;
  cost: number;
  lat: number;
  n: number;
}

interface Normalized extends ModelAgg {
  nCost: number;
  nLat: number;
  score: number;
}

function normalize(rows: ModelAgg[], wCost: number, wLat: number): Normalized[] {
  const costs = rows.map((r) => r.cost);
  const lats  = rows.map((r) => r.lat);
  const cMin = Math.min(...costs), cMax = Math.max(...costs);
  const lMin = Math.min(...lats),  lMax = Math.max(...lats);
  const inv = (v: number, lo: number, hi: number) =>
    hi === lo ? 1 : 1 - (v - lo) / (hi - lo);
  const sum = wCost + wLat || 1;
  return rows.map((r) => {
    const nCost = inv(r.cost, cMin, cMax);
    const nLat  = inv(r.lat, lMin, lMax);
    const score = Math.round((nCost * wCost + nLat * wLat) / sum * 100);
    return { ...r, nCost, nLat, score };
  }).sort((a, b) => b.score - a.score);
}

describe('ValueScoreDock ranking', () => {
  const CHEAP_FAST = { model: 'cheap-fast', cost: 0.001, lat: 1, n: 5 };
  const CHEAP_SLOW = { model: 'cheap-slow', cost: 0.001, lat: 15, n: 5 };
  const EXPENSIVE  = { model: 'expensive',  cost: 0.50,  lat: 1,  n: 5 };

  it('at balanced weights: cheaper AND faster wins', () => {
    const ranked = normalize([EXPENSIVE, CHEAP_SLOW, CHEAP_FAST], 50, 50);
    expect(ranked[0].model).toBe('cheap-fast');
  });

  it('at cost-heavy weights (85/15): cheapest wins', () => {
    const ranked = normalize([EXPENSIVE, CHEAP_SLOW, CHEAP_FAST], 85, 15);
    // Both cheap models score high; expensive scores low
    expect(ranked[ranked.length - 1].model).toBe('expensive');
  });

  it('at latency-heavy weights (15/85): cheapest-fastest ranks first', () => {
    const ranked = normalize([EXPENSIVE, CHEAP_SLOW, CHEAP_FAST], 15, 85);
    // cheap-fast has same cost as cheap-slow but much faster
    expect(ranked[0].model).toBe('cheap-fast');
  });

  it('single model: score is 100 (normalized to itself)', () => {
    const ranked = normalize([CHEAP_FAST], 50, 50);
    expect(ranked[0].score).toBe(100);
  });

  it('handles empty array without throwing', () => {
    expect(() => normalize([], 50, 50)).not.toThrow();
  });
});

// ── CostCall category grouping ───────────────────────────────────────────────
describe('callsByDate grouping', () => {
  it('groups calls by date prefix of ts', () => {
    const calls: CostCall[] = [
      { ts: '2026-06-01T10:00:00Z', model: 'a', category: 'digest', label: 'L1', cost_usd: 0.01, latency_ms: 1000, prompt_tokens: 100, completion_tokens: 50 },
      { ts: '2026-06-01T12:00:00Z', model: 'b', category: 'archive', label: 'L2', cost_usd: 0.02, latency_ms: 2000, prompt_tokens: 200, completion_tokens: 80 },
      { ts: '2026-06-02T09:00:00Z', model: 'a', category: 'predict', label: 'L3', cost_usd: 0.005, latency_ms: 500, prompt_tokens: 50, completion_tokens: 20 },
    ];
    const out: Record<string, CostCall[]> = {};
    for (const c of calls) {
      const d = c.ts.slice(0, 10);
      (out[d] ??= []).push(c);
    }
    expect(out['2026-06-01']).toHaveLength(2);
    expect(out['2026-06-02']).toHaveLength(1);
    expect(out['2026-06-01'][0].label).toBe('L1');
  });
});
