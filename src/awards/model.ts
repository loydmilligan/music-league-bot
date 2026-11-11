import type { AwardDef, AwardRound, Candidate } from './types.js';

type Place = 1 | 2 | 3;

export function addCandidate(r: AwardRound, c: Omit<Candidate, 'n'>): { round: AwardRound; n: number; duplicate: boolean } {
  const dup = r.candidates.find((x) => (c.msgId !== null && x.msgId === c.msgId) || (x.text === c.text && x.ts === c.ts));
  if (dup) return { round: r, n: dup.n, duplicate: true };
  const n = r.candidates.reduce((m, x) => Math.max(m, x.n), 0) + 1;
  return { round: { ...r, candidates: [...r.candidates, { ...c, n }] }, n, duplicate: false };
}

export function pick(r: AwardRound, place: Place, n: number): { round: AwardRound; cleared?: Place; complete: boolean; error?: 'no-such-candidate' } {
  const isComplete = (p: AwardRound['picks']) => p[1] !== undefined && p[2] !== undefined && p[3] !== undefined;
  if (!r.candidates.some((c) => c.n === n)) return { round: r, complete: isComplete(r.picks), error: 'no-such-candidate' };
  const picks: AwardRound['picks'] = { ...r.picks };
  let cleared: Place | undefined;
  for (const p of [1, 2, 3] as const) {
    if (p !== place && picks[p] === n) {
      delete picks[p];
      cleared = p;
    }
  }
  picks[place] = n;
  return { round: { ...r, picks }, ...(cleared ? { cleared } : {}), complete: isComplete(picks) };
}

export function nextApprover(def: AwardDef, r: AwardRound): string | null {
  return def.approvers.find((a) => !r.approvals.includes(a)) ?? null;
}

export function approve(def: AwardDef, r: AwardRound, approverId: string): { round: AwardRound; done: boolean; error?: 'not-your-turn' | 'no-poster' | 'not-decided' } {
  if (r.picks[1] === undefined || r.picks[2] === undefined || r.picks[3] === undefined) return { round: r, done: false, error: 'not-decided' };
  if (!r.poster) return { round: r, done: false, error: 'no-poster' };
  const next = nextApprover(def, r);
  if (next === null) return { round: r, done: true };
  if (next !== approverId) return { round: r, done: false, error: 'not-your-turn' };
  const approvals = [...r.approvals, approverId];
  const done = def.approvers.every((a) => approvals.includes(a));
  return { round: { ...r, approvals, ...(done ? { approvedAt: new Date().toISOString() } : {}) }, done };
}
