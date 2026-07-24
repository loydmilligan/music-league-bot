import { it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { openLeagueDb } from '$lib/db/client.js';

vi.mock('$lib/digest/llm.js', () => ({
  callOpenRouter: vi.fn(),
}));

import { callOpenRouter } from '$lib/digest/llm.js';
const mockCallOpenRouter = vi.mocked(callOpenRouter);

import { VotingTakeOutputSchema, votingTakeTask, buildVotingTakeMessages, runVotingTake } from './votingTake.js';
import type { VotingTakeInput } from './votingTake.js';

const INPUT: VotingTakeInput = {
  song: { title: 'Song A', artist: 'Artist A', spotifyUri: 'spotify:track:123abc', spotifyPopularity: 12, listeners: 900, bpm: 128, energy: 0.7, hasLyrics: true, tags: ['shoegaze'] },
  theme: { name: 'Non-English', description: 'Songs not in English' },
  tasteFingerprint: 'Rewards obscure, texture-forward records; punishes novelty songs.',
};

it('accepts a well-formed output', () => {
  const parsed = VotingTakeOutputSchema.parse({
    theme_read: 'Squarely on-theme: Portuguese vocal throughout.',
    taste_note: 'Texture-forward and obscure — squarely your lane.',
    angles: ['The drum machine is doing the emotional work', 'Compare to the Cocteau Twins record you rewarded'],
    signals: ['shoegaze', 'obscure'],
  });
  expect(parsed.angles).toHaveLength(2);
});

it('rejects output that smuggles in a vote recommendation field', () => {
  expect(() =>
    VotingTakeOutputSchema.parse({
      theme_read: 'x', taste_note: 'y', angles: ['a'], signals: [], lean: 'up',
    }),
  ).toThrow();
});

it('requires at least one angle', () => {
  expect(() =>
    VotingTakeOutputSchema.parse({ theme_read: 'x', taste_note: 'y', angles: [], signals: [] }),
  ).toThrow();
});

it('is registered with a stable task id', () => {
  expect(votingTakeTask.id).toBe('voting-take');
});

it('never puts submitter identity in the prompt and forbids recommendations', () => {
  const messages = buildVotingTakeMessages(INPUT);
  const all = messages.map((m) => m.content).join('\n');
  expect(all).not.toMatch(/submitter|submitted by/i);
  expect(all).toContain('Song A');
  expect(all).toContain('Non-English');
  // The system prompt must forbid telling the user how to vote.
  expect(all.toLowerCase()).toContain('do not recommend');
});

it('includes the track identifier in the task input type', () => {
  // spotifyUri is what makes the cache key unique per track; title+artist can repeat
  // (original vs remaster), so it must be part of the cached input.
  expect(INPUT.song.spotifyUri).toBeTruthy();
});

it('does not return a poisoned (unusable, output_json NULL) row from cache lookup', async () => {
  const db = openLeagueDb(':memory:');
  vi.clearAllMocks();

  // Simulate a previous run that failed schema validation twice: predict.ts writes
  // output_json = NULL, outcome = 'unusable' before throwing. It is the newest row
  // for this (round, song) — the poisoned row must be excluded, not just deprioritized.
  db.prepare(
    `INSERT INTO prediction_runs (id, task_id, round_id, input_json, output_json, model, cost_usd, latency_ms, created_at, outcome)
     VALUES (?, 'voting-take', ?, ?, NULL, 'm', 0, 0, ?, 'unusable')`,
  ).run(randomUUID(), 1, JSON.stringify({ song: { spotifyUri: INPUT.song.spotifyUri } }), new Date().toISOString());

  mockCallOpenRouter.mockResolvedValueOnce({
    content: JSON.stringify({ theme_read: 'a', taste_note: 'b', angles: ['c'], signals: [] }),
    costUsd: 0.001, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0,
  });

  const result = await runVotingTake(db, {
    roundId: 1, song: INPUT.song, theme: INPUT.theme, tasteFingerprint: INPUT.tasteFingerprint,
  });

  expect(result.cacheHit).toBe(false);
  expect(mockCallOpenRouter).toHaveBeenCalledTimes(1);
  db.close();
});
