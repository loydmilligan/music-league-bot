import type { CommentPayload, FetchedSong } from './commentFetch.js';

/**
 * Convert the raw JSON emitted by scripts/ml-vote-comments.py into the shape
 * applyComments() expects (spec §7.2).
 *
 * The producer is Python and emits snake_case (`spotify_uri`, `is_mine`); the
 * consumer is TypeScript and expects camelCase (`spotifyUri`). Nothing bridged
 * the two until scripts/ml-comment-sync.mjs, and that mismatch is exactly the
 * kind that fails SILENTLY: a payload whose `spotifyUri` is undefined matches
 * no row, so every song lands in `unmatched` and zero comments are written
 * while the run still looks like it "worked". Hence this conversion is a named,
 * tested function rather than an inline `.map()` in the host script.
 *
 * Rules:
 *  * A failed fetch (`ok: false`, or an unusable payload) is passed through as
 *    `{ ok: false, error }` — applyComments records it on `comments_error` and
 *    the sitting proceeds without comments. A failed scrape must never throw.
 *  * A song with no usable `spotify_uri` fails the WHOLE payload rather than
 *    being skipped. Skipping would hide a producer-side markup change behind a
 *    partially applied write; failing records the reason and changes nothing.
 *  * An empty-string comment is normalised to null so it can never overwrite a
 *    real (possibly submitter-hidden) comment through applyComments' COALESCE.
 *    The producer already emits null for "no visible comment on the ballot".
 */
export function toCommentPayload(raw: unknown): CommentPayload {
	if (raw === null || typeof raw !== 'object') {
		return { ok: false, error: `fetcher returned a non-object payload (${typeof raw})` };
	}
	const obj = raw as Record<string, unknown>;

	if (obj.ok !== true) {
		const err = typeof obj.error === 'string' && obj.error.trim() ? obj.error : 'comment fetch failed';
		return { ok: false, error: err };
	}

	if (!Array.isArray(obj.songs)) {
		return { ok: false, error: 'fetcher reported ok but sent no songs array' };
	}

	const songs: FetchedSong[] = [];
	let missingUris = 0;
	for (const entry of obj.songs as unknown[]) {
		const s = (entry ?? {}) as Record<string, unknown>;
		const uri = typeof s.spotify_uri === 'string' ? s.spotify_uri.trim() : '';
		if (!uri) {
			missingUris += 1;
			continue;
		}
		const comment = typeof s.comment === 'string' && s.comment !== '' ? s.comment : null;
		songs.push({ spotifyUri: uri, comment });
	}

	if (missingUris > 0) {
		return {
			ok: false,
			error: `${missingUris} of ${(obj.songs as unknown[]).length} songs had no spotify_uri — the fetcher's output shape has changed`
		};
	}

	return { ok: true, songs };
}

/** Count of songs carrying a comment — for the host script's summary line. */
export function countComments(songs: FetchedSong[]): number {
	return songs.filter((s) => s.comment != null).length;
}
