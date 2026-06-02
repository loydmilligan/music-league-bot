import type Database from 'better-sqlite3';

/** Convert a Spotify track URI to its open.spotify.com URL (null if not a track uri). */
export function spotifyUriToUrl(uri: string | null | undefined): string | null {
	if (!uri) return null;
	if (uri.startsWith('spotify:track:')) {
		return `https://open.spotify.com/track/${uri.slice('spotify:track:'.length)}`;
	}
	// Already a URL (extension-ingested rows can carry a full URL) — pass through.
	return uri.startsWith('http') ? uri : null;
}

/**
 * Batch-fetch the cached YTM url for a set of Spotify URIs from `ytm_link_cache`.
 * Returns a map uri -> ytm_url (may be null = cached no-match). URIs absent from
 * the map have never been resolved.
 */
function ytmUrlMap(db: Database.Database, uris: string[]): Map<string, string | null> {
	const map = new Map<string, string | null>();
	const unique = [...new Set(uris.filter(Boolean))];
	const CHUNK = 400; // stay well under SQLite's variable limit
	for (let i = 0; i < unique.length; i += CHUNK) {
		const slice = unique.slice(i, i + CHUNK);
		const placeholders = slice.map(() => '?').join(',');
		const rows = db
			.prepare(`SELECT spotify_uri, ytm_url FROM ytm_link_cache WHERE spotify_uri IN (${placeholders})`)
			.all(...slice) as { spotify_uri: string; ytm_url: string | null }[];
		for (const r of rows) map.set(r.spotify_uri, r.ytm_url);
	}
	return map;
}

/**
 * Enrich song-list payloads with `spotifyUrl` and `ytmUrl` so the UI knows the
 * initial play-button state without a per-row call. Equivalent to the
 * `LEFT JOIN ytm_link_cache` in `headToHead.ts`, but applied at the route layer
 * because the shortlist/chat query helpers live in the frontend's lane.
 *
 * `ytmUrl` is the cached value (string), or null when uncached or a cached
 * no-match. `spotifyUrl` is derived from the song's `spotifyUri`.
 */
export function attachYtmLinks<T extends { spotifyUri?: string | null }>(
	db: Database.Database,
	songs: T[],
): (T & { spotifyUrl: string | null; ytmUrl: string | null })[] {
	const map = ytmUrlMap(
		db,
		songs.map((s) => s.spotifyUri ?? '').filter(Boolean),
	);
	return songs.map((s) => ({
		...s,
		spotifyUrl: spotifyUriToUrl(s.spotifyUri),
		ytmUrl: s.spotifyUri ? (map.get(s.spotifyUri) ?? null) : null,
	}));
}
