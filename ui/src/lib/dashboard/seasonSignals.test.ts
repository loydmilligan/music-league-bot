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
