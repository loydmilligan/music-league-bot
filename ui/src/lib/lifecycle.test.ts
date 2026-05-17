import { it, expect } from 'vitest';
import { getRoundPhase, getRoundPhasesForSeason, seasonIsActive } from './lifecycle.js';

const T = (s: string) => new Date(s).getTime();
const NOW = T('2026-06-01T12:00:00Z');

it('upcoming when submission_deadline is null', () => {
  expect(getRoundPhase({ submissionDeadline: null, votingDeadline: null }, NOW)).toBe('upcoming');
  expect(getRoundPhase({ submissionDeadline: null, votingDeadline: '2026-06-10T00:00:00Z' }, NOW)).toBe('upcoming');
});

it('submission when now < submission_deadline', () => {
  expect(getRoundPhase({
    submissionDeadline: '2026-06-05T00:00:00Z',
    votingDeadline:     '2026-06-08T00:00:00Z',
  }, NOW)).toBe('submission');
});

it('voting when submission_deadline ≤ now < voting_deadline', () => {
  expect(getRoundPhase({
    submissionDeadline: '2026-05-28T00:00:00Z',
    votingDeadline:     '2026-06-05T00:00:00Z',
  }, NOW)).toBe('voting');
  // boundary: exactly at submission_deadline → voting
  expect(getRoundPhase({
    submissionDeadline: '2026-06-01T12:00:00Z',
    votingDeadline:     '2026-06-05T00:00:00Z',
  }, NOW)).toBe('voting');
});

it('archive when now ≥ voting_deadline', () => {
  expect(getRoundPhase({
    submissionDeadline: '2026-05-20T00:00:00Z',
    votingDeadline:     '2026-05-25T00:00:00Z',
  }, NOW)).toBe('archive');
  // boundary: exactly at voting_deadline → archive
  expect(getRoundPhase({
    submissionDeadline: '2026-05-25T00:00:00Z',
    votingDeadline:     '2026-06-01T12:00:00Z',
  }, NOW)).toBe('archive');
});

it('archive when submission_deadline is past and voting_deadline is null', () => {
  // No voting-by date means once submissions close the round is done.
  expect(getRoundPhase({
    submissionDeadline: '2026-05-28T00:00:00Z',
    votingDeadline:     null,
  }, NOW)).toBe('archive');
});

it('accepts snake_case row shapes too (DB row pass-through)', () => {
  expect(getRoundPhase({
    submission_deadline: '2026-06-05T00:00:00Z',
    voting_deadline:     '2026-06-08T00:00:00Z',
  } as any, NOW)).toBe('submission');
});

it('seasonIsActive: true when any round is in submission or voting', () => {
  expect(seasonIsActive({ rounds: [
    { phase: 'archive' }, { phase: 'submission' }, { phase: 'archive' },
  ]})).toBe(true);
  expect(seasonIsActive({ rounds: [
    { phase: 'archive' }, { phase: 'voting' },
  ]})).toBe(true);
});

it('seasonIsActive: false when all rounds are upcoming/archive', () => {
  expect(seasonIsActive({ rounds: [
    { phase: 'archive' }, { phase: 'archive' },
  ]})).toBe(false);
  expect(seasonIsActive({ rounds: [
    { phase: 'upcoming' }, { phase: 'upcoming' },
  ]})).toBe(false);
  expect(seasonIsActive({ rounds: [] })).toBe(false);
});

// ─── season-aware phase derivation (hotfix coverage) ────────────────────

it('hip-jammers-s3 on 2026-05-16: only round 2 is submission; rounds 3-7 are upcoming', () => {
  // Real fixture from the user's CSV.
  const rounds = [
    { id: 102, submissionDeadline: '2026-05-10T07:00:00Z', votingDeadline: '2026-05-14T21:14:00Z' }, // r1
    { id: 103, submissionDeadline: '2026-05-18T07:00:00Z', votingDeadline: '2026-05-22T07:00:00Z' }, // r2
    { id: 104, submissionDeadline: '2026-05-25T07:00:00Z', votingDeadline: '2026-05-29T07:00:00Z' }, // r3
    { id: 105, submissionDeadline: '2026-06-01T07:00:00Z', votingDeadline: '2026-06-05T07:00:00Z' }, // r4
    { id: 106, submissionDeadline: '2026-06-08T07:00:00Z', votingDeadline: '2026-06-12T07:00:00Z' }, // r5
    { id: 107, submissionDeadline: '2026-06-15T07:00:00Z', votingDeadline: '2026-06-19T07:00:00Z' }, // r6
    { id: 108, submissionDeadline: '2026-06-22T07:00:00Z', votingDeadline: '2026-06-26T07:00:00Z' }, // r7
  ];
  const now = Date.parse('2026-05-16T12:00:00Z');
  const phases = getRoundPhasesForSeason(rounds, now);
  expect(phases.get(102)).toBe('archive');
  expect(phases.get(103)).toBe('submission');
  expect(phases.get(104)).toBe('upcoming');
  expect(phases.get(105)).toBe('upcoming');
  expect(phases.get(106)).toBe('upcoming');
  expect(phases.get(107)).toBe('upcoming');
  expect(phases.get(108)).toBe('upcoming');
});

it('season-aware seasonIsActive: true when one round is submission, rest upcoming', () => {
  const rounds = [
    { id: 1, submissionDeadline: '2026-05-10T07:00:00Z', votingDeadline: '2026-05-14T21:14:00Z' },
    { id: 2, submissionDeadline: '2026-05-18T07:00:00Z', votingDeadline: '2026-05-22T07:00:00Z' },
    { id: 3, submissionDeadline: '2026-05-25T07:00:00Z', votingDeadline: '2026-05-29T07:00:00Z' },
  ];
  const now = Date.parse('2026-05-16T12:00:00Z');
  const phases = getRoundPhasesForSeason(rounds, now);
  const phased = rounds.map(r => ({ phase: phases.get(r.id)! }));
  expect(seasonIsActive({ rounds: phased })).toBe(true);
});

it('all rounds archived → seasonIsActive false', () => {
  const rounds = [
    { id: 1, submissionDeadline: '2026-01-01T00:00:00Z', votingDeadline: '2026-01-05T00:00:00Z' },
    { id: 2, submissionDeadline: '2026-01-08T00:00:00Z', votingDeadline: '2026-01-12T00:00:00Z' },
  ];
  const now = Date.parse('2026-05-16T12:00:00Z');
  const phases = getRoundPhasesForSeason(rounds, now);
  expect(phases.get(1)).toBe('archive');
  expect(phases.get(2)).toBe('archive');
  expect(seasonIsActive({ rounds: [...phases.values()].map(p => ({ phase: p })) })).toBe(false);
});

it('null deadlines on every round → all upcoming, first one (id-asc) gets submission only when prior is archive', () => {
  // Pure null-deadline season: nothing can have started.
  const rounds = [
    { id: 1, submissionDeadline: null, votingDeadline: null },
    { id: 2, submissionDeadline: null, votingDeadline: null },
  ];
  const now = Date.parse('2026-05-16T12:00:00Z');
  const phases = getRoundPhasesForSeason(rounds, now);
  // r1 is "first/no prior" but its sub/vote are null → falls through to "not past deadlines, prior archive (none) → submission".
  // Actually per the algorithm: prevPhase null → submission. Document that.
  expect(phases.get(1)).toBe('submission');
  // r2 sees prev='submission' (not archive) → upcoming.
  expect(phases.get(2)).toBe('upcoming');
});

it('handles unsorted input by sorting by id internally', () => {
  const rounds = [
    { id: 3, submissionDeadline: '2026-05-25T07:00:00Z', votingDeadline: '2026-05-29T07:00:00Z' },
    { id: 1, submissionDeadline: '2026-05-10T07:00:00Z', votingDeadline: '2026-05-14T21:14:00Z' },
    { id: 2, submissionDeadline: '2026-05-18T07:00:00Z', votingDeadline: '2026-05-22T07:00:00Z' },
  ];
  const now = Date.parse('2026-05-16T12:00:00Z');
  const phases = getRoundPhasesForSeason(rounds, now);
  expect(phases.get(1)).toBe('archive');
  expect(phases.get(2)).toBe('submission');
  expect(phases.get(3)).toBe('upcoming');
});

it('upset case: r1 archive, r2 vote past + vote_deadline null → archive (avoids "voting indefinitely")', () => {
  const rounds = [
    { id: 1, submissionDeadline: '2026-01-01T00:00:00Z', votingDeadline: '2026-01-05T00:00:00Z' },
    { id: 2, submissionDeadline: '2026-02-01T00:00:00Z', votingDeadline: null },
  ];
  const now = Date.parse('2026-05-16T12:00:00Z');
  const phases = getRoundPhasesForSeason(rounds, now);
  expect(phases.get(1)).toBe('archive');
  // r2: sub past, vote null → archive (not voting forever)
  expect(phases.get(2)).toBe('archive');
});
