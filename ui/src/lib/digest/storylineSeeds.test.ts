import { describe, it, expect } from 'vitest';
import { STORYLINE_SEEDS } from './storylineSeeds';

describe('STORYLINE_SEEDS.sssc', () => {
	it('has all thirteen SSSC entries', () => {
		expect(STORYLINE_SEEDS.sssc).toHaveLength(13);
		expect(STORYLINE_SEEDS.sssc.map((s) => s.player)).toEqual([
			'PoetryinNoise',
			'Timmywhatup',
			'bagimation',
			'missmara',
			'KarBen',
			'mrklorox',
			'Cherry',
			'nateoeb',
			'GoodGollyMiss',
			'Lexa Prole',
			'Mouse Atreides',
			'Tragically Skip',
			'socalledbutton',
		]);
	});

	it('matches each new Regular on an on-motif line but not unrelated text', () => {
		const find = (p: string) => STORYLINE_SEEDS.sssc.find((s) => s.player === p)!;
		const hits = (p: string, text: string) => find(p).patterns.some((r) => r.test(text));
		expect(hits('mrklorox', 'land o lakes? more like all aches')).toBe(true);
		expect(hits('Cherry', "here's 24 hours of underground African stuff")).toBe(true);
		expect(hits('nateoeb', 'I may be doing too much research this time')).toBe(true);
		expect(hits('GoodGollyMiss', 'add to the rap sleeve tattoo in progress')).toBe(true);
		expect(hits('Lexa Prole', 'gang I am in full on whimsy mode')).toBe(true);
		expect(hits('Mouse Atreides', "if it doesn't make you cry what are you even doing")).toBe(true);
		expect(hits('Tragically Skip', "I'm never confident in my submissions")).toBe(true);
		expect(hits('socalledbutton', 'first time I had absinthe was in Rome')).toBe(true);
		// A plain compliment shouldn't trip any of them.
		for (const p of ['mrklorox', 'Cherry', 'nateoeb', 'GoodGollyMiss', 'Lexa Prole', 'Mouse Atreides', 'Tragically Skip', 'socalledbutton']) {
			expect(hits(p, 'great submission this week')).toBe(false);
		}
	});

	it("KarBen's patterns match his commissioner/extension lines, not unrelated text", () => {
		const seed = STORYLINE_SEEDS.sssc.find((s) => s.player === 'KarBen')!;
		expect(seed.patterns.some((p) => p.test('3 hours left to vote. No worries at all'))).toBe(true);
		expect(seed.patterns.some((p) => p.test("I'll extend the deadline for you"))).toBe(true);
		expect(seed.patterns.some((p) => p.test('peace and love everyone'))).toBe(true);
		expect(seed.patterns.some((p) => p.test('great submission this week'))).toBe(false);
	});

	it('gives every seed a motif, at least one pattern, and at least one source', () => {
		for (const seed of STORYLINE_SEEDS.sssc) {
			expect(seed.motif.length).toBeGreaterThan(0);
			expect(seed.patterns.length).toBeGreaterThan(0);
			expect(seed.sources.length).toBeGreaterThan(0);
			for (const source of seed.sources) {
				expect(['chat', 'vote_comments']).toContain(source);
			}
		}
	});

	it('every pattern is a valid, case-insensitive RegExp', () => {
		for (const seed of STORYLINE_SEEDS.sssc) {
			for (const pattern of seed.patterns) {
				expect(pattern).toBeInstanceOf(RegExp);
				expect(pattern.flags).toContain('i');
			}
		}
	});

	it("PoetryinNoise's patterns match cats and big butts, not unrelated text", () => {
		const seed = STORYLINE_SEEDS.sssc.find((s) => s.player === 'PoetryinNoise')!;
		expect(seed.patterns.some((p) => p.test('my cat knocked it off the table'))).toBe(true);
		expect(seed.patterns.some((p) => p.test('this song has such big butts energy'))).toBe(true);
		expect(seed.patterns.some((p) => p.test('great submission this week'))).toBe(false);
	});

	it('an unknown league slug has no seeds', () => {
		expect(STORYLINE_SEEDS['not-a-real-league']).toBeUndefined();
	});
});
