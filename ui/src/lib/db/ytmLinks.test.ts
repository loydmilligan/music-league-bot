import { it, expect, describe } from 'vitest';
import { openLeagueDb } from './client.js';
import { spotifyUriToUrl, attachYtmLinks } from './ytmLinks.js';

describe('spotifyUriToUrl', () => {
	it('converts a track uri to an open.spotify.com url', () => {
		expect(spotifyUriToUrl('spotify:track:abc123')).toBe('https://open.spotify.com/track/abc123');
	});
	it('returns null for empty/nullish', () => {
		expect(spotifyUriToUrl(null)).toBeNull();
		expect(spotifyUriToUrl(undefined)).toBeNull();
		expect(spotifyUriToUrl('')).toBeNull();
	});
	it('passes through an existing http url', () => {
		expect(spotifyUriToUrl('https://open.spotify.com/track/xyz')).toBe('https://open.spotify.com/track/xyz');
	});
});

describe('attachYtmLinks', () => {
	function seedCache(db: ReturnType<typeof openLeagueDb>, rows: [string, string | null][]) {
		const stmt = db.prepare(
			'INSERT OR REPLACE INTO ytm_link_cache (spotify_uri, ytm_url, resolved_at) VALUES (?,?,?)',
		);
		for (const [uri, ytm] of rows) stmt.run(uri, ytm, '2026-06-02T00:00:00Z');
	}

	it('adds spotifyUrl + cached ytmUrl, mirroring a LEFT JOIN', () => {
		const db = openLeagueDb(':memory:');
		seedCache(db, [['spotify:track:cached', 'https://music.youtube.com/watch?v=YES']]);
		const out = attachYtmLinks(db, [
			{ spotifyUri: 'spotify:track:cached', title: 'A' },
			{ spotifyUri: 'spotify:track:uncached', title: 'B' },
		]);
		expect(out[0]).toMatchObject({
			title: 'A',
			spotifyUrl: 'https://open.spotify.com/track/cached',
			ytmUrl: 'https://music.youtube.com/watch?v=YES',
		});
		// uncached -> ytmUrl null, spotifyUrl still derived
		expect(out[1]).toMatchObject({
			spotifyUrl: 'https://open.spotify.com/track/uncached',
			ytmUrl: null,
		});
	});

	it('surfaces a cached no-match (ytm_url NULL) as ytmUrl null', () => {
		const db = openLeagueDb(':memory:');
		seedCache(db, [['spotify:track:nomatch', null]]);
		const out = attachYtmLinks(db, [{ spotifyUri: 'spotify:track:nomatch' }]);
		expect(out[0].ytmUrl).toBeNull();
		expect(out[0].spotifyUrl).toBe('https://open.spotify.com/track/nomatch');
	});

	it('handles a song with no spotifyUri', () => {
		const db = openLeagueDb(':memory:');
		const out = attachYtmLinks(db, [{ spotifyUri: null, title: 'no-uri' }]);
		expect(out[0]).toMatchObject({ spotifyUrl: null, ytmUrl: null, title: 'no-uri' });
	});
});
