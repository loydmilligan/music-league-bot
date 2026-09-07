import { describe, it, expect } from 'vitest';
import { pctMatrix, rankImpactMatrix, type RoundVotes } from './matrices.js';

const roster = ['A', 'B', 'C'];

describe('pctMatrix', () => {
	it("a cell is the voter's share of the recipient's net total", () => {
		// B receives 10 from A and 90 from C -> A supplied 10%.
		const m = pctMatrix(roster, [
			{ voter: 'A', submitter: 'B', points: 10 },
			{ voter: 'C', submitter: 'B', points: 90 },
		]);
		expect(m[0][1]).toBe(10);
		expect(m[2][1]).toBe(90);
	});

	it('a downvote reads as a negative share rather than being hidden as zero', () => {
		const m = pctMatrix(roster, [
			{ voter: 'A', submitter: 'B', points: -1 },
			{ voter: 'C', submitter: 'B', points: 101 },
		]);
		expect(m[0][1]).toBeLessThan(0);
	});

	it('a recipient with no net points has no denominator, so the column is null', () => {
		const m = pctMatrix(roster, [{ voter: 'A', submitter: 'B', points: 0 }]);
		expect(m[0][1]).toBeNull();
		expect(m[2][1]).toBeNull();
	});

	it('leaves the diagonal null', () => {
		const m = pctMatrix(roster, [{ voter: 'A', submitter: 'B', points: 5 }]);
		expect(m[0][0]).toBeNull();
	});
});

describe('rankImpactMatrix', () => {
	// The worked example: B is 2nd on 10, C is 3rd on 9, A is 1st on 20.
	// A gave B 3. Remove A's whole ballot: B drops to 7, C to 9 -> B falls to 3rd.
	const round: RoundVotes = {
		roundId: 1,
		votes: [
			{ voter: 'A', submitter: 'B', points: 3 },
			{ voter: 'C', submitter: 'B', points: 7 },
			{ voter: 'B', submitter: 'C', points: 9 },
			{ voter: 'B', submitter: 'A', points: 20 },
		],
	};

	it('counts the positions a submitter drops when a voter is removed', () => {
		const m = rankImpactMatrix(['A', 'B', 'C'], [round]);
		expect(m[0][1]).toBe(1); // removing A drops B one place
	});

	it('is negative when a voter was holding someone back', () => {
		const m = rankImpactMatrix(['A', 'B', 'C'], [round]);
		const anyNegative = m.flat().some((v) => v !== null && v < 0);
		expect(anyNegative).toBe(true);
	});

	it('sums across rounds', () => {
		const m = rankImpactMatrix(['A', 'B', 'C'], [round, { ...round, roundId: 2 }]);
		expect(m[0][1]).toBe(2);
	});

	it('removes the whole ballot, so a cell can move without a direct vote', () => {
		// A gives C nothing, but removing A's ballot lifts C past B.
		const m = rankImpactMatrix(['A', 'B', 'C'], [round]);
		expect(m[0][2]).toBeLessThanOrEqual(0);
	});

	it('leaves the diagonal null', () => {
		expect(rankImpactMatrix(['A', 'B', 'C'], [round])[1][1]).toBeNull();
	});
});
