import { describe, it, expect } from 'vitest';
import { resolveStart, buildRoundWindows, type RoundWindowInput } from './roundWindow.js';

function r(over: Partial<RoundWindowInput>): RoundWindowInput {
  return {
    id: 1, name: 'R', seasonNumber: 1,
    votingStartedAt: null, votingEndedAt: null,
    submissionDeadline: null, votingDeadline: null,
    createdAt: '2026-06-12T00:00:00Z',
    ...over,
  };
}

describe('resolveStart — priority order', () => {
  it('prefers voting_started_at, then submission_deadline, then created_at', () => {
    expect(resolveStart(r({ votingStartedAt: '2026-05-01T00:00:00Z', submissionDeadline: '2026-05-02T00:00:00Z' })))
      .toBe('2026-05-01T00:00:00Z');
    expect(resolveStart(r({ submissionDeadline: '2026-05-02T00:00:00Z' }))).toBe('2026-05-02T00:00:00Z');
    expect(resolveStart(r({}))).toBe('2026-06-12T00:00:00Z');
  });
});

describe('buildRoundWindows', () => {
  it('orders by resolved start, not by import created_at', () => {
    // Two rounds imported same day (created_at) but with real voting times weeks apart.
    const rounds = [
      r({ id: 1, votingStartedAt: '2026-05-31T00:00:00Z', votingEndedAt: '2026-06-04T00:00:00Z', createdAt: '2026-06-23T00:00:00Z' }),
      r({ id: 2, votingStartedAt: '2026-05-03T00:00:00Z', votingEndedAt: '2026-05-07T00:00:00Z', createdAt: '2026-06-23T00:00:00Z' }),
    ];
    const w = buildRoundWindows(rounds, '2026-07-01T00:00:00Z');
    expect(w.map(x => x.id)).toEqual([2, 1]); // chronological by real voting start
    expect(w[0].fromIso).toBe('2026-05-03T00:00:00Z');
    expect(w[0].toIso).toBe('2026-05-07T00:00:00Z');
  });

  it('windows each round on its own voting span when timestamps exist', () => {
    const w = buildRoundWindows(
      [r({ id: 5, votingStartedAt: '2026-05-31T00:00:00Z', votingEndedAt: '2026-06-04T00:00:00Z' })],
      '2026-07-01T00:00:00Z',
    );
    expect(w[0]).toMatchObject({ fromIso: '2026-05-31T00:00:00Z', toIso: '2026-06-04T00:00:00Z', isLive: false });
  });

  it('falls back to deadlines, then created_at + next-round start', () => {
    const rounds = [
      r({ id: 1, submissionDeadline: '2026-05-01T00:00:00Z', votingDeadline: '2026-05-05T00:00:00Z' }),
      r({ id: 2, createdAt: '2026-05-10T00:00:00Z' }), // no signals → created_at start, open end (live)
    ];
    const w = buildRoundWindows(rounds, '2026-07-01T00:00:00Z');
    expect(w[0]).toMatchObject({ fromIso: '2026-05-01T00:00:00Z', toIso: '2026-05-05T00:00:00Z' });
    // last round with no end signal runs to "now" and is live
    expect(w[1].toIso).toBe('2026-07-01T00:00:00Z');
    expect(w[1].isLive).toBe(true);
  });
});
