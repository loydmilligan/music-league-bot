import { describe, it, expect } from 'vitest';
import { computeSeasonSignals } from './seasonSignals.js';
import type { SeasonTimeline, RoundStandingSnapshot } from './seasonTimeline.js';

function snap(roundNumber: number, name: string, rows: Array<[string, number, number, number, number, number | null]>): RoundStandingSnapshot {
  return {
    roundId: roundNumber, roundNumber, name,
    standings: rows.map(([nm, rank, priorTotal, roundPoints, currentTotal, prevRank], i) => ({
      competitorId: i + 1, name: nm, rank, prevRank, priorTotal, roundPoints, currentTotal,
    })),
  };
}
function timeline(snapshots: RoundStandingSnapshot[]): SeasonTimeline {
  return {
    leagueId: 1, seasonId: 1,
    rounds: snapshots.map(s => ({ roundId: s.roundId, roundNumber: s.roundNumber, name: s.name })),
    standingsByRound: snapshots, tastemakerByRound: new Map(), votePairs: [],
  };
}

describe('movers', () => {
  it('flags the biggest upward mover into the top', () => {
    const t = timeline([
      snap(1, 'R1', [['A', 1, 0, 5, 5, null], ['B', 2, 0, 1, 1, null]]),
      // round 2: B jumps from rank 2 to rank 1
      snap(2, 'R2', [['B', 1, 1, 9, 10, 2], ['A', 2, 5, 1, 6, 1]]),
    ]);
    const sig = computeSeasonSignals(t);
    expect(sig.bigMover?.player).toBe('B');
    expect(sig.bigMover?.fromRank).toBe(2);
    expect(sig.bigMover?.toRank).toBe(1);
  });

  it('flags the biggest faller toward the bottom', () => {
    const t = timeline([
      snap(1, 'R1', [['A', 1, 0, 9, 9, null], ['B', 2, 0, 5, 5, null], ['C', 3, 0, 1, 1, null]]),
      snap(2, 'R2', [['B', 1, 5, 9, 14, 2], ['C', 2, 1, 9, 10, 3], ['A', 3, 9, 0, 9, 1]]),
    ]);
    const sig = computeSeasonSignals(t);
    expect(sig.faller?.player).toBe('A');
    expect(sig.faller?.toRank).toBe(3);
  });

  it('returns null movers for a single-round season', () => {
    const sig = computeSeasonSignals(timeline([snap(1, 'R1', [['A', 1, 0, 5, 5, null]])]));
    expect(sig.bigMover).toBeNull();
    expect(sig.faller).toBeNull();
  });
});

describe('streaks', () => {
  it('detects a 2+ round surge (rank improving each round)', () => {
    const t = timeline([
      snap(1, 'R1', [['A', 3, 0, 1, 1, null], ['B', 1, 0, 9, 9, null], ['C', 2, 0, 5, 5, null]]),
      snap(2, 'R2', [['A', 2, 1, 6, 7, 3], ['B', 1, 9, 5, 14, 1], ['C', 3, 5, 1, 6, 2]]),
      snap(3, 'R3', [['A', 1, 7, 9, 16, 2], ['B', 2, 14, 1, 15, 1], ['C', 3, 6, 5, 11, 3]]),
    ]);
    const surge = computeSeasonSignals(t).streaks.find(s => s.player === 'A');
    expect(surge?.direction).toBe('surging');
    expect(surge?.rounds).toBe(2);
  });
});

import type { TastemakerPayload } from '../db/discoverability.js';

function tm(season: string, players: Array<[string, number]>): TastemakerPayload {
  return {
    scope: 'season', season,
    players: players.map(([name, tastemakerScore], i) => ({
      name, rank: i + 1, prevRank: null, tastemakerScore, avgPoints: 0, submissionCount: 1,
      buckets: { radioHit: 0, recognizable: 0, curiousCut: 0, rabbitHole: 0 }, songs: [],
    })),
    bucketBoundaries: { b1: 10, b2: 20, b3: 30 },
  };
}

describe('discoveryShifts', () => {
  it('flags a usually-obscure player going radio-safe', () => {
    const base: import('./seasonTimeline.js').SeasonTimeline = {
      leagueId: 1, seasonId: 1,
      rounds: [{ roundId: 1, roundNumber: 1, name: 'R1' }, { roundId: 2, roundNumber: 2, name: 'R2' }],
      standingsByRound: [snap(1, 'R1', [['A', 1, 0, 5, 5, null]]), snap(2, 'R2', [['A', 1, 5, 5, 10, 1]])],
      tastemakerByRound: new Map([
        [1, tm('S', [['A', 80]])],   // baseline obscure
        [2, tm('S', [['A', 30]])],   // recent mainstream
      ]),
      votePairs: [],
    };
    const shift = computeSeasonSignals(base).discoveryShifts.find(s => s.player === 'A');
    expect(shift?.direction).toBe('went-safe');
  });
});

function tlWithPairs(pairs: import('./seasonTimeline.js').VotePair[]): import('./seasonTimeline.js').SeasonTimeline {
  return {
    leagueId: 1, seasonId: 1,
    rounds: [{ roundId: 1, roundNumber: 1, name: 'R1' }, { roundId: 2, roundNumber: 2, name: 'R2' }],
    standingsByRound: [snap(1, 'R1', [['A', 1, 0, 5, 5, null]])],
    tastemakerByRound: new Map(), votePairs: pairs,
  };
}

describe('rivalries', () => {
  it('detects a reciprocal downvote pair', () => {
    const sig = computeSeasonSignals(tlWithPairs([
      { voterId: 1, voterName: 'A', targetId: 2, targetName: 'B', roundId: 1, roundNumber: 1, points: -1, song: 'b1' },
      { voterId: 2, voterName: 'B', targetId: 1, targetName: 'A', roundId: 2, roundNumber: 2, points: -1, song: 'a2' },
      { voterId: 3, voterName: 'C', targetId: 1, targetName: 'A', roundId: 1, roundNumber: 1, points: 3, song: 'a1' },
    ]));
    const r = sig.rivalries.find(x => x.kind === 'reciprocal-downvote');
    expect(r).toBeTruthy();
    expect([...r!.players].sort()).toEqual(['A', 'B']);
    expect(r!.rounds.sort()).toEqual([1, 2]);
  });

  it('detects a spot-trading pair (A>B then B>A then A>B = 2 swaps)', () => {
    const t = timeline([
      snap(1, 'R1', [['A', 1, 0, 9, 9, null], ['B', 2, 0, 5, 5, null]]),
      snap(2, 'R2', [['B', 1, 5, 9, 14, 2], ['A', 2, 9, 1, 10, 1]]),
      snap(3, 'R3', [['A', 1, 10, 9, 19, 2], ['B', 2, 14, 1, 15, 1]]),
    ]);
    const r = computeSeasonSignals(t).rivalries.find(x => x.kind === 'spot-trading');
    expect(r).toBeTruthy();
    expect([...r!.players].sort()).toEqual(['A', 'B']);
  });

  it('does not flag spot-trading with only one swap', () => {
    const t = timeline([
      snap(1, 'R1', [['A', 1, 0, 9, 9, null], ['B', 2, 0, 5, 5, null]]),
      snap(2, 'R2', [['B', 1, 5, 9, 14, 2], ['A', 2, 9, 1, 10, 1]]),
    ]);
    expect(computeSeasonSignals(t).rivalries.filter(r => r.kind === 'spot-trading')).toHaveLength(0);
  });
});

describe('punchingBagGuard', () => {
  it('includes the faller in punchingBagGuard', () => {
    const t = timeline([
      snap(1, 'R1', [['A', 1, 0, 9, 9, null], ['B', 2, 0, 5, 5, null]]),
      snap(2, 'R2', [['B', 1, 5, 9, 14, 2], ['A', 2, 9, 0, 9, 1]]),
    ]);
    expect(computeSeasonSignals(t).punchingBagGuard).toContain('A');
  });

  it('includes rivalry participants in punchingBagGuard', () => {
    const t: SeasonTimeline = {
      leagueId: 1, seasonId: 1,
      rounds: [{ roundId: 1, roundNumber: 1, name: 'R1' }, { roundId: 2, roundNumber: 2, name: 'R2' }],
      standingsByRound: [snap(1, 'R1', [['A', 1, 0, 5, 5, null]])],
      tastemakerByRound: new Map(),
      votePairs: [
        { voterId: 1, voterName: 'A', targetId: 2, targetName: 'B', roundId: 1, roundNumber: 1, points: -1, song: 'b1' },
        { voterId: 2, voterName: 'B', targetId: 1, targetName: 'A', roundId: 2, roundNumber: 2, points: -1, song: 'a2' },
      ],
    };
    const guard = computeSeasonSignals(t).punchingBagGuard;
    expect(guard).toContain('A');
    expect(guard).toContain('B');
  });

  it('returns empty punchingBagGuard when no faller and no rivalries', () => {
    const t = timeline([snap(1, 'R1', [['A', 1, 0, 5, 5, null]])]);
    expect(computeSeasonSignals(t).punchingBagGuard).toEqual([]);
  });
});

describe('upcomingTension', () => {
  it('lists top contenders with gap to leader', () => {
    const t = timeline([
      snap(1, 'R1', [['A', 1, 0, 9, 20, 1], ['B', 2, 0, 9, 18, 2], ['C', 3, 0, 9, 5, 3]]),
    ]);
    const sig = computeSeasonSignals(t, { nextRound: { roundNumber: 2, name: 'Pick Me Up' } });
    expect(sig.upcomingTension?.contenders[0]).toEqual({ player: 'A', total: 20, gapToLeader: 0 });
    expect(sig.upcomingTension?.contenders[1].gapToLeader).toBe(2);
    expect(sig.upcomingTension?.nextRound?.name).toBe('Pick Me Up');
  });
});
