import { describe, expect, it } from 'vitest';
import { addCandidate, approve, nextApprover, pick } from '../../src/awards/model.js';
import type { AwardDef, AwardRound } from '../../src/awards/types.js';

const def: AwardDef = { key: 'hba', prefix: 'hba', name: 'Half Baked', owners: ['conor'], approvers: ['conor', 'matt'], day: 6, window: 'round', promptTemplate: '' };
const empty = (): AwardRound => ({ award: 'hba', roundId: 1, candidates: [], picks: {}, approvals: [] });
const cand = (text: string, msgId: string | null = null, ts = '2026-01-01T00:00:00Z') => ({ who: 'Ann', authorId: null, text, ts, msgId, reactions: null });
const withN = (n: number): AwardRound => {
  let r = empty();
  for (let i = 1; i <= n; i++) r = addCandidate(r, cand(`t${i}`, `m${i}`)).round;
  return r;
};

describe('addCandidate', () => {
  it('numbers 1,2,3 and dedupes by msgId', () => {
    let r = empty();
    const a = addCandidate(r, cand('a', 'm1')); r = a.round;
    const b = addCandidate(r, cand('b', 'm2')); r = b.round;
    const c = addCandidate(r, cand('c', 'm3')); r = c.round;
    expect([a.n, b.n, c.n]).toEqual([1, 2, 3]);
    const d = addCandidate(r, cand('different text', 'm2'));
    expect(d).toMatchObject({ n: 2, duplicate: true });
    expect(d.round.candidates).toHaveLength(3);
  });
  it('dedupes by text+ts when no msgId and does not mutate input', () => {
    const r = addCandidate(empty(), cand('x')).round;
    expect(addCandidate(r, cand('x'))).toMatchObject({ n: 1, duplicate: true });
    expect(addCandidate(r, cand('x', null, '2026-01-02T00:00:00Z'))).toMatchObject({ n: 2, duplicate: false });
    expect(r.candidates).toHaveLength(1);
  });
});

describe('pick', () => {
  it('unknown candidate errors and leaves the round unchanged', () => {
    const r = withN(5);
    const out = pick(r, 1, 9);
    expect(out.error).toBe('no-such-candidate');
    expect(out.round).toEqual(r);
    expect(out.complete).toBe(false);
  });
  it('re-picking a place overwrites it', () => {
    const r = pick(pick(withN(5), 1, 2).round, 1, 4);
    expect(r.round.picks).toEqual({ 1: 4 });
    expect(r.cleared).toBeUndefined();
  });
  it('moving a candidate to another place clears its old place', () => {
    const r = pick(pick(withN(5), 1, 5).round, 2, 5);
    expect(r.cleared).toBe(1);
    expect(r.round.picks).toEqual({ 2: 5 });
  });
  it('complete only when all three places set', () => {
    let o = pick(withN(5), 1, 1); expect(o.complete).toBe(false);
    o = pick(o.round, 2, 2); expect(o.complete).toBe(false);
    o = pick(o.round, 3, 3); expect(o.complete).toBe(true);
  });
});

describe('approvals', () => {
  const decided = (poster?: string): AwardRound => {
    let r = withN(3);
    r = pick(pick(pick(r, 1, 1).round, 2, 2).round, 3, 3).round;
    return poster ? { ...r, poster } : r;
  };
  it('requires approvers in order', () => {
    const r = decided('p.png');
    expect(nextApprover(def, r)).toBe('conor');
    expect(approve(def, r, 'matt').error).toBe('not-your-turn');
    const a = approve(def, r, 'conor');
    expect(a).toMatchObject({ done: false });
    expect(nextApprover(def, a.round)).toBe('matt');
    const b = approve(def, a.round, 'matt');
    expect(b.done).toBe(true);
    expect(b.round.approvedAt).toBeTruthy();
    expect(nextApprover(def, b.round)).toBeNull();
  });
  it('no poster -> no-poster; undecided -> not-decided', () => {
    expect(approve(def, decided(), 'conor').error).toBe('no-poster');
    expect(approve(def, { ...withN(3), poster: 'p.png' }, 'conor').error).toBe('not-decided');
  });
});
