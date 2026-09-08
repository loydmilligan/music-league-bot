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
import { bandForScore } from './videoConfig.mjs';

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
 * Does this channel plausibly belong to the artist? Covers the artist's own
 * channel and the VEVO/label/Topic variants ("LeonBridgesVEVO",
 * "PixiesOfficial"), all of which drop the spaces.
 */
export function channelMatchesArtist(channel, artists) {
	const primary = (artists ?? '').split(',')[0].trim().toLowerCase();
	if (!primary || !channel) return false;
	const c = squash(channel);
	const a = squash(primary);
	return a.length >= 3 && (c.includes(a) || channel.toLowerCase().includes(primary));
}

/**
 * A lyric video: the right song by the right artist, but not the video. Worth
 * demoting out of auto-accept, not worth burying.
 */
const LYRIC_RE = /\blyrics?\b/i;

/**
 * Not this song's music video at all — somebody else performing it, or talking
 * over it. Matched on annotative phrasings ("cover by", "(cover)") rather than
 * a bare /cover/, so a song actually called "Cover Me" is not punished for its
 * own title.
 */
const NOT_THE_VIDEO_RE =
	/\b(?:reaction|reacts|reacting|commentary|explained|breakdown|karaoke|instrumental|tribute|8d\s*audio|sped\s*up|slowed(?:\s*\+?\s*reverb)?)\b|\bcover(?:ed)?\s+by\b|\(\s*cover\s*\)|\bcover\s+version\b|\b(?:acoustic|piano|guitar|metal|punk)\s+cover\b/i;

/**
 * Confidence 0-100 that a search result really is this track's music video.
 *
 * Deliberately a small, legible sum rather than a black box, because the number
 * is user-facing: it is compared against the round's thresholds and printed on
 * the review page, so a human has to be able to see why a pick scored what it
 * did.
 *
 *   +45  the channel is the artist's (incl. the VEVO/Official variants). The
 *        single strongest signal, and on its own not quite enough to auto-accept
 *        at the recommended 70.
 *   +25  the title says "official video" / "official music video". Note this
 *        does NOT fire on "Official Lyric Video" — the words are not adjacent.
 *   +20  the title actually contains the track name — catches the case where
 *        search drifted to a different song on the right artist's channel.
 *   +10/+5 for the first and second result; rank is weak evidence, so it only
 *        ever breaks ties.
 *   -25  a lyric video. Enough to keep it out of auto-accept — it is the right
 *        song but the wrong artefact, so it belongs in the review band — while
 *        leaving it comfortably ahead of a cover or a reaction video, which is
 *        what you want offered first when the real video cannot be found.
 *   -40  a cover, karaoke, reaction or commentary. Actively the wrong video,
 *        and large enough that no combination of the bonuses rescues it into
 *        auto-accept.
 *
 * Worked examples from the real SB R141 run: an artist-channel upload titled
 * "… (Official Video)" scores 100; the same channel's "(Official Lyric Video)"
 * scores 50, ahead of the Wellermen's cover of "Barrett's Privateers" at 0.
 */
export function scoreSearchHit(hit, track, rank = 0) {
	if (!hit) return 0;
	const title = hit.title ?? '';
	let score = 0;
	if (channelMatchesArtist(hit.channel, track.artists)) score += 45;
	if (/official\s*(music\s*)?video/i.test(title)) score += 25;
	const t = squash(track.title);
	if (t.length >= 3 && squash(title).includes(t)) score += 20;
	score += rank === 0 ? 10 : rank === 1 ? 5 : 0;
	if (LYRIC_RE.test(title)) score -= 25;
	if (NOT_THE_VIDEO_RE.test(title)) score -= 40;
	// Clamped at both ends: a negative score would sort below "nothing found"
	// and read as nonsense next to a percentage sign.
	return Math.max(0, Math.min(100, score));
}

/**
 * Search for a track's music video and return the plausible candidates, best
 * first, each with its score.
 *
 * Returns a LIST rather than a winner because the review UI offers alternatives
 * for anything it isn't sure about: search's second result is often the right
 * one when the first is a cover, and re-running the search later to find that
 * out would cost another 100 quota units per song.
 *
 * Deliberately NOT the audio-first search resolveVideo() in run.mjs uses: that
 * one prefers "- Topic" channels, which are auto-generated audio uploads with a
 * still image — the exact opposite of what a music-video playlist wants.
 */
async function searchVideoCandidates(ytSearch, track, limit = 3) {
	const items = await ytSearch(`${track.title} ${track.artists} official music video`);
	if (!items?.length) return [];
	const notTopic = items.filter((i) => !/ - Topic$/.test(i.channel ?? ''));
	const pool = notTopic.length ? notTopic : items;
	return pool
		.map((it, i) => ({ videoId: it.videoId, title: it.title ?? '', channel: it.channel ?? '', score: scoreSearchHit(it, track, i) }))
		.sort((a, b) => b.score - a.score)
		.slice(0, limit);
}

/**
 * Resolve the video candidates for each submission, under the round's config.
 *
 * Returns one entry per submission, in submission order. Nothing is discarded:
 * a song search got wrong still comes back with its candidates so the review
 * page can offer them, and a song with no candidates at all comes back empty
 * rather than vanishing.
 *
 *   source      'comment' | 'search' | null
 *   candidates  [{ videoId, title, channel, score }], best first
 *   chosen      videoIds currently selected (a list; [] = none)
 *   band        'certain' | 'auto' | 'review' | 'suggestion' (see videoConfig)
 *   included    whether it goes in the playlist as things stand
 *   decided     false only for 'review', which blocks approval until answered
 */
export async function resolveVideoPicks(submissions, ytSearch, opts = {}) {
	const pacingMs = opts.pacingMs ?? 1500;
	const useComments = opts.useComments !== false;
	const useSearch = opts.useSearch !== false;
	const cfg = {
		searchAutoAcceptPct: opts.autoAcceptPct ?? 70,
		hilPct: Math.min(opts.hilPct ?? 40, opts.autoAcceptPct ?? 70),
	};
	const picks = [];
	let searched = 0;
	for (const sub of submissions) {
		const fromComment = useComments ? (extractVideoIds(sub.comment)[0] ?? null) : null;
		if (fromComment) {
			// The submitter's own link. Not scored and not thresholded — they
			// chose it, and second-guessing that is not the fallback's job.
			picks.push({
				...sub, source: 'comment', score: 100, band: 'certain',
				candidates: [{ videoId: fromComment, title: sub.title, channel: null, score: 100 }],
				chosen: [fromComment], included: true, decided: true, reason: null,
			});
			continue;
		}
		if (!useSearch) {
			picks.push({
				...sub, source: null, score: 0, band: 'suggestion', candidates: [],
				chosen: [], included: false, decided: true,
				reason: useComments ? 'no link in comment, and search is off for this round' : 'no video source enabled',
			});
			continue;
		}
		// Pace the searches for the same reason run.mjs does: ten unpaced
		// search.list calls got the whole account 429'd for hours on 2026-09-06.
		if (searched++ > 0) await new Promise((r) => setTimeout(r, pacingMs));
		let candidates = [];
		try {
			candidates = await searchVideoCandidates(ytSearch, sub, opts.candidateLimit ?? 3);
		} catch (e) {
			picks.push({
				...sub, source: null, score: 0, band: 'suggestion', candidates: [],
				chosen: [], included: false, decided: true,
				reason: `search failed: ${e.message?.slice(0, 100)}`, error: e.message?.slice(0, 120),
			});
			continue;
		}
		if (!candidates.length) {
			picks.push({
				...sub, source: null, score: 0, band: 'suggestion', candidates: [],
				chosen: [], included: false, decided: true, reason: 'search found nothing',
			});
			continue;
		}
		const best = candidates[0];
		const band = bandForScore(best.score, cfg);
		picks.push({
			...sub, source: 'search', score: best.score, band, candidates,
			// A 'suggestion' starts with nothing selected, so an unattended
			// approval can never quietly ship a long shot; 'review' preselects
			// the best candidate but is not counted as decided. A list, because
			// a song can end up carrying more than one video.
			chosen: band === 'suggestion' ? [] : [best.videoId],
			included: band === 'auto',
			decided: band !== 'review',
			reason: band === 'auto' ? null : `scored ${best.score}`,
		});
	}
	return picks;
}

/** Picks that must be answered before the playlist can be approved. */
export function undecidedPicks(picks) {
	return (picks ?? []).filter((p) => p.band === 'review' && !p.decided);
}
