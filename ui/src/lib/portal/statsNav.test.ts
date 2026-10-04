import { describe, it, expect } from 'vitest';
import { buildStatsNav } from './statsNav.js';
describe('buildStatsNav', () => {
	it('depth 2 (/stats/) uses ../ and season links relative to stats/', () => {
		const n = buildStatsNav({ leagueName: 'Boarz', depth: 2, seasons: [1, 2], currentSeason: 2, selectedSeason: 2 });
		expect([n.homeHref, n.digestsHref, n.seasonHref]).toEqual(['../', '../archive', '../season']);
		expect(n.statsHref).toBe('./');
		expect(n.seasons).toEqual([
			{ number: 2, href: './', current: true, selected: true },
			{ number: 1, href: 's1/', current: false, selected: false }
		]);
	});
	it('depth 3 (/stats/s1/) climbs two levels', () => {
		const n = buildStatsNav({ leagueName: 'Boarz', depth: 3, seasons: [1, 2], currentSeason: 2, selectedSeason: 1 });
		expect([n.homeHref, n.digestsHref, n.seasonHref]).toEqual(['../../', '../../archive', '../../season']);
		expect(n.statsHref).toBe('../');
		expect(n.seasons).toEqual([
			{ number: 2, href: '../', current: true, selected: false },
			{ number: 1, href: '../s1/', current: false, selected: true }
		]);
	});
	it('never emits a root-relative href', () => {
		const n = buildStatsNav({ leagueName: 'X', depth: 3, seasons: [1, 2, 3], currentSeason: 3, selectedSeason: 1 });
		for (const h of [n.homeHref, n.digestsHref, n.seasonHref, ...n.seasons.map((s) => s.href)]) expect(h.startsWith('/')).toBe(false);
	});
});
