/**
 * Tests for ui/src/lib/lastfm.ts — Last.fm provider handlers.
 *
 * HTTP calls are mocked via vi.stubGlobal('fetch', ...) so no real network
 * requests are made. DB uses openLeagueDb(':memory:') for isolation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { openLeagueDb } from './db/client.js';
import type Database from 'better-sqlite3';
import {
	normalizeTrackTitle,
	computePopularityProxies,
	getLastfmPopularity,
	fetchPopularity,
	fetchTags
} from './lastfm.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function freshDb(): Database.Database {
	return openLeagueDb(':memory:');
}

function makeFetch(responses: Array<{ ok: boolean; status?: number; body: object }>) {
	const calls = [...responses];
	return vi.fn().mockImplementation(async () => {
		const next = calls.shift();
		if (!next) throw new Error('Unexpected fetch call — no more mock responses');
		return {
			ok: next.ok,
			status: next.status ?? (next.ok ? 200 : 500),
			json: async () => next.body
		} as unknown as Response;
	});
}

// ---------------------------------------------------------------------------
// normalizeTrackTitle
// ---------------------------------------------------------------------------

describe('normalizeTrackTitle', () => {
	it('strips remaster suffix', () => {
		expect(normalizeTrackTitle('Bohemian Rhapsody - Remastered 2011')).toBe('Bohemian Rhapsody');
	});
	it('strips parenthetical live marker', () => {
		expect(normalizeTrackTitle('Under Pressure (Live)')).toBe('Under Pressure');
	});
	it('leaves a plain title untouched', () => {
		expect(normalizeTrackTitle('Space Oddity')).toBe('Space Oddity');
	});
	it('strips year-only suffix', () => {
		expect(normalizeTrackTitle('Heroes - 2017 Remaster')).toBe('Heroes');
	});
	it('handles empty string by returning empty string', () => {
		expect(normalizeTrackTitle('')).toBe('');
	});
});

// ---------------------------------------------------------------------------
// computePopularityProxies
// ---------------------------------------------------------------------------

describe('computePopularityProxies', () => {
	it('returns 100 for the single highest song', () => {
		const rows = [{ listeners: 1_000_000, playcount: 5_000_000 }];
		expect(computePopularityProxies(rows)).toEqual([100]);
	});
	it('returns 0 for all-zero rows', () => {
		const rows = [
			{ listeners: 0, playcount: 0 },
			{ listeners: 0, playcount: 0 }
		];
		expect(computePopularityProxies(rows)).toEqual([0, 0]);
	});
	it('higher listener counts produce higher scores', () => {
		const rows = [
			{ listeners: 10, playcount: 0 },
			{ listeners: 1_000_000, playcount: 0 }
		];
		const [low, high] = computePopularityProxies(rows);
		expect(high).toBeGreaterThan(low);
	});
});

// ---------------------------------------------------------------------------
// getLastfmPopularity (integration-ish with mocked fetch)
// ---------------------------------------------------------------------------

describe('getLastfmPopularity', () => {
	let originalFetch: typeof fetch;
	beforeEach(() => {
		originalFetch = global.fetch;
	});
	afterEach(() => {
		global.fetch = originalFetch;
		vi.restoreAllMocks();
	});

	it('returns listeners and playcount from search+getInfo path', async () => {
		const searchResponse = {
			results: {
				trackmatches: {
					track: [{ name: 'Space Oddity', artist: 'David Bowie', listeners: '1000' }]
				}
			}
		};
		const infoResponse = {
			track: { listeners: '1234567', playcount: '9876543' }
		};

		vi.stubGlobal(
			'fetch',
			makeFetch([
				{ ok: true, body: searchResponse },
				{ ok: true, body: infoResponse }
			])
		);

		const result = await getLastfmPopularity('David Bowie', 'Space Oddity', 'fake-key');
		expect(result.listeners).toBe(1234567);
		expect(result.playcount).toBe(9876543);
		expect(result.matchedArtist).toBe('David Bowie');
		expect(result.matchedTitle).toBe('Space Oddity');
		expect(result.error).toBeUndefined();
	});

	it('returns error from Last.fm API error response', async () => {
		const errorSearch = {
			results: { trackmatches: { track: [] } }
		};
		const errorInfo = {
			error: 6,
			message: 'Track not found'
		};

		vi.stubGlobal(
			'fetch',
			makeFetch([
				{ ok: true, body: errorSearch },
				{ ok: true, body: errorInfo }
			])
		);

		const result = await getLastfmPopularity('Unknown', 'XYZ404', 'fake-key');
		expect(result.error).toBe('Track not found');
		expect(result.listeners).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// fetchPopularity
// ---------------------------------------------------------------------------

describe('fetchPopularity', () => {
	let originalFetch: typeof fetch;
	let originalEnv: string | undefined;

	beforeEach(() => {
		originalFetch = global.fetch;
		originalEnv = process.env.LASTFM_API_KEY;
		process.env.LASTFM_API_KEY = 'test-key';
	});
	afterEach(() => {
		global.fetch = originalFetch;
		if (originalEnv === undefined) delete process.env.LASTFM_API_KEY;
		else process.env.LASTFM_API_KEY = originalEnv;
		vi.restoreAllMocks();
	});

	it('throws when LASTFM_API_KEY is not set', async () => {
		delete process.env.LASTFM_API_KEY;
		const db = freshDb();
		await expect(fetchPopularity(db, 'uri', 'title', 'artist')).rejects.toThrow(
			'LASTFM_API_KEY not set'
		);
	});

	it('inserts a new row into song_popularity', async () => {
		const db = freshDb();
		const searchBody = {
			results: {
				trackmatches: {
					track: [{ name: 'Space Oddity', artist: 'David Bowie', listeners: '1000' }]
				}
			}
		};
		const infoBody = { track: { listeners: '500000', playcount: '2000000' } };

		vi.stubGlobal(
			'fetch',
			makeFetch([
				{ ok: true, body: searchBody },
				{ ok: true, body: infoBody }
			])
		);

		await fetchPopularity(db, 'spotify:track:abc', 'Space Oddity', 'David Bowie');

		const row = db
			.prepare(`SELECT * FROM song_popularity WHERE spotify_uri = ?`)
			.get('spotify:track:abc') as {
			spotify_uri: string;
			listeners: number;
			playcount: number;
			artist: string;
			title: string;
		} | undefined;

		expect(row).toBeDefined();
		expect(row?.listeners).toBe(500000);
		expect(row?.playcount).toBe(2000000);
		expect(row?.artist).toBe('David Bowie');
		expect(row?.title).toBe('Space Oddity');
	});

	it('updates an existing row without clobbering popularity_proxy', async () => {
		const db = freshDb();
		// Seed a row with an existing popularity_proxy
		db.prepare(
			`INSERT INTO song_popularity (spotify_uri, artist, title, listeners, playcount, popularity_proxy, fetched_at)
			 VALUES ('spotify:track:abc', 'David Bowie', 'Space Oddity', 100, 400, 72, '2020-01-01T00:00:00Z')`
		).run();

		const searchBody = {
			results: { trackmatches: { track: [{ name: 'Space Oddity', artist: 'David Bowie', listeners: '999' }] } }
		};
		const infoBody = { track: { listeners: '600000', playcount: '2500000' } };

		vi.stubGlobal(
			'fetch',
			makeFetch([
				{ ok: true, body: searchBody },
				{ ok: true, body: infoBody }
			])
		);

		await fetchPopularity(db, 'spotify:track:abc', 'Space Oddity', 'David Bowie');

		const row = db
			.prepare(`SELECT * FROM song_popularity WHERE spotify_uri = ?`)
			.get('spotify:track:abc') as {
			listeners: number;
			playcount: number;
			popularity_proxy: number;
		} | undefined;

		expect(row?.listeners).toBe(600000);
		expect(row?.playcount).toBe(2500000);
		// popularity_proxy was NOT reset by our UPDATE
		expect(row?.popularity_proxy).toBe(72);
	});

	it('throws when Last.fm returns an error', async () => {
		const db = freshDb();
		const searchBody = { results: { trackmatches: { track: [] } } };
		const infoBody = { error: 6, message: 'Track not found' };

		vi.stubGlobal(
			'fetch',
			makeFetch([
				{ ok: true, body: searchBody },
				{ ok: true, body: infoBody }
			])
		);

		await expect(
			fetchPopularity(db, 'spotify:track:xyz', 'Unknown', 'Nobody')
		).rejects.toThrow('Track not found');
	});
});

// ---------------------------------------------------------------------------
// fetchTags
// ---------------------------------------------------------------------------

describe('fetchTags', () => {
	let originalFetch: typeof fetch;
	let originalEnv: string | undefined;

	beforeEach(() => {
		originalFetch = global.fetch;
		originalEnv = process.env.LASTFM_API_KEY;
		process.env.LASTFM_API_KEY = 'test-key';
	});
	afterEach(() => {
		global.fetch = originalFetch;
		if (originalEnv === undefined) delete process.env.LASTFM_API_KEY;
		else process.env.LASTFM_API_KEY = originalEnv;
		vi.restoreAllMocks();
	});

	it('throws when LASTFM_API_KEY is not set', async () => {
		delete process.env.LASTFM_API_KEY;
		const db = freshDb();
		await expect(fetchTags(db, 'uri', 'title', 'artist')).rejects.toThrow(
			'LASTFM_API_KEY not set'
		);
	});

	it('stores top-5 tags in song_popularity.tags', async () => {
		const db = freshDb();
		const tagsBody = {
			toptags: {
				tag: [
					{ name: 'pop', count: 100 },
					{ name: 'indie', count: 80 },
					{ name: 'rock', count: 60 },
					{ name: 'electronic', count: 40 },
					{ name: 'alternative', count: 20 },
					{ name: 'should-be-excluded', count: 5 }
				]
			}
		};

		vi.stubGlobal('fetch', makeFetch([{ ok: true, body: tagsBody }]));

		await fetchTags(db, 'spotify:track:abc', 'Some Song', 'Some Artist');

		const row = db
			.prepare(`SELECT tags FROM song_popularity WHERE spotify_uri = ?`)
			.get('spotify:track:abc') as { tags: string } | undefined;

		expect(row).toBeDefined();
		const tags = JSON.parse(row!.tags) as string[];
		expect(tags).toEqual(['pop', 'indie', 'rock', 'electronic', 'alternative']);
		expect(tags).toHaveLength(5);
		expect(tags).not.toContain('should-be-excluded');
	});

	it('stores empty array when no tags returned', async () => {
		const db = freshDb();
		const tagsBody = { toptags: { tag: [] } };

		vi.stubGlobal('fetch', makeFetch([{ ok: true, body: tagsBody }]));

		await fetchTags(db, 'spotify:track:empty', 'Obscure Song', 'Obscure Artist');

		const row = db
			.prepare(`SELECT tags FROM song_popularity WHERE spotify_uri = ?`)
			.get('spotify:track:empty') as { tags: string } | undefined;

		expect(row).toBeDefined();
		expect(JSON.parse(row!.tags)).toEqual([]);
	});

	it('creates the song_popularity row if it does not exist yet', async () => {
		const db = freshDb();
		// Confirm no pre-existing row
		const before = db
			.prepare(`SELECT * FROM song_popularity WHERE spotify_uri = ?`)
			.get('spotify:track:new');
		expect(before).toBeUndefined();

		const tagsBody = { toptags: { tag: [{ name: 'jazz', count: 50 }] } };
		vi.stubGlobal('fetch', makeFetch([{ ok: true, body: tagsBody }]));

		await fetchTags(db, 'spotify:track:new', 'New Song', 'New Artist');

		const row = db
			.prepare(`SELECT tags, artist, title FROM song_popularity WHERE spotify_uri = ?`)
			.get('spotify:track:new') as { tags: string; artist: string; title: string } | undefined;

		expect(row).toBeDefined();
		expect(JSON.parse(row!.tags)).toEqual(['jazz']);
		expect(row!.artist).toBe('New Artist');
		expect(row!.title).toBe('New Song');
	});

	it('throws on HTTP error (not 200)', async () => {
		const db = freshDb();
		vi.stubGlobal('fetch', makeFetch([{ ok: false, status: 503, body: {} }]));

		await expect(fetchTags(db, 'spotify:track:abc', 'title', 'artist')).rejects.toThrow(
			'HTTP 503'
		);
	});

	it('throws when Last.fm returns an API-level error', async () => {
		const db = freshDb();
		const errorBody = { error: 6, message: 'Track not found' };
		vi.stubGlobal('fetch', makeFetch([{ ok: true, body: errorBody }]));

		await expect(fetchTags(db, 'spotify:track:abc', 'title', 'artist')).rejects.toThrow(
			'Track not found'
		);
	});

	it('overwrites existing tags on a second call', async () => {
		const db = freshDb();
		// Seed an initial tags value
		db.prepare(
			`INSERT INTO song_popularity (spotify_uri, artist, title, tags, fetched_at)
			 VALUES ('spotify:track:abc', 'Artist', 'Title', '["old"]', '2020-01-01T00:00:00Z')`
		).run();

		const tagsBody = { toptags: { tag: [{ name: 'new-tag', count: 100 }] } };
		vi.stubGlobal('fetch', makeFetch([{ ok: true, body: tagsBody }]));

		await fetchTags(db, 'spotify:track:abc', 'Title', 'Artist');

		const row = db
			.prepare(`SELECT tags FROM song_popularity WHERE spotify_uri = ?`)
			.get('spotify:track:abc') as { tags: string } | undefined;

		expect(JSON.parse(row!.tags)).toEqual(['new-tag']);
	});
});
