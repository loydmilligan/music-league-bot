import { describe, it, expect } from 'vitest';
import { normalizeSeasonFeed } from '../../../../bside/src/lib/seasonFeed.ts';

const H = 'https://survey.example/second-best/season-3/';
const base = () => ({
	version: 1,
	generatedAt: '2026-10-03T22:03:17.039Z',
	league: { key: 'second-best', name: 'SECOND BEST & FRIENDS', season: 3, mlLeagueId: null },
	portalUrl: 'https://digest.example/abc/',
	links: { hub: H, polls: H + '#polls', mine: H + '#mine', survey: H + '#survey' },
	survey: { open: true },
	lineup: [
		{ round: 10, status: 'teaser', teaser: { title: 'Poll Position', description: 'Vote!' }, revealAt: '2026-11-22T08:00:00.000Z', startsAt: null, songsDue: null, votesDue: null },
		{ round: 2, status: 'revealed', title: 'I Bought the Soundtrack', description: 'Soundtrack songs',
			commentRule: { level: 'required', prompt: 'Say why', hiddenUntilVotingEnds: false },
			credit: ['Sarah Black'], startsAt: '2026-10-11T07:00:00Z', songsDue: '2026-10-14T07:00:00Z', votesDue: '2026-10-18T07:00:00Z' }
	],
	polls: {
		open: [{ id: 'p1', round: 10, question: 'Q?', blurb: null, options: [{ id: 'o1', label: 'A', description: null }], closesAt: null }],
		closed: [{ id: 'p0', round: 9, question: 'Q0', blurb: 'b', results: [{ label: 'low', votes: 1 }, { label: 'high', votes: 4 }], winner: 'high', closedAt: '2026-10-01T00:00:00Z' }]
	}
});

describe('normalizeSeasonFeed', () => {
	it('normalizes a valid v1 body, sorting lineup and closed results', () => {
		const f = normalizeSeasonFeed(base())!;
		expect(f.leagueName).toBe('SECOND BEST & FRIENDS');
		expect(f.season).toBe(3);
		expect(f.surveyOpen).toBe(true);
		expect(f.links.hub).toBe(H);
		expect(f.lineup.map((r) => r.round)).toEqual([2, 10]);
		expect(f.lineup[0]).toMatchObject({ status: 'revealed', title: 'I Bought the Soundtrack', credit: ['Sarah Black'], commentRule: { level: 'required', prompt: 'Say why', hiddenUntilVotingEnds: false } });
		expect(f.pollsOpen[0].options[0]).toEqual({ id: 'o1', label: 'A', description: null });
		expect(f.pollsClosed[0].results.map((r) => r.label)).toEqual(['high', 'low']);
		expect(f.pollsClosed[0].winner).toBe('high');
	});

	it('teaser round never leaks title/description/credit/commentRule', () => {
		const b = base();
		Object.assign(b.lineup[0], { title: 'SECRET', description: 'SECRET', credit: ['X'], commentRule: { level: 'required', prompt: 'SECRET', hiddenUntilVotingEnds: true } });
		const f = normalizeSeasonFeed(b)!;
		const t = f.lineup.find((r) => r.round === 10)!;
		expect(t.title).toBe('Poll Position');
		expect(t.description).toBe('Vote!');
		expect(t.credit).toEqual([]);
		expect(t.commentRule).toBeNull();
		expect(JSON.stringify(f)).not.toContain('SECRET');
	});

	it('empty teaser title becomes Mystery round', () => {
		const b = base();
		(b.lineup[0] as any).teaser = { title: '', description: '' };
		expect(normalizeSeasonFeed(b)!.lineup[1].title).toBe('Mystery round');
	});

	it('rejects bad versions and shapes', () => {
		expect(normalizeSeasonFeed({ ...base(), version: 2 })).toBeNull();
		expect(normalizeSeasonFeed(null)).toBeNull();
		expect(normalizeSeasonFeed('x')).toBeNull();
		expect(normalizeSeasonFeed({ version: 1 })).toBeNull();
	});

	it('defaults missing optional fields', () => {
		const f = normalizeSeasonFeed({ version: 1, lineup: [] })!;
		expect(f.surveyOpen).toBe(false);
		expect(f.links).toEqual({ hub: null, polls: null, mine: null, survey: null });
		expect(f.pollsOpen).toEqual([]);
		expect(f.pollsClosed).toEqual([]);
	});

	it('non-https links become null', () => {
		const b = base();
		b.links = { hub: 'http://x.example/', polls: 'javascript:alert(1)', mine: 'not a url', survey: H };
		const f = normalizeSeasonFeed(b)!;
		expect(f.links).toEqual({ hub: null, polls: null, mine: null, survey: H });
	});
});
