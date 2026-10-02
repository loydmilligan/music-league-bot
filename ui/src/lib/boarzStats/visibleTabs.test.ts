import { describe, it, expect } from 'vitest';
import { computeVisibleTabIds } from './visibleTabs.js';

const TABS = [
	{ id: 'leaderboard', seasonOnly: true },
	{ id: 'songs' },
	{ id: 'chat', needsChat: true },
	{ id: 'wrapped', seasonOnly: true }
] as const;

describe('computeVisibleTabIds', () => {
	it('keeps all when chat present, single season, nothing omitted', () => {
		expect(
			computeVisibleTabIds(TABS, { hasChat: true, isAllSeasons: false, crossSeasonView: 'combined', omitTabs: [] })
		).toEqual(['leaderboard', 'songs', 'chat', 'wrapped']);
	});

	it('drops chat when capability absent', () => {
		expect(
			computeVisibleTabIds(TABS, { hasChat: false, isAllSeasons: false, crossSeasonView: 'combined', omitTabs: [] })
		).toEqual(['leaderboard', 'songs', 'wrapped']);
	});

	it('drops seasonOnly tabs in multi-season hide-season view', () => {
		expect(
			computeVisibleTabIds(TABS, { hasChat: true, isAllSeasons: true, crossSeasonView: 'hide-season', omitTabs: [] })
		).toEqual(['songs', 'chat']);
	});

	it('removes explicitly omitted tabs (e.g. chat moved into the digest)', () => {
		expect(
			computeVisibleTabIds(TABS, { hasChat: true, isAllSeasons: false, crossSeasonView: 'combined', omitTabs: ['chat'] })
		).toEqual(['leaderboard', 'songs', 'wrapped']);
	});
});
