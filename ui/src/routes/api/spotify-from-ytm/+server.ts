import type { RequestHandler } from './$types.js';
import { json, redirect, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { resolveSpotifyFromYtm } from '$lib/songlink.js';
import { songlinkLimiter } from '$lib/songlinkLimiter.js';
import { spotifyUriToUrl } from '$lib/db/ytmLinks.js';

// Reverse resolve: YouTube Music URL -> Spotify URL. For songs ingested via the
// extension that only carry a `ytm_url`. Mirrors the forward `/api/ytm/[uri]`
// endpoint: cache hit (reverse lookup on ytm_link_cache.ytm_url) returns
// immediately; a miss resolves synchronously via the existing Songlink wrapper,
// throttled through the shared songlinkLimiter, then persists the discovered
// pairing into ytm_link_cache (which doubles as the forward cache).
//
//   GET /api/spotify-from-ytm?url=<encoded music.youtube.com url>[&redirect=1]
//   -> { spotifyUrl: string | null, error?: string }
function spotifyUrlToUri(url: string | undefined): string | undefined {
	const m = url?.match(/open\.spotify\.com\/track\/([A-Za-z0-9]+)/);
	return m ? `spotify:track:${m[1]}` : undefined;
}

export const GET: RequestHandler = async ({ url }) => {
	const ytmUrl = url.searchParams.get('url');
	if (!ytmUrl) throw error(400, 'url query param required (the music.youtube.com URL)');
	const db = getDb();
	const wantRedirect = url.searchParams.get('redirect') === '1';

	// Reverse cache hit: a prior resolution stored this ytm_url against a uri.
	const cached = db
		.prepare('SELECT spotify_uri FROM ytm_link_cache WHERE ytm_url=? LIMIT 1')
		.get(ytmUrl) as { spotify_uri: string } | undefined;
	if (cached) {
		const spotifyUrl = spotifyUriToUrl(cached.spotify_uri);
		if (wantRedirect && spotifyUrl) throw redirect(302, spotifyUrl);
		return json({ spotifyUrl });
	}

	await songlinkLimiter.acquire();
	const res = await resolveSpotifyFromYtm(ytmUrl);
	if ('error' in res) {
		return json({ spotifyUrl: null, error: res.error });
	}
	const spotifyUrl = res.url;
	const uri = spotifyUrlToUri(spotifyUrl);
	if (uri) {
		// Populate the (bidirectional) cache so future forward/reverse lookups hit.
		db.prepare(
			'INSERT OR REPLACE INTO ytm_link_cache (spotify_uri, ytm_url, resolved_at) VALUES (?, ?, ?)',
		).run(uri, ytmUrl, new Date().toISOString());
	}
	if (wantRedirect) throw redirect(302, spotifyUrl);
	return json({ spotifyUrl });
};
