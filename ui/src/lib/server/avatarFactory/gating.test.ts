import { describe, expect, it } from 'vitest';
import { canRequestGroupShot, clampOptionCount, groupShotBlockReason, optionLetters } from './gating.js';

describe('group-shot gating', () => {
	it('is locked when any member lacks an approved avatar', () => {
		const members = [
			{ slug: 'matt-mariani', approvedCandidateId: 'a' },
			{ slug: 'jon-black', approvedCandidateId: null },
		];
		expect(canRequestGroupShot(members)).toBe(false);
		expect(groupShotBlockReason(members)).toMatch(/jon-black/);
	});

	it('unlocks when every member has an approved avatar', () => {
		const members = [
			{ slug: 'matt-mariani', approvedCandidateId: 'a' },
			{ slug: 'jon-black', approvedCandidateId: 'b' },
		];
		expect(canRequestGroupShot(members)).toBe(true);
		expect(groupShotBlockReason(members)).toBeNull();
	});

	it('is locked for an empty roster', () => {
		expect(canRequestGroupShot([])).toBe(false);
	});
});

describe('option cap', () => {
	it('caps at 3 options labeled A/B/C', () => {
		expect(clampOptionCount(99)).toBe(3);
		expect(optionLetters(3)).toEqual(['A', 'B', 'C']);
		expect(optionLetters(1)).toEqual(['A']);
	});
});
