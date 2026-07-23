import { it, expect } from 'vitest';
import { computeUsage, canAllocate, validateBallot } from './budget.js';
import type { BallotEntry, VoteBudget } from './types.js';

const BUDGET: VoteBudget = { upTotal: 7, downTotal: 2, perSongCap: null };

function entry(p: Partial<BallotEntry> & { spotifyUri: string }): BallotEntry {
  return {
    upPoints: 0, downPoints: 0, rating: null, notes: '',
    draftComment: '', isMine: false, ...p,
  };
}

it('computes usage and remaining for both pools', () => {
  const entries = [entry({ spotifyUri: 'a', upPoints: 3 }), entry({ spotifyUri: 'b', upPoints: 2, downPoints: 1 })];
  expect(computeUsage(entries, BUDGET)).toEqual({
    upUsed: 5, downUsed: 1, upRemaining: 2, downRemaining: 1,
  });
});

it('allows an allocation that fits the pool', () => {
  const entries = [entry({ spotifyUri: 'a', upPoints: 6 })];
  expect(canAllocate(entries, BUDGET, 'a', 'up', 1)).toBe(true);
});

it('blocks an allocation that would exceed the up pool', () => {
  const entries = [entry({ spotifyUri: 'a', upPoints: 7 })];
  expect(canAllocate(entries, BUDGET, 'a', 'up', 1)).toBe(false);
});

it('keeps up and down pools separate', () => {
  const entries = [entry({ spotifyUri: 'a', upPoints: 7 })];
  // up pool exhausted, but down pool is untouched
  expect(canAllocate(entries, BUDGET, 'a', 'down', 1)).toBe(true);
});

it('never allows allocating to your own song', () => {
  const entries = [entry({ spotifyUri: 'mine', isMine: true })];
  expect(canAllocate(entries, BUDGET, 'mine', 'up', 1)).toBe(false);
  expect(canAllocate(entries, BUDGET, 'mine', 'down', 1)).toBe(false);
});

it('blocks going below zero on a song', () => {
  const entries = [entry({ spotifyUri: 'a', upPoints: 0 })];
  expect(canAllocate(entries, BUDGET, 'a', 'up', -1)).toBe(false);
});

it('enforces per-song cap when set', () => {
  const capped: VoteBudget = { upTotal: 7, downTotal: 2, perSongCap: 3 };
  const entries = [entry({ spotifyUri: 'a', upPoints: 3 })];
  expect(canAllocate(entries, capped, 'a', 'up', 1)).toBe(false);
  expect(canAllocate(entries, capped, 'a', 'up', -1)).toBe(true);
});

it('allows decrements even when a pool is already over budget', () => {
  // upTotal is 7, but 9 are allocated — the user must still be able to claw points back.
  const entries = [entry({ spotifyUri: 'a', upPoints: 9 })];
  expect(canAllocate(entries, BUDGET, 'a', 'up', -1)).toBe(true);
});

it('still blocks increments when a pool is already over budget', () => {
  const entries = [entry({ spotifyUri: 'a', upPoints: 9 })];
  expect(canAllocate(entries, BUDGET, 'a', 'up', 1)).toBe(false);
});

it('returns no violations for a valid ballot', () => {
  const entries = [entry({ spotifyUri: 'a', upPoints: 7 }), entry({ spotifyUri: 'b', downPoints: 2 })];
  expect(validateBallot(entries, BUDGET)).toEqual([]);
});

it('reports over-spend violations', () => {
  const entries = [entry({ spotifyUri: 'a', upPoints: 9 })];
  const problems = validateBallot(entries, BUDGET);
  expect(problems.length).toBeGreaterThan(0);
  expect(problems[0]).toMatch(/up points/i);
});

it('reports allocation on your own song as a violation', () => {
  const entries = [entry({ spotifyUri: 'mine', isMine: true, upPoints: 1 })];
  expect(validateBallot(entries, BUDGET).some((p) => p.includes('own'))).toBe(true);
});
