import { describe, expect, it } from 'vitest';
import {
	computeRoundScores,
	computeCumulative,
	computePositionsByRound,
	computeTiebreakCounts,
	computeHeatmap,
	computeContrarian,
	computeGenerosity,
	computeEagerness,
	computePositionBias,
	type Sub,
	type Vote,
} from './stats.js';

const N_COMPS = 3;
const N_ROUNDS = 3;

function sub(roundIdx: number, compIdx: number, i: number): Sub {
	return {
		roundIdx,
		compIdx,
		uri: `spotify:track: song${i}`,
		title: `song${i}`,
		artists: [],
		art: null,
		createdAt: `2026-07-0${roundIdx + 1}T10:0${compIdx}:00Z`,
		totalPts: 0,
		votesReceived: 0,
	};
}

// round 0: all three submit; round 1: comp 2 misses; round 2: all submit
const subs: Sub[] = [sub(0, 0, 0), sub(0, 1, 1), sub(0, 2, 2), sub(1, 0, 3), sub(1, 1, 4), sub(2, 0, 5), sub(2, 1, 6), sub(2, 2, 7)];
const songIdx = (roundIdx: number, compIdx: number) => subs.findIndex((s) => s.roundIdx === roundIdx && s.compIdx === compIdx);

const votes: Vote[] = [
	// round 0: voter0 gives song1 3pts, song2 1pt, song0 0; voter1: song0 4, song2 -1; voter2: song0 2, song1 2
	{ roundIdx: 0, voterIdx: 0, songIdx: songIdx(0, 1), pts: 3, createdAt: '2026-07-01T12:00:00Z' },
	{ roundIdx: 0, voterIdx: 0, songIdx: songIdx(0, 2), pts: 1, createdAt: '2026-07-01T12:01:00Z' },
	{ roundIdx: 0, voterIdx: 0, songIdx: songIdx(0, 0), pts: 0, createdAt: '2026-07-01T12:02:00Z' },
	{ roundIdx: 0, voterIdx: 1, songIdx: songIdx(0, 0), pts: 4, createdAt: '2026-07-01T13:00:00Z' },
	{ roundIdx: 0, voterIdx: 1, songIdx: songIdx(0, 2), pts: -1, createdAt: '2026-07-01T13:01:00Z' },
	{ roundIdx: 0, voterIdx: 2, songIdx: songIdx(0, 0), pts: 2, createdAt: '2026-07-01T14:00:00Z' },
	{ roundIdx: 0, voterIdx: 2, songIdx: songIdx(0, 1), pts: 2, createdAt: '2026-07-01T14:01:00Z' },
	// round 1: comp2 absent as voter too — only 0 and 1 vote
	{ roundIdx: 1, voterIdx: 0, songIdx: songIdx(1, 1), pts: 4, createdAt: '2026-07-02T12:00:00Z' },
	{ roundIdx: 1, voterIdx: 1, songIdx: songIdx(1, 0), pts: 2, createdAt: '2026-07-02T13:00:00Z' },
	// round 2: everyone
	{ roundIdx: 2, voterIdx: 0, songIdx: songIdx(2, 1), pts: 1, createdAt: '2026-07-03T12:00:00Z' },
	{ roundIdx: 2, voterIdx: 1, songIdx: songIdx(2, 2), pts: 2, createdAt: '2026-07-03T13:00:00Z' },
	{ roundIdx: 2, voterIdx: 2, songIdx: songIdx(2, 0), pts: 3, createdAt: '2026-07-03T14:00:00Z' },
];

describe('round scores & standings', () => {
	it('sums points per submitter per round', () => {
		const scores = computeRoundScores(subs, votes, N_ROUNDS, N_COMPS);
		// round 0: comp0 = 0+4+2 = 6, comp1 = 3+2 = 5, comp2 = 1-1 = 0
		expect(scores[0]).toEqual([6, 5, 0]);
		// round 1: comp0 = 2, comp1 = 4
		expect(scores[1]).toEqual([2, 4, 0]);
		// round 2: comp0 = 3, comp1 = 1, comp2 = 2
		expect(scores[2]).toEqual([3, 1, 2]);
	});

	it('carries totals forward through missed rounds', () => {
		const cum = computeCumulative(computeRoundScores(subs, votes, N_ROUNDS, N_COMPS));
		// comp2 missed round 1: 0 then still 0, then +2
		expect(cum[1][2]).toBe(0);
		expect(cum[2][2]).toBe(2);
		expect(cum[2]).toEqual([11, 10, 2]);
	});

	it('ranks positions with ties broken by first index', () => {
		const pos = computePositionsByRound(computeCumulative(computeRoundScores(subs, votes, N_ROUNDS, N_COMPS)));
		expect(pos[0]).toEqual([1, 2, 3]); // 6,5,0
		expect(pos[2]).toEqual([1, 2, 3]); // 11,10,2
	});
});

// Boarz non-voter rule (same as standings' SCORED_POINTS_SQL): a submitter with no
// ballot in a round keeps the negatives their song drew and forfeits the positives.
describe('non-voter forfeit + standings tiebreak', () => {
	// one round, four submitters; comp3 submits but casts no ballot
	const s4 = [sub(0, 0, 10), sub(0, 1, 11), sub(0, 2, 12), sub(0, 3, 13)];
	const at = (c: number) => s4.findIndex((s) => s.compIdx === c);
	const v4: Vote[] = [
		{ roundIdx: 0, voterIdx: 0, songIdx: at(3), pts: 3, createdAt: 't' },
		{ roundIdx: 0, voterIdx: 1, songIdx: at(3), pts: -1, createdAt: 't' },
		// comp1 and comp2 both end on 3: comp2 from two upvoters, comp1 from one
		{ roundIdx: 0, voterIdx: 0, songIdx: at(1), pts: 3, createdAt: 't' },
		{ roundIdx: 0, voterIdx: 0, songIdx: at(2), pts: 2, createdAt: 't' },
		{ roundIdx: 0, voterIdx: 1, songIdx: at(2), pts: 1, createdAt: 't' },
		{ roundIdx: 0, voterIdx: 2, songIdx: at(0), pts: 1, createdAt: 't' },
	];

	it('a non-voter keeps negatives only', () => {
		expect(computeRoundScores(s4, v4, 1, 4)[0]).toEqual([1, 3, 3, -1]);
	});

	it('forfeited upvotes do not count toward the tiebreak', () => {
		expect(computeTiebreakCounts(s4, v4, 1, 4)).toEqual({ up: [[1, 1, 2, 0]], down: [[0, 0, 0, 1]] });
	});

	it('ties on points go to more upvotes received, not to the lower index', () => {
		const cum = computeCumulative(computeRoundScores(s4, v4, 1, 4));
		expect(computePositionsByRound(cum)[0]).toEqual([3, 1, 2, 4]); // no tiebreak: index order
		expect(computePositionsByRound(cum, computeTiebreakCounts(s4, v4, 1, 4))[0]).toEqual([3, 2, 1, 4]);
	});
});

describe('heatmap normalization', () => {
	it('restricts averages to co-active rounds', () => {
		const heat = computeHeatmap(subs, votes, N_ROUNDS, N_COMPS);
		// voter0 -> comp1: votes in rounds 0,1,2 (3,4,1 = 8). Co-active: 0,1,2 (both submitted) = 3
		expect(heat.raw[0][1]).toBe(8);
		expect(heat.both[0][1]).toBe(3);
		expect(heat.norm[0][1]).toBeCloseTo(8 / 3);
		// voter2 -> comp0: voted round 0 (2 pts) and round 2 (3 pts) = 5. Co-active = 2
		expect(heat.raw[2][0]).toBe(5);
		expect(heat.norm[2][0]).toBeCloseTo(2.5);
	});
});

describe('fun stats', () => {
	it('computes contrarian on non-zero votes only', () => {
		const c = computeContrarian(votes, N_COMPS);
		// voter0's non-zero votes hit: song1 (total 5), song2 (total 0), round1 comp1's song (total 4), round2 comp1's song (total 1)
		expect(c[0].avg).toBeCloseTo((5 + 0 + 4 + 1) / 4);
		expect(c[0].used).toBe(4);
	});

	it('includes zeros in generosity', () => {
		const g = computeGenerosity(votes, N_COMPS);
		// voter0: total 3+1+0+4+1 = 9 across 5 votes
		expect(g[0].total).toBe(9);
		expect(g[0].cast).toBe(5);
		expect(g[0].avg).toBeCloseTo(1.8);
	});

	it('ranks eagerness by submission/vote timing percentile', () => {
		const e = computeEagerness(subs, votes, N_COMPS);
		// submissions round0: comp0 at 10:00 (first of 3) => 100; comp1 => 50; comp2 => 0
		// comp0 rounds: 0,1,2 -> sub pct: 100, 100 (first of 2 in round1), 100 = 100
		expect(e[0].sub).toBeCloseTo(100);
		// comp2 subs only in rounds 0 and 2: 0 and 0 -> 0
		expect(e[2].sub).toBeCloseTo(0);
		// comp1: round0 50, round1 0, round2 50 -> 33.33
		expect(e[1].sub).toBeCloseTo(100 / 3, 1);
	});
});

describe('playlist position bias', () => {
	it('assigns alphabetical and chronological slots', () => {
		const uriBias = computePositionBias(subs, 'uri');
		const chronoBias = computePositionBias(subs, 'chrono');
		// every round has 2-3 subs, so slot 1 exists in all rounds
		expect(uriBias.length).toBeGreaterThan(0);
		expect(chronoBias.length).toBeGreaterThan(0);
		// sample sizes must add up to total subs
		expect(uriBias.reduce((a, p) => a + p.rounds, 0)).toBe(subs.length);
		expect(chronoBias.reduce((a, p) => a + p.rounds, 0)).toBe(subs.length);
	});
});
