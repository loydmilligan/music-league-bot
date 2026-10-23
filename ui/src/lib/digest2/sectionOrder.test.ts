import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { DIGEST2_SECTION_ORDER } from './sectionOrder.js';

describe('DIGEST2_SECTION_ORDER', () => {
	it('ends with the next-round ("What\'s up next") section', () => {
		expect(DIGEST2_SECTION_ORDER.at(-1)).toBe('nextRound');
	});
	it('lists every section exactly once', () => {
		expect(new Set(DIGEST2_SECTION_ORDER).size).toBe(DIGEST2_SECTION_ORDER.length);
		expect([...DIGEST2_SECTION_ORDER].sort()).toEqual(
			['ama', 'ballot', 'ballotGrid', 'coinage', 'guesser', 'nextRound', 'reel', 'standings', 'statsTeaser', 'story', 'tastemaker', 'villain'].sort()
		);
	});
	it('the page renders sections by iterating the order list (not a hand-ordered block)', () => {
		const src = readFileSync('src/routes/digest2/[roundId]/+page.svelte', 'utf8');
		expect(src).toContain('{#each DIGEST2_SECTION_ORDER as key (key)}');
		// NextRoundPreview must appear exactly once, inside the loop's nextRound branch.
		expect(src.match(/<NextRoundPreview/g)?.length).toBe(1);
	});
});
