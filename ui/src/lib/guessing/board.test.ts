import { describe, it, expect } from 'vitest';
import { sortCandidates, findConflicts, rollup } from './board.js';
import type { Candidate } from './candidates.js';

const c = (playerId: number, status: Candidate['status'], certainty: number | null): Candidate =>
  ({ playerId, status, certainty, factors: '', notes: '' });

describe('sortCandidates', () => {
  // DISCRIMINATING: input order is deliberately the reverse of expected, and
  // certainty deliberately disagrees with status order — a sort on certainty
  // alone, or a stable no-op, both fail.
  it('orders locked, then prime, then possible', () => {
    const out = sortCandidates([c(1, 'possible', 99), c(2, 'prime', 50), c(3, 'locked', 1)]);
    expect(out.map((x) => x.playerId)).toEqual([3, 2, 1]);
  });

  it('breaks ties by certainty descending, nulls last', () => {
    const out = sortCandidates([c(1, 'possible', null), c(2, 'possible', 20), c(3, 'possible', 80)]);
    expect(out.map((x) => x.playerId)).toEqual([3, 2, 1]);
  });

  it('does not mutate its input', () => {
    const input = [c(1, 'possible', 1), c(2, 'locked', 1)];
    const copy = [...input];
    sortCandidates(input);
    expect(input).toEqual(copy);
  });
});

const mk = (songs: { uri: string; cands: Candidate[] }[]) =>
  ({ songs: songs.map((s) => ({ spotifyUri: s.uri, candidates: s.cands })) } as never);

describe('findConflicts', () => {
  // DISCRIMINATING: player 1 is locked twice AND prime elsewhere; player 2 is
  // locked once. An implementation counting any status, or not requiring 2+,
  // reports player 2 as well and fails.
  it('reports only players locked on more than one song', () => {
    const conflicts = findConflicts(mk([
      { uri: 'a', cands: [c(1, 'locked', null), c(2, 'locked', null)] },
      { uri: 'b', cands: [c(1, 'locked', null)] },
      { uri: 'c', cands: [c(1, 'prime', null)] },
    ]));
    expect([...conflicts.keys()]).toEqual([1]);
    expect(conflicts.get(1)).toEqual(['a', 'b']);
  });

  it('is empty when every lock is unique', () => {
    expect(findConflicts(mk([
      { uri: 'a', cands: [c(1, 'locked', null)] },
      { uri: 'b', cands: [c(2, 'locked', null)] },
    ])).size).toBe(0);
  });
});

describe('rollup', () => {
  it('reports progress while unfinished', () => {
    const r = rollup(mk([
      { uri: 'a', cands: [c(1, 'locked', null)] },
      { uri: 'b', cands: [] },
    ]));
    expect(r.tone).toBe('progress');
    expect(r.text).toContain('1 of 2 locked');
  });

  // DISCRIMINATING: this board is fully locked AND conflicted. Conflict must
  // outrank settled — an implementation checking "all locked" first calls it
  // settled and fails.
  it('reports conflict even when every song is locked', () => {
    const r = rollup(mk([
      { uri: 'a', cands: [c(1, 'locked', null)] },
      { uri: 'b', cands: [c(1, 'locked', null)] },
    ]));
    expect(r.tone).toBe('conflict');
  });

  it('reports settled only when fully locked and conflict-free', () => {
    const r = rollup(mk([
      { uri: 'a', cands: [c(1, 'locked', null)] },
      { uri: 'b', cands: [c(2, 'locked', null)] },
    ]));
    expect(r.tone).toBe('settled');
    expect(r.text).toContain('ready to submit');
  });
});
