import type { RequestHandler } from './$types.js';
import { json, redirect } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { resolveYtmLink } from '$lib/songlink.js';

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
	const ytmUrl = await resolveYtmLink(uri);
	db.prepare(
		'INSERT OR REPLACE INTO ytm_link_cache (spotify_uri, ytm_url, resolved_at) VALUES (?, ?, ?)'
	).run(uri, ytmUrl, new Date().toISOString());
	if (url.searchParams.get('redirect') === '1' && ytmUrl) throw redirect(302, ytmUrl);
	return json({ ytmUrl });
};
