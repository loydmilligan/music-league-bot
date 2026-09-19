import { it, expect, vi, describe, beforeEach } from 'vitest';
import { openLeagueDb } from '$lib/db/client.js';

vi.mock('$lib/digest/llm.js', () => ({
  callOpenRouter: vi.fn(),
}));

vi.mock('$lib/server/boarzAnalysis.js', () => ({
  normName: (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, ''),
}));

import { callOpenRouter } from '$lib/digest/llm.js';
import {
  normalizeToTen,
  SubmitterOddsOutputSchema,
  submitterOddsTask,
  runSubmitterOdds,
} from './submitterOdds.js';
import type { SubmitterOddsInput } from './submitterOdds.js';

const mockCallOpenRouter = vi.mocked(callOpenRouter);

beforeEach(() => {
  mockCallOpenRouter.mockReset();
});

const INPUT: SubmitterOddsInput = {
  song: { title: 'Black Betty', artist: 'Ram Jam', spotifyUri: 'spotify:track:6kooDsorCpWVMGc994XjWN', metaBlock: 'Spotify popularity: 79/100' },
  theme: { name: 'These Go to 11', description: 'Loud songs' },
  players: [
    { id: 'p20', name: 'Dave Steingart', competitorName: 'Steiny', profileMd: '# Dave' },
    { id: 'p32', name: 'Conor Johnston', competitorName: 'CJ Wookie', profileMd: '# Conor' },
    { id: 'p39', name: 'Jimmy', competitorName: 'Jimmy Troy', profileMd: null },
  ],
};

describe('normalizeToTen', () => {
  it('scales likelihoods so one-decimal values sum to exactly 10.0', () => {
    for (const raw of [[10, 0, 0], [9, 1], [1, 1, 1], [3, 7, 0.5, 0.5], [10, 10], [0.001, 0]]) {
      const out = normalizeToTen(raw);
      expect(Math.round(out.reduce((a, b) => a + b, 0) * 10)).toBe(100);
      for (const v of out) expect(Number.isInteger(v * 10)).toBe(true);
    }
  });

  it('keeps proportions (a unanimous favorite takes everything)', () => {
    const out = normalizeToTen([10, 0, 0]);
    expect(out[0]).toBe(10);
    expect(out[1]).toBe(0);
    expect(out[2]).toBe(0);
  });

  it('spreads evenly when nobody scores (all-zero fallback)', () => {
    const out = normalizeToTen([0, 0, 0, 0]);
    for (const v of out) expect(v).toBe(2.5);
  });

  it('handles exact-division and remainder cases', () => {
    expect(normalizeToTen([9, 1])).toEqual([9, 1]);
    expect(normalizeToTen([1, 1, 1])).toEqual([3.4, 3.3, 3.3]);
  });

  it('treats non-finite entries as zero', () => {
    const out = normalizeToTen([Number.NaN, 10]);
    expect(out.reduce((a, b) => a + b, 0)).toBeCloseTo(10, 5);
    expect(out[0]).toBe(0);
  });
});

describe('submitterOddsTask', () => {
  it('is registered with a stable task id', () => {
    expect(submitterOddsTask.id).toBe('submitter-odds');
  });

  it('rejects extra fields (strict output schema)', () => {
    const parsed = SubmitterOddsOutputSchema.safeParse({
      players: [{ name: 'x', likelihood: 1, note: 'n' }],
      lean: 'upvote',
    });
    expect(parsed.success).toBe(false);
  });

  it('prompt includes every player profile and the song', () => {
    const messages = submitterOddsTask.buildMessages(INPUT);
    const all = messages.map((m) => m.content).join('\n');
    expect(all).toContain('Black Betty');
    expect(all).toContain('### id:p20 · Dave Steingart (league display name: Steiny)');
    expect(all).toContain('### id:p39 · Jimmy');
    expect(all).toContain('No profile data available');
  });
});

describe('runSubmitterOdds', () => {
  it('maps LLM output back to roster order and normalizes to 10', async () => {
    const db = openLeagueDb(':memory:');
    // The model echoes ids but uses its own display names, out of order —
    // the exact failure mode seen live before the id mapping existed.
    mockCallOpenRouter.mockResolvedValueOnce({
      content: JSON.stringify({
        players: [
          { id: 'p39', name: 'Jimmy Troy', likelihood: 2, note: 'nope' },
          { id: 'p20', name: 'Steiny', likelihood: 8, note: 'dance rock fits' },
          { id: 'p32', name: 'CJ Wookie', likelihood: 2, note: 'possible' },
        ],
      }),
      costUsd: 0.01, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0,
    });

    const result = await runSubmitterOdds(db, { roundId: 1, input: INPUT });
    expect(result.cacheHit).toBe(false);
    expect(result.players.map((p) => p.name)).toEqual(['Dave Steingart', 'Conor Johnston', 'Jimmy']);
    expect(result.players[0].score).toBeCloseTo(6.7, 1); // 8/12 of 10
    expect(result.players[0].note).toBe('dance rock fits');
    expect(result.top3[0].name).toBe('Dave Steingart');
    expect(Math.round(result.players.reduce((a, p) => a + p.score, 0) * 10)).toBe(100);
  });

  it('falls back to display-name matching when the model drops ids', async () => {
    const db = openLeagueDb(':memory:');
    mockCallOpenRouter.mockResolvedValueOnce({
      content: JSON.stringify({
        players: [
          { name: 'Steiny', likelihood: 6, note: 'a' },
          { name: 'Conor Johnston', likelihood: 3, note: 'b' },
          { name: 'Jimmy Troy', likelihood: 1, note: 'c' },
        ],
      }),
      costUsd: 0.01, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0,
    });

    const result = await runSubmitterOdds(db, { roundId: 1, input: INPUT });
    expect(result.players[0].note).toBe('a'); // matched via competitorName
    expect(result.players[0].score).toBeCloseTo(6, 1);
    expect(result.players.every((p) => p.score > 0)).toBe(true);
  });

  it('caches by (round, song) and skips the LLM on the second call', async () => {
    const db = openLeagueDb(':memory:');
    mockCallOpenRouter.mockResolvedValue({
      content: JSON.stringify({
        players: [{ id: 'p20', name: 'Dave Steingart', likelihood: 10, note: 'clear favorite' }],
      }),
      costUsd: 0.01, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0,
    });

    const first = await runSubmitterOdds(db, { roundId: 1, input: INPUT });
    expect(first.cacheHit).toBe(false);
    const second = await runSubmitterOdds(db, { roundId: 1, input: INPUT });
    expect(second.cacheHit).toBe(true);
    expect(mockCallOpenRouter).toHaveBeenCalledTimes(1);
    // Missing LLM players fall back to 0 and the total still holds.
    expect(second.players[0].score).toBe(10);
    expect(second.players[1].score).toBe(0);

    await runSubmitterOdds(db, { roundId: 1, input: INPUT, forceRegen: true });
    expect(mockCallOpenRouter).toHaveBeenCalledTimes(2);
  });
});
