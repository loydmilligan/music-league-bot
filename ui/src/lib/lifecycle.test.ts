import { it, expect } from 'vitest';
import { getRoundPhase, seasonIsActive } from './lifecycle.js';

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
