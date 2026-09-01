import { describe, it, expect } from 'vitest';
import { sortCandidates, findConflicts, rollup, commitmentElsewhere, ledgerEntry } from './board.js';
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

/** mk plus the server-derived availability map commitmentElsewhere gates on. */
const mkA = (
  songs: { uri: string; cands: Candidate[] }[],
  availability: Record<number, 'free' | 'dimmed' | 'taken'>,
) => ({
  songs: songs.map((s) => ({ spotifyUri: s.uri, candidates: s.cands })),
  availability,
} as never);

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

describe('commitmentElsewhere', () => {
  // DISCRIMINATING: player 1 is locked ONLY on the song being rendered, and the
  // server correctly calls them 'taken' grid-wide. The answer must still be
  // null — dropping the `spotifyUri` skip returns {taken, at: 1} and every row
  // on the board would strike itself out for its own commitment.
  it('never reports a commitment on the song being rendered', () => {
    const data = mkA([{ uri: 'a', cands: [c(1, 'locked', null)] }], { 1: 'taken' });
    expect(commitmentElsewhere(data, 1, 'a')).toBeNull();
  });

  // DISCRIMINATING: the PRIME song is scanned first ('a' precedes 'b') and the
  // LOCKED song second, so a first-match-wins scan returns {dimmed, at: 1}.
  // Locked outranks prime regardless of order, so the only right answer is the
  // later song: {taken, at: 2}.
  it('lets locked outrank prime even when prime is scanned first', () => {
    const data = mkA([
      { uri: 'a', cands: [c(1, 'prime', null)] },
      { uri: 'b', cands: [c(1, 'locked', null)] },
      { uri: 'c', cands: [c(1, 'possible', null)] },
    ], { 1: 'taken' });
    expect(commitmentElsewhere(data, 1, 'c')).toEqual({ kind: 'taken', at: 2 });
  });

  // DISCRIMINATING: the payload deliberately CONTRADICTS itself — the songs
  // hold a lock for player 1, but the server's availability says 'free'. The
  // server is the authority, so the answer is null. An implementation that
  // recomputes availability client-side from the songs returns {taken, at: 1}.
  it('trusts the server when availability says free, and does not scan', () => {
    const data = mkA([
      { uri: 'a', cands: [c(1, 'locked', null)] },
      { uri: 'b', cands: [] },
    ], { 1: 'free' });
    expect(commitmentElsewhere(data, 1, 'b')).toBeNull();
  });
});

describe('ledgerEntry', () => {
  it('reports free without scanning when the server says free', () => {
    // DISCRIMINATING: the songs hold a lock for player 1 but availability says
    // free. The server is the authority — an implementation that recomputes
    // from the songs returns {taken, at: 1} instead.
    const data = mkA([{ uri: 'a', cands: [c(1, 'locked', null)] }], { 1: 'free' });
    expect(ledgerEntry(data, 1)).toEqual({ kind: 'free', at: null });
  });

  it('has no "current song" to skip, unlike commitmentElsewhere', () => {
    const data = mkA([{ uri: 'a', cands: [c(1, 'locked', null)] }], { 1: 'taken' });
    expect(ledgerEntry(data, 1)).toEqual({ kind: 'taken', at: 1 });
  });

  // DISCRIMINATING: the PRIME song is scanned first ('a' precedes 'b'). A
  // first-match-wins scan returns {dimmed, at: 1}; locked must outrank prime
  // regardless of order.
  it('lets locked outrank prime even when prime is scanned first', () => {
    const data = mkA([
      { uri: 'a', cands: [c(1, 'prime', null)] },
      { uri: 'b', cands: [c(1, 'locked', null)] },
    ], { 1: 'taken' });
    expect(ledgerEntry(data, 1)).toEqual({ kind: 'taken', at: 2 });
  });

  it('reports dimmed at the prime song when there is no lock', () => {
    const data = mkA([
      { uri: 'a', cands: [c(1, 'possible', null)] },
      { uri: 'b', cands: [c(1, 'prime', null)] },
    ], { 1: 'dimmed' });
    expect(ledgerEntry(data, 1)).toEqual({ kind: 'dimmed', at: 2 });
  });

  it('is free for a player with no candidate rows at all', () => {
    const data = mkA([{ uri: 'a', cands: [] }], {});
    expect(ledgerEntry(data, 7)).toEqual({ kind: 'free', at: null });
  });
});
