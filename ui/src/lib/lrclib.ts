/**
 * ui/src/lib/lrclib.ts — LRCLIB lyrics presence handler for the song metadata queue.
 *
 * LRCLIB is a public API (no key needed) that returns synced and plain lyrics
 * for a given artist + track. We store a binary has_lyrics flag in
 * song_lyrics_metrics rather than the raw text — lyrics length is not a blocker
 * for digest quality and raw storage would balloon the DB.
 *
 * Task 2 (sprint-queue): implements fetchLyrics() called by the queue worker
 * for job_type='lyrics'.
 */

import type Database from 'better-sqlite3';

const LRCLIB_ROOT = 'https://lrclib.net/api/get';

// ---------------------------------------------------------------------------
// Queue handler: fetchLyrics
// ---------------------------------------------------------------------------

/**
 * Fetch lyrics presence from LRCLIB and upsert into song_lyrics_metrics.
 * Called by the queue worker for job_type='lyrics'.
 *
 * Sets has_lyrics = 1 if either syncedLyrics or plainLyrics is non-empty,
 * else has_lyrics = 0 (song not found or instrumentals).
 *
 * Throws on HTTP errors so the worker can handle retries.
 * A 404 (song not found) is NOT an error — it stores has_lyrics = 0.
 */
export async function fetchLyrics(
	db: Database.Database,
	spotifyUri: string,
	title: string,
	artist: string
): Promise<void> {
	const params = new URLSearchParams({
		artist_name: artist.trim(),
		track_name: title.trim()
	});

	const res = await fetch(`${LRCLIB_ROOT}?${params}`, {
		headers: { 'Lrclib-Client': 'music-league-bot/1.0 (mattmariani@gmail.com)' }
	});

	// 404 = not found → store has_lyrics = 0 (not an error worth retrying)
	let hasLyrics = 0;
	if (res.ok) {
		const data = (await res.json()) as {
			syncedLyrics?: string | null;
			plainLyrics?: string | null;
		};
		const synced = data.syncedLyrics;
		const plain = data.plainLyrics;
		hasLyrics =
			(typeof synced === 'string' && synced.trim().length > 0) ||
			(typeof plain === 'string' && plain.trim().length > 0)
				? 1
				: 0;
	} else if (res.status === 404) {
		hasLyrics = 0;
	} else {
		throw new Error(`LRCLIB fetch HTTP ${res.status}`);
	}

	const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

	db.prepare(
		`INSERT OR REPLACE INTO song_lyrics_metrics (spotify_uri, has_lyrics, fetched_at)
		 VALUES (?, ?, ?)`
	).run(spotifyUri, hasLyrics, now);
}
