/**
 * ui/src/lib/lrclib.ts — LRCLIB lyrics handler for the song metadata queue.
 *
 * LRCLIB is a public API (no key needed) that returns synced and plain lyrics
 * for a given artist + track. We do NOT store the raw text (it would balloon the
 * DB), but we DO derive a few cheap metrics from it before discarding it:
 *   - has_lyrics : 1 if any lyrics exist, else 0 (instrumental / not found)
 *   - word_count : total words (drives the "wordiness" / lyrical-density axis)
 *   - line_count : non-empty lines
 * Wordiness as words-per-second is computed at read time from word_count and the
 * audio duration, so storage stays minimal.
 *
 * Task 2 (sprint-queue): implements fetchLyrics() called by the queue worker
 * for job_type='lyrics'.
 */

import type Database from 'better-sqlite3';

const LRCLIB_ROOT = 'https://lrclib.net/api/get';

// ---------------------------------------------------------------------------
// Lyric metrics (pure — no I/O, unit-tested directly)
// ---------------------------------------------------------------------------

export interface LyricMetrics {
	hasLyrics: 0 | 1;
	wordCount: number;
	lineCount: number;
}

/** Remove LRC tags: timestamps like `[00:12.34]` and metadata like `[ar:Name]`. */
function stripLrcTags(text: string): string {
	return text.replace(/\[[^\]]*\]/g, ' ');
}

/**
 * Derive lyric metrics from an LRCLIB response. Prefers plainLyrics; falls back
 * to syncedLyrics with its timestamp tags stripped. A token counts as a word
 * only if it contains a letter or digit (so stray punctuation isn't counted).
 */
export function lyricMetrics(
	synced?: string | null,
	plain?: string | null
): LyricMetrics {
	const hasPlain = typeof plain === 'string' && plain.trim().length > 0;
	const source = hasPlain ? (plain as string) : typeof synced === 'string' ? synced : '';
	const text = stripLrcTags(source);

	const wordCount = text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
	const lineCount = source
		.split(/\r?\n/)
		.map((l) => stripLrcTags(l).trim())
		.filter((l) => l.length > 0).length;

	return { hasLyrics: wordCount > 0 ? 1 : 0, wordCount, lineCount };
}

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
	let metrics: LyricMetrics = { hasLyrics: 0, wordCount: 0, lineCount: 0 };
	if (res.ok) {
		const data = (await res.json()) as {
			syncedLyrics?: string | null;
			plainLyrics?: string | null;
		};
		metrics = lyricMetrics(data.syncedLyrics, data.plainLyrics);
	} else if (res.status === 404) {
		metrics = { hasLyrics: 0, wordCount: 0, lineCount: 0 };
	} else {
		throw new Error(`LRCLIB fetch HTTP ${res.status}`);
	}

	const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

	db.prepare(
		`INSERT OR REPLACE INTO song_lyrics_metrics
		 (spotify_uri, has_lyrics, word_count, line_count, fetched_at)
		 VALUES (?, ?, ?, ?, ?)`
	).run(spotifyUri, metrics.hasLyrics, metrics.wordCount, metrics.lineCount, now);
}
