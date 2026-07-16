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

  it('ignores a submission_deadline that has not passed yet', () => {
    // submission_deadline stands in for "when voting started" — that only holds
    // once it is in the past. A round still taking submissions has a deadline in
    // the future, which would put its window start ahead of "now".
    expect(
      resolveStart(
        r({ submissionDeadline: '2026-07-23T07:00:00Z', createdAt: '2026-07-16T16:59:15Z' }),
        '2026-07-16T20:00:00Z',
      ),
    ).toBe('2026-07-16T16:59:15Z');
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

  it('starts each round at the previous round end so submission-phase chat is captured', () => {
    // "Drugs" voting ends 06-23; "Let's Talk" has NO voting_started_at (poller
    // missed it), submission_deadline 06-26, voting_ended 06-30. The round was
    // actually active from 06-23 (when Drugs ended), so its window must start
    // there — not at the 06-26 submission deadline, which would drop the
    // submission-phase chat (the reported "only see 26th–28th" bug).
    const rounds = [
      r({ id: 8, name: 'Drugs', votingStartedAt: '2026-06-19T00:00:00Z', votingEndedAt: '2026-06-23T00:00:00Z' }),
      r({ id: 10, name: "Let's Talk", submissionDeadline: '2026-06-26T00:00:00Z', votingEndedAt: '2026-06-30T00:00:00Z' }),
    ];
    const w = buildRoundWindows(rounds, '2026-07-01T00:00:00Z');
    expect(w[0]).toMatchObject({ id: 8, fromIso: '2026-06-19T00:00:00Z', toIso: '2026-06-23T00:00:00Z' });
    expect(w[1]).toMatchObject({ id: 10, fromIso: '2026-06-23T00:00:00Z', toIso: '2026-06-30T00:00:00Z' });
  });

  it('windows a new season\'s first round from created_at when its deadline is still out', () => {
    // Real values from boarz-ii-men round 135. A brand-new league's opening round
    // has no voting_started_at and a deliberately far-out submission_deadline (set
    // so players have time to join). It is also the first round, so there is no
    // previous round end to chain from — the case that hid the league's chat.
    const w = buildRoundWindows(
      [r({
        id: 135, name: 'I Heard It Through the Napster',
        submissionDeadline: '2026-07-23T07:00:00.000Z',
        votingDeadline: '2026-07-27T07:00:00.000Z',
        createdAt: '2026-07-16T16:59:15.873Z',
      })],
      '2026-07-16T20:00:00.000Z',
    );
    // Must start at creation, not a week out, or same-day chat falls outside it.
    expect(w[0].fromIso).toBe('2026-07-16T16:59:15.873Z');
    expect(Date.parse(w[0].fromIso)).toBeLessThanOrEqual(Date.parse('2026-07-16T20:00:00.000Z'));
  });

  it('treats a last round whose voting deadline has not passed as live', () => {
    const w = buildRoundWindows(
      [r({
        id: 135,
        submissionDeadline: '2026-07-23T07:00:00.000Z',
        votingDeadline: '2026-07-27T07:00:00.000Z',
        createdAt: '2026-07-16T16:59:15.873Z',
      })],
      '2026-07-16T20:00:00.000Z',
    );
    expect(w[0].isLive).toBe(true);
  });

  it('does not treat a scheduled round that has not started as live', () => {
    // Fam-Jam pre-schedules a whole slate of rounds. The furthest-out one is
    // "last" and its deadline is in the future, but its window has not opened —
    // it is scheduled, not running. Calling it live would surface an empty
    // August round today as if its capture were broken.
    // A whole slate is pre-scheduled at once, so the last round's window is
    // chained past the intervening ones and opens well after today.
    const w = buildRoundWindows(
      [
        r({ id: 124, votingStartedAt: '2026-07-11T19:00:00Z', votingEndedAt: '2026-07-15T19:00:00Z' }),
        r({ id: 128, submissionDeadline: '2026-08-15T19:00:00Z', votingDeadline: '2026-08-19T19:00:00Z',
            createdAt: '2026-07-16T05:17:50Z' }),
        r({ id: 129, submissionDeadline: '2026-08-22T19:00:00Z', votingDeadline: '2026-08-26T19:00:00Z',
            createdAt: '2026-07-16T05:17:51Z' }),
      ],
      '2026-07-16T20:00:00.000Z',
    );
    const scheduled = w.find(x => x.id === 129)!;
    expect(Date.parse(scheduled.fromIso)).toBeGreaterThan(Date.parse('2026-07-16T20:00:00.000Z'));
    expect(scheduled.isLive).toBe(false);
  });

  it('does not treat a last round whose voting deadline has passed as live', () => {
    const w = buildRoundWindows(
      [r({ id: 9, votingDeadline: '2026-05-05T00:00:00Z', createdAt: '2026-05-01T00:00:00Z' })],
      '2026-07-01T00:00:00Z',
    );
    expect(w[0].isLive).toBe(false);
  });

  it('produces contiguous windows (no inter-round gaps that orphan chat)', () => {
    const rounds = [
      r({ id: 1, votingStartedAt: '2026-05-03T00:00:00Z', votingEndedAt: '2026-05-07T00:00:00Z' }),
      r({ id: 2, votingStartedAt: '2026-05-12T00:00:00Z', votingEndedAt: '2026-05-16T00:00:00Z' }),
      r({ id: 3, votingStartedAt: '2026-05-20T00:00:00Z', votingEndedAt: '2026-05-24T00:00:00Z' }),
    ];
    const w = buildRoundWindows(rounds, '2026-07-01T00:00:00Z');
    // every round (after the first) begins exactly where the previous ended
    for (let i = 1; i < w.length; i++) {
      expect(w[i].fromIso).toBe(w[i - 1].toIso);
    }
  });
});
