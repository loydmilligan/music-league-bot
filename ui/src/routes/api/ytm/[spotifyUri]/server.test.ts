import { it, expect, vi, beforeEach } from 'vitest';
import { openLeagueDb } from '$lib/db/client.js';

// In-memory DB shared with the handler under test.
const db = openLeagueDb(':memory:');

vi.mock('$lib/db/client.js', async (orig) => {
	const actual = await orig<typeof import('$lib/db/client.js')>();
	return { ...actual, getDb: () => db };
});

// Mock the Songlink wrapper so we don't hit the network — this isolates the
// endpoint's own logic (cache miss -> resolve -> persist -> return) from the
// external Odesli API (which currently gates YouTube links; see sprint-13 B1).
const resolveYtmLink = vi.fn();
vi.mock('$lib/songlink.js', () => ({ resolveYtmLink: (...a: unknown[]) => resolveYtmLink(...a) }));

// No-op the shared rate limiter — its throttling is its own concern (and would
// otherwise add a real 6s inter-call wait between these miss-path tests).
vi.mock('$lib/songlinkLimiter.js', () => ({ songlinkLimiter: { acquire: async () => {} } }));

let GET: typeof import('./+server.js').GET;
beforeEach(async () => {
	db.prepare('DELETE FROM ytm_link_cache').run();
	resolveYtmLink.mockReset();
	({ GET } = await import('./+server.js'));
});

function evt(uri: string, search = '') {
	return {
		params: { spotifyUri: encodeURIComponent(uri) },
		url: new URL(`http://x/api/ytm/${encodeURIComponent(uri)}${search}`),
	} as unknown as Parameters<typeof GET>[0];
}

it('cache miss resolves, persists, and returns a populated ytmUrl', async () => {
	resolveYtmLink.mockResolvedValue('https://music.youtube.com/watch?v=ABC');
	const res = await GET(evt('spotify:track:fresh'));
	expect(await res.json()).toEqual({ ytmUrl: 'https://music.youtube.com/watch?v=ABC' });
	const row = db
		.prepare('SELECT ytm_url FROM ytm_link_cache WHERE spotify_uri=?')
		.get('spotify:track:fresh') as { ytm_url: string };
	expect(row.ytm_url).toBe('https://music.youtube.com/watch?v=ABC');
});

it('cache hit returns without calling the resolver', async () => {
	db.prepare('INSERT INTO ytm_link_cache (spotify_uri, ytm_url, resolved_at) VALUES (?,?,?)').run(
		'spotify:track:hit',
		'https://music.youtube.com/watch?v=HIT',
		'2026-06-02T00:00:00Z',
	);
	const res = await GET(evt('spotify:track:hit'));
	expect(await res.json()).toEqual({ ytmUrl: 'https://music.youtube.com/watch?v=HIT' });
	expect(resolveYtmLink).not.toHaveBeenCalled();
});

it('persists a no-match (null) so it is cached', async () => {
	resolveYtmLink.mockResolvedValue(null);
	const res = await GET(evt('spotify:track:none'));
	expect(await res.json()).toEqual({ ytmUrl: null });
	const row = db
		.prepare('SELECT spotify_uri, ytm_url FROM ytm_link_cache WHERE spotify_uri=?')
		.get('spotify:track:none') as { spotify_uri: string; ytm_url: string | null };
	expect(row).toBeTruthy();
	expect(row.ytm_url).toBeNull();
});
