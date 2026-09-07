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

const squash = (x) => String(x ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * Confidence 0-100 that a search result really is this track's music video.
 *
 * Deliberately a small, legible sum rather than a black box, because the number
 * is user-facing: it is compared against the round's auto-accept threshold and
 * printed in the approval report, so a human has to be able to see why a pick
 * scored what it did.
 *
 *   +45  the channel is the artist's (incl. the VEVO/Official variants). The
 *        single strongest signal, and on its own not quite enough to auto-accept
 *        at the recommended 70.
 *   +25  the title says "official video" / "official music video".
 *   +20  the title actually contains the track name — catches the case where
 *        search drifted to a different song on the right artist's channel.
 *   +10/+5 for the first and second result; rank is weak evidence, so it only
 *        ever breaks ties.
 *
 * Worked examples from the real SB R141 run: an artist-channel upload titled
 * "… (Official Video)" scores 100; "Leon Bridges - Smooth Sailin'" on
 * LeonBridgesVEVO scores 75; the Wellermen's cover of "Barrett's Privateers"
 * scores 30, as does a fan upload of "Another New World".
 */
export function scoreSearchHit(hit, track, rank = 0) {
	if (!hit) return 0;
	let score = 0;
	if (channelMatchesArtist(hit.channel, track.artists)) score += 45;
	if (/official\s*(music\s*)?video/i.test(hit.title ?? '')) score += 25;
	const t = squash(track.title);
	if (t.length >= 3 && squash(hit.title).includes(t)) score += 20;
	score += rank === 0 ? 10 : rank === 1 ? 5 : 0;
	return Math.min(100, score);
}

/**
 * One search for an official music video, returning the best-scoring result.
 *
 * Deliberately NOT the audio-first search resolveVideo() in run.mjs uses: that
 * one prefers "- Topic" channels, which are auto-generated audio uploads with a
 * still image — the exact opposite of what a music-video playlist wants.
 */
async function searchOfficialVideo(ytSearch, track) {
	const items = await ytSearch(`${track.title} ${track.artists} official music video`);
	if (!items?.length) return null;
	const notTopic = items.filter((i) => !/ - Topic$/.test(i.channel ?? ''));
	const pool = notTopic.length ? notTopic : items;
	let best = null;
	for (let i = 0; i < pool.length; i++) {
		const score = scoreSearchHit(pool[i], track, i);
		if (!best || score > best.score) best = { ...pool[i], score };
	}
	return best;
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
 * Resolve one pick per submission, under the round's video config.
 *
 * Returns a manifest in submission order. Every submission produces exactly one
 * entry — a pick that was searched and scored below the auto-accept threshold
 * comes back with `accepted: false` rather than vanishing, so the approval
 * report can show what was found and rejected.
 *
 *   source     'comment' | 'search' | null
 *   score      0-100; a submitter's own link is 100 by definition
 *   accepted   whether it belongs in the playlist
 *   reason     why not, when accepted is false
 */
export async function resolveVideoPicks(submissions, ytSearch, opts = {}) {
	const pacingMs = opts.pacingMs ?? 1500;
	const useComments = opts.useComments !== false;
	const useSearch = opts.useSearch !== false;
	const autoAcceptPct = opts.autoAcceptPct ?? 70;
	const picks = [];
	let searched = 0;
	for (const sub of submissions) {
		const fromComment = useComments ? (extractVideoIds(sub.comment)[0] ?? null) : null;
		if (fromComment) {
			// The submitter's own link. Not scored and not thresholded — they
			// chose it, and second-guessing that is not the fallback's job.
			picks.push({ ...sub, videoId: fromComment, source: 'comment', channel: null, score: 100, accepted: true, reason: null });
			continue;
		}
		if (!useSearch) {
			picks.push({ ...sub, videoId: null, source: null, channel: null, score: 0, accepted: false,
				reason: useComments ? 'no link in comment, and search is off for this round' : 'no video source enabled' });
			continue;
		}
		// Pace the searches for the same reason run.mjs does: ten unpaced
		// search.list calls got the whole account 429'd for hours on 2026-09-06.
		if (searched++ > 0) await new Promise((r) => setTimeout(r, pacingMs));
		let hit = null;
		try {
			hit = await searchOfficialVideo(ytSearch, sub);
		} catch (e) {
			picks.push({ ...sub, videoId: null, source: null, channel: null, score: 0, accepted: false,
				reason: `search failed: ${e.message?.slice(0, 100)}`, error: e.message?.slice(0, 120) });
			continue;
		}
		if (!hit) {
			picks.push({ ...sub, videoId: null, source: null, channel: null, score: 0, accepted: false, reason: 'search found nothing' });
			continue;
		}
		const accepted = hit.score >= autoAcceptPct;
		picks.push({
			...sub,
			videoId: hit.videoId,
			source: 'search',
			channel: hit.channel ?? null,
			searchTitle: hit.title ?? null,
			score: hit.score,
			accepted,
			reason: accepted ? null : `scored ${hit.score}, below the ${autoAcceptPct} threshold`,
		});
	}
	return picks;
}
