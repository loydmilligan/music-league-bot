/**
 * ytm-drop/videos — resolve the music video for each submission in a round.
 *
 * Built for Second Best R143 "I Want My MTV", where the theme is the video and
 * the submitter puts the link in their submission comment. Two sources, in
 * order of trust:
 *
 *   1. `comment` — a YouTube link the submitter chose themselves. This is the
 *      real answer and is never overridden.
 *   2. `search`  — for submissions with no link, the top YouTube result for
 *      "<title> <artist> official video". A guess, and labelled as one in the
 *      manifest so a human can veto it before anything ships.
 *
 * Comments are only readable while the ballot is open (voting phase) and only
 * for comments the submitter marked visible to voters; scripts/ml-vote-comments.py
 * is the fetcher. See that script's SAFETY block — the ballot is GET-only.
 */
import { execFileSync } from 'node:child_process';

/** Every YouTube video id in a blob of text, in order, de-duplicated. */
export function extractVideoIds(text) {
	if (!text) return [];
	const patterns = [
		/(?:youtube\.com|youtube-nocookie\.com)\/watch\?(?:[^\s]*&)?v=([A-Za-z0-9_-]{11})/gi,
		/youtu\.be\/([A-Za-z0-9_-]{11})/gi,
		/youtube\.com\/(?:shorts|embed|v|live)\/([A-Za-z0-9_-]{11})/gi,
	];
	// Collected by position, not pattern-by-pattern: the caller takes [0] as
	// "the link the submitter meant", so a comment that opens with a youtu.be
	// short link must not be outranked by a watch?v= link further down.
	const found = [];
	for (const re of patterns) {
		for (const m of text.matchAll(re)) found.push({ at: m.index, id: m[1] });
	}
	found.sort((a, b) => a.at - b.at);
	const out = [];
	for (const f of found) if (!out.includes(f.id)) out.push(f.id);
	return out;
}

/**
 * Pull the open ballot for a round and merge its visible comments into
 * ml_submissions. Best-effort by design: a failed scrape returns a reason and
 * leaves the column alone, exactly as lib/guessing/commentFetch.ts does, so the
 * songs playlist still ships. Never widens a comment to null.
 */
export function fetchBallotComments(db, round, opts = {}) {
	const python = opts.python ?? process.env.ML_CLI_PYTHON ?? `${process.env.HOME}/Projects/ttstt/venv/bin/python3`;
	if (!round.mlRoundId) return { ok: false, error: 'round has no ml_round_id', updated: 0 };
	let payload;
	try {
		const out = execFileSync(python, [opts.script, '--round', round.mlRoundId], {
			encoding: 'utf8',
			timeout: 120_000,
			cwd: opts.cwd,
		});
		payload = JSON.parse(out.trim().split('\n').pop());
	} catch (e) {
		return { ok: false, error: `ballot fetch failed: ${e.message?.slice(0, 160)}`, updated: 0 };
	}
	if (!payload?.ok) return { ok: false, error: payload?.error ?? 'ballot fetch returned not-ok', updated: 0 };

	// COALESCE for the same reason commentFetch.ts uses it: the ballot emits
	// `comment: null` for every song showing no comment, and that is not
	// evidence no comment exists — a hidden-from-voters comment is real in the
	// column and is read with attribution by the digest.
	const write = db.prepare(
		'UPDATE ml_submissions SET comment = COALESCE(?, comment) WHERE round_id = ? AND spotify_uri = ?',
	);
	let updated = 0;
	db.transaction(() => {
		for (const s of payload.songs ?? []) {
			if (s.comment) updated += write.run(s.comment, round.id, s.spotifyUri ?? s.spotify_uri ?? s.uri).changes;
		}
	})();
	return { ok: true, updated, songs: payload.songs?.length ?? 0 };
}

/**
 * One search for an official music video. Deliberately NOT the audio-first
 * search resolveVideo() in run.mjs uses: that one prefers "- Topic" channels,
 * which are auto-generated audio uploads with a still image — the exact
 * opposite of what a music-video playlist wants.
 */
async function searchOfficialVideo(ytSearch, track) {
	const items = await ytSearch(`${track.title} ${track.artists} official music video`);
	if (!items?.length) return null;
	const notTopic = items.filter((i) => !/ - Topic$/.test(i.channel ?? ''));
	const pool = notTopic.length ? notTopic : items;
	// Prefer the artist's or label's own channel, then anything titled "official".
	return (
		pool.find((i) => channelMatchesArtist(i.channel, track.artists)) ??
		pool.find((i) => /official/i.test(i.title ?? '')) ??
		pool[0]
	);
}

/**
 * Does this channel plausibly belong to the artist? Covers the artist's own
 * channel and the VEVO/label variants ("LeonBridgesVEVO", "PixiesOfficial"),
 * both of which drop the spaces.
 */
export function channelMatchesArtist(channel, artists) {
	const primary = (artists ?? '').split(',')[0].trim().toLowerCase();
	if (!primary || !channel) return false;
	const squash = (x) => x.toLowerCase().replace(/[^a-z0-9]+/g, '');
	const c = squash(channel);
	const a = squash(primary);
	return a.length >= 3 && (c.includes(a) || channel.toLowerCase().includes(primary));
}

/**
 * Resolve one pick per submission. Returns a manifest in submission order:
 * { title, artists, videoId, source: 'comment' | 'search' | null, channel }.
 * A null videoId is a hole, reported rather than silently dropped.
 */
export async function resolveVideoPicks(submissions, ytSearch, opts = {}) {
	const pacingMs = opts.pacingMs ?? 1500;
	const picks = [];
	let searched = 0;
	for (const sub of submissions) {
		const fromComment = extractVideoIds(sub.comment)[0] ?? null;
		if (fromComment) {
			picks.push({ ...sub, videoId: fromComment, source: 'comment', channel: null, confidence: 'certain' });
			continue;
		}
		// Pace the searches for the same reason run.mjs does: ten unpaced
		// search.list calls got the whole account 429'd for hours on 2026-09-06.
		if (searched++ > 0) await new Promise((r) => setTimeout(r, pacingMs));
		let hit = null;
		try {
			hit = await searchOfficialVideo(ytSearch, sub);
		} catch (e) {
			picks.push({ ...sub, videoId: null, source: null, channel: null, error: e.message?.slice(0, 120) });
			continue;
		}
		picks.push({
			...sub,
			videoId: hit?.videoId ?? null,
			source: hit ? 'search' : null,
			channel: hit?.channel ?? null,
			searchTitle: hit?.title ?? null,
			// A search hit on a channel with no relation to the artist is usually
			// a fan upload, a cover, or an unrelated video that merely shares
			// words with the title — plenty of these songs simply have no music
			// video. Flagged, not dropped, so the approval step can see it.
			confidence: !hit ? null : channelMatchesArtist(hit.channel, sub.artists) ? 'likely' : 'weak',
		});
	}
	return picks;
}
