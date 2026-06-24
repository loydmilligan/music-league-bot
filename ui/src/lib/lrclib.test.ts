/**
 * Tests for ui/src/lib/lrclib.ts — LRCLIB lyrics presence handler.
 *
 * HTTP calls are mocked via vi.stubGlobal('fetch', ...) so no real network
 * requests are made. DB uses openLeagueDb(':memory:') for isolation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { openLeagueDb } from './db/client.js';
import type Database from 'better-sqlite3';
import { fetchLyrics } from './lrclib.js';

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
			status: next.status ?? (next.ok ? 200 : 404),
			json: async () => next.body
		} as unknown as Response;
	});
}

// ---------------------------------------------------------------------------
// fetchLyrics
// ---------------------------------------------------------------------------

describe('fetchLyrics', () => {
	let originalFetch: typeof fetch;

	beforeEach(() => {
		originalFetch = global.fetch;
	});
	afterEach(() => {
		global.fetch = originalFetch;
		vi.restoreAllMocks();
	});

	it('stores has_lyrics=1 when syncedLyrics is present', async () => {
		const db = freshDb();
		vi.stubGlobal(
			'fetch',
			makeFetch([
				{
					ok: true,
					body: {
						syncedLyrics: '[00:01.00] Some synced lyric line',
						plainLyrics: null
					}
				}
			])
		);

		await fetchLyrics(db, 'spotify:track:abc', 'Some Song', 'Some Artist');

		const row = db
			.prepare(`SELECT has_lyrics FROM song_lyrics_metrics WHERE spotify_uri = ?`)
			.get('spotify:track:abc') as { has_lyrics: number } | undefined;

		expect(row).toBeDefined();
		expect(row?.has_lyrics).toBe(1);
	});

	it('stores has_lyrics=1 when only plainLyrics is present', async () => {
		const db = freshDb();
		vi.stubGlobal(
			'fetch',
			makeFetch([
				{
					ok: true,
					body: {
						syncedLyrics: null,
						plainLyrics: 'Some plain lyrics text'
					}
				}
			])
		);

		await fetchLyrics(db, 'spotify:track:def', 'Another Song', 'Another Artist');

		const row = db
			.prepare(`SELECT has_lyrics FROM song_lyrics_metrics WHERE spotify_uri = ?`)
			.get('spotify:track:def') as { has_lyrics: number } | undefined;

		expect(row?.has_lyrics).toBe(1);
	});

	it('stores has_lyrics=0 when both fields are null', async () => {
		const db = freshDb();
		vi.stubGlobal(
			'fetch',
			makeFetch([
				{
					ok: true,
					body: { syncedLyrics: null, plainLyrics: null }
				}
			])
		);

		await fetchLyrics(db, 'spotify:track:ghi', 'Instrumental', 'Composer');

		const row = db
			.prepare(`SELECT has_lyrics FROM song_lyrics_metrics WHERE spotify_uri = ?`)
			.get('spotify:track:ghi') as { has_lyrics: number } | undefined;

		expect(row?.has_lyrics).toBe(0);
	});

	it('stores has_lyrics=0 on 404 (not found)', async () => {
		const db = freshDb();
		vi.stubGlobal(
			'fetch',
			makeFetch([{ ok: false, status: 404, body: {} }])
		);

		await fetchLyrics(db, 'spotify:track:missing', 'Rare Song', 'Unknown Artist');

		const row = db
			.prepare(`SELECT has_lyrics FROM song_lyrics_metrics WHERE spotify_uri = ?`)
			.get('spotify:track:missing') as { has_lyrics: number } | undefined;

		expect(row?.has_lyrics).toBe(0);
	});

	it('throws on HTTP 5xx error', async () => {
		const db = freshDb();
		vi.stubGlobal(
			'fetch',
			makeFetch([{ ok: false, status: 503, body: {} }])
		);

		await expect(
			fetchLyrics(db, 'spotify:track:err', 'Error Song', 'Error Artist')
		).rejects.toThrow('LRCLIB fetch HTTP 503');
	});

	it('replaces an existing row (INSERT OR REPLACE)', async () => {
		const db = freshDb();
		// Seed an existing row with has_lyrics=0
		db.prepare(
			`INSERT INTO song_lyrics_metrics (spotify_uri, has_lyrics, fetched_at)
			 VALUES ('spotify:track:abc', 0, '2020-01-01T00:00:00Z')`
		).run();

		vi.stubGlobal(
			'fetch',
			makeFetch([
				{ ok: true, body: { syncedLyrics: 'New lyric', plainLyrics: null } }
			])
		);

		await fetchLyrics(db, 'spotify:track:abc', 'Some Song', 'Some Artist');

		const row = db
			.prepare(`SELECT has_lyrics FROM song_lyrics_metrics WHERE spotify_uri = ?`)
			.get('spotify:track:abc') as { has_lyrics: number } | undefined;

		expect(row?.has_lyrics).toBe(1);
	});

	it('stores has_lyrics=0 when lyrics fields are empty strings', async () => {
		const db = freshDb();
		vi.stubGlobal(
			'fetch',
			makeFetch([
				{ ok: true, body: { syncedLyrics: '', plainLyrics: '   ' } }
			])
		);

		await fetchLyrics(db, 'spotify:track:empty', 'Silent Song', 'Silent Artist');

		const row = db
			.prepare(`SELECT has_lyrics FROM song_lyrics_metrics WHERE spotify_uri = ?`)
			.get('spotify:track:empty') as { has_lyrics: number } | undefined;

		expect(row?.has_lyrics).toBe(0);
	});

	it('sets fetched_at to a recent ISO timestamp', async () => {
		const db = freshDb();
		const before = new Date();

		vi.stubGlobal(
			'fetch',
			makeFetch([{ ok: true, body: { syncedLyrics: 'Lyric', plainLyrics: null } }])
		);

		await fetchLyrics(db, 'spotify:track:ts', 'Time Song', 'Time Artist');

		const row = db
			.prepare(`SELECT fetched_at FROM song_lyrics_metrics WHERE spotify_uri = ?`)
			.get('spotify:track:ts') as { fetched_at: string } | undefined;

		expect(row?.fetched_at).toBeDefined();
		const fetched = new Date(row!.fetched_at);
		expect(fetched.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
	});
});
