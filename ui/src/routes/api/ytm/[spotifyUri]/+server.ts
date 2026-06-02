import type { RequestHandler } from './$types.js';
import { json, redirect } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { resolveYtmLink } from '$lib/songlink.js';
import { songlinkLimiter } from '$lib/songlinkLimiter.js';

// Forward resolve: Spotify URI -> YouTube Music URL.
// Cache hit returns immediately (no Songlink call). On a miss we resolve
// synchronously via the existing Songlink wrapper, throttled through the shared
// songlinkLimiter (keeps on-click + queue-worker usage under 10/min), then
// persist the result (incl. null = no match) and return it.
export const GET: RequestHandler = async ({ params, url }) => {
	const db = getDb();
	const uri = decodeURIComponent(params.spotifyUri);
	const cached = db
		.prepare('SELECT ytm_url FROM ytm_link_cache WHERE spotify_uri=?')
		.get(uri) as { ytm_url: string | null } | undefined;
	if (cached) {
		if (url.searchParams.get('redirect') === '1' && cached.ytm_url)
			throw redirect(302, cached.ytm_url);
		return json({ ytmUrl: cached.ytm_url });
	}
	await songlinkLimiter.acquire();
	const ytmUrl = await resolveYtmLink(uri);
	db.prepare(
		'INSERT OR REPLACE INTO ytm_link_cache (spotify_uri, ytm_url, resolved_at) VALUES (?, ?, ?)'
	).run(uri, ytmUrl, new Date().toISOString());
	if (url.searchParams.get('redirect') === '1' && ytmUrl) throw redirect(302, ytmUrl);
	return json({ ytmUrl });
};
