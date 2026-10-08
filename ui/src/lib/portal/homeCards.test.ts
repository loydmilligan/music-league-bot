import { describe, expect, it } from 'vitest';
import { latestDigest, latestNews, openPolls, sectionsEnabled, upNext, currentRound } from '../../../../bside/src/lib/homeCards.ts';
import { parseRoute, pathFor } from '../../../../bside/src/lib/routes.ts';
import type { PortalDigest } from '../../../../bside/src/lib/portal.ts';
import type { SeasonFeed } from '../../../../bside/src/lib/seasonFeed.ts';

const digest = (over: Partial<PortalDigest>): PortalDigest => ({
	roundId: 1, n: 1, season: 2, theme: 'T', date: 'd', winnerSong: 'w', winnerArtist: 'a',
	submitter: 's', votes: 1, hue: 'h', digestUrl: null, digestKind: null, ...over,
});

describe('home cards', () => {
	it('prefers a v2 digest with a URL', () => {
		const pick = latestDigest([
			digest({ n: 2, digestKind: 'v1', digestUrl: 'https://x/d/1' }),
			digest({ n: 3, digestKind: 'v2', digestUrl: 'https://x/d2/z', theme: 'V2' }),
		]);
		expect(pick?.theme).toBe('V2');
	});
	it('falls back to any digest URL', () => {
		expect(latestDigest([digest({ digestUrl: 'https://x/d/1' })] )?.digestUrl).toBe('https://x/d/1');
		expect(latestDigest([digest({})])).toBeNull();
	});
	it('picks the next round by due date', () => {
		const feed: SeasonFeed = {
			leagueName: 'L', season: 2, surveyOpen: false,
			links: { hub: null, polls: null, mine: null, survey: null },
			lineup: [
				{ round: 1, status: 'revealed', title: 'Old', description: null, commentRule: null, credit: [], revealAt: null, startsAt: null, songsDue: '2020-01-01T00:00:00Z', votesDue: null },
				{ round: 2, status: 'revealed', title: 'Next', description: null, commentRule: null, credit: [], revealAt: null, startsAt: null, songsDue: '2099-01-01T00:00:00Z', votesDue: null },
			],
			pollsOpen: [{ id: 'p1', round: 2, question: 'Q', blurb: null, options: [], closesAt: null }],
			pollsClosed: [],
		};
		expect(upNext(feed)?.title).toBe('Next');
		expect(openPolls(feed)).toHaveLength(1);
		expect(latestNews([{ id: 'n', title: 'Hello', body: 'b', author: null, publishedAt: 'x' }])?.title).toBe('Hello');
	});
});


describe('current round', () => {
	const NOW = Date.parse('2026-10-08T12:00:00Z');
	const feed = (over: Partial<SeasonFeed> = {}): SeasonFeed => ({
		leagueName: 'L', season: 2, surveyOpen: false,
		links: { hub: null, polls: null, mine: null, survey: null },
		lineup: [
			{ round: 1, status: 'revealed', title: 'Old', description: null, commentRule: null, credit: [], revealAt: null, startsAt: null, songsDue: '2020-01-01T00:00:00Z', votesDue: '2020-01-08T00:00:00Z' },
			{ round: 2, status: 'revealed', title: 'In Flight', description: null, commentRule: null, credit: [], revealAt: null, startsAt: '2026-10-01T00:00:00Z', songsDue: '2026-10-14T00:00:00Z', votesDue: '2026-10-21T00:00:00Z' },
			{ round: 3, status: 'teaser', title: 'Teaser', description: null, commentRule: null, credit: [], revealAt: '2026-10-30T00:00:00Z', startsAt: null, songsDue: '2026-11-10T00:00:00Z', votesDue: '2026-11-17T00:00:00Z' },
		],
		pollsOpen: [], pollsClosed: [], ...over,
	});

	it('returns null without a feed', () => {
		expect(currentRound(null, NOW)).toBeNull();
	});

	it('in submission while now < songsDue', () => {
		const c = currentRound(feed(), NOW)!;
		expect(c).not.toBeNull();
		expect(c.round.round).toBe(2);
		expect(c.phase).toBe('submission');
		expect(c.deadline).toBe('2026-10-14T00:00:00Z');
	});

	it('flips to voting between songsDue and votesDue', () => {
		const inVoting = Date.parse('2026-10-17T12:00:00Z');
		const c = currentRound(feed(), inVoting)!;
		expect(c.phase).toBe('voting');
		expect(c.deadline).toBe('2026-10-21T00:00:00Z');
	});

	it('no round is in flight after votesDue', () => {
		const after = Date.parse('2026-10-22T12:00:00Z');
		expect(currentRound(feed(), after)).toBeNull();
	});

	it('a round that has not started is not in flight', () => {
		const beforeStart = Date.parse('2026-09-30T12:00:00Z');
		expect(currentRound(feed(), beforeStart)).toBeNull();
	});

	it('picks the earliest in-flight round when multiple overlap', () => {
		const overlap: SeasonFeed = {
			...feed(),
			lineup: [
				...feed().lineup,
				// same window as round 2, but round 4 is later in the lineup
				{ round: 4, status: 'revealed', title: 'Later', description: null, commentRule: null, credit: [], revealAt: null, startsAt: '2026-10-01T00:00:00Z', songsDue: '2026-10-20T00:00:00Z', votesDue: '2026-10-28T00:00:00Z' },
			],
		};
		expect(currentRound(overlap, NOW)?.round.round).toBe(2);
	});

	it('treats a round with no songsDue as voting if votesDue is pending', () => {
		const noSongs: SeasonFeed = {
			...feed(),
			lineup: feed().lineup.map((r) => (r.round === 2 ? { ...r, songsDue: null } : r)),
		};
		const c = currentRound(noSongs, NOW)!;
		expect(c.phase).toBe('voting');
	});
});

describe('sectionsEnabled', () => {
	it('defaults every section on when portal has no sections block', () => {
		expect(sectionsEnabled(null, 'pulse')).toBe(true);
		expect(sectionsEnabled({ sections: null, roundLinks: [] } as never, 'family')).toBe(true);
	});
	it('honors enabled flags per section', () => {
		const portal = {
			sections: { enabled: { thisWeek: true, pulse: false, yearbook: true } },
		} as never;
		expect(sectionsEnabled(portal, 'pulse')).toBe(false);
		expect(sectionsEnabled(portal, 'thisWeek')).toBe(true);
		expect(sectionsEnabled(portal, 'moments')).toBe(true);
	});
});

describe('portal routes', () => {
	it('parses slug-prefixed screens', () => {
		const slug = 'U7o8L06wfe1HILD1qzk-wg';
		expect(parseRoute(`/${slug}`, slug).screen).toBe('home');
		expect(parseRoute(`/${slug}/season`, slug).screen).toBe('season');
		expect(parseRoute(`/${slug}/login/`, slug).screen).toBe('login');
		expect(parseRoute(`/${slug}/settings`, slug).screen).toBe('settings');
		expect(parseRoute(`/${slug}/admin`, slug).screen).toBe('admin');
		expect(parseRoute(`/${slug}/survey`, slug).screen).toBe('survey');
		expect(parseRoute(`/${slug}/mine`, slug).screen).toBe('mine');
		expect(parseRoute(`/${slug}/p/abc`, slug)).toEqual({ screen: 'profile', memberId: 'abc' });
		expect(pathFor(slug, { screen: 'settings' })).toBe(`/${slug}/settings`);
	});
});
