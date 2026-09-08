#!/usr/bin/env node
/**
 * ytm-drop — the submission→voting trigger for YouTube Music playlist mirrors.
 *
 * Watches round_events for fresh `voting_started` rows (written by the email
 * poller when Music League's "New Playlist" email lands), then for each
 * unprocessed round: reads the round's Spotify playlist → resolves each track
 * to a YouTube video (search + duration disambiguation) → creates an unlisted
 * playlist on the YOUTUBE_* account → renders the 1b cover → posts cover +
 * link to WhatsApp via the bot's control server.
 *
 *   node scripts/ytm-drop/run.mjs                 # process pending rounds
 *   node scripts/ytm-drop/run.mjs --round 153     # force one round
 *   node scripts/ytm-drop/run.mjs --dry-run       # resolve + cover only
 *   node scripts/ytm-drop/run.mjs --round 141 --videos-only
 *                                                 # re-resolve and re-park the
 *                                                 # video review WITHOUT
 *                                                 # touching the audio playlist
 *
 * Leagues are configured in LEAGUES below; a league not listed is never
 * touched. Each names its own .env key for the WhatsApp target.
 * State lives in ytm_drops (league.db) — one row per round, idempotent.
 * Designed to run from a host timer (see deploy/mlb-ytm-drop.*).
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { extractVideoIds, fetchBallotComments, resolveVideoPicks } from './videos.mjs';
import { readRoundVideoConfig, hasNoVideoSource } from './videoConfig.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(ROOT, 'ui/package.json'));
const Database = require('better-sqlite3');

/**
 * Per-league drop config. A league absent from this list is never processed,
 * including via the manual --round override.
 *
 *   targetEnv — .env key holding the WhatsApp chat id for this league. Boarz
 *               keeps the original YTM_DROP_TARGET key, so the live job that
 *               has been running since 2026-09-06 is behaviourally unchanged.
 * The AUDIO playlist posts on its own, for every configured league. Whether a
 * round ALSO gets a music-video playlist is per-round with a global default
 * (videoConfig.mjs) — and that one never posts unreviewed: its candidates are
 * parked for a human at /ytm/<roundId>/videos and posted only on approval.
 */
const LEAGUES = [
	{ id: 5, slug: 'boarz-ii-men', title: 'Boarz II Men', targetEnv: 'YTM_DROP_TARGET' },
	{ id: 3, slug: 'second-best',  title: 'Second Best',  targetEnv: 'YTM_DROP_TARGET_SECOND_BEST' },
];
// bot-ui owns the review lifecycle (schema, tokens, notifications); this script
// only hands it resolved candidates. host.docker.internal is not usable here —
// this runs ON the host, so the published port is the address.
const UI_BASE = process.env.BOT_UI_URL || 'http://localhost:3002';
const TEST_GROUP = '120363428945055429@g.us';
const BOT_CONTAINER = 'music-league-bot-bot-1';
const WINDOW_DAYS = 7; // never backfill older transitions
const COVER_VARIANT = '1d'; // Matt's pick, 2026-08-29
const SEARCH_PACING_MS = 1500; // gap between per-track search.list calls (burst limiter)

const argvHas = (f) => process.argv.includes(f);
const argvVal = (f) => {
	const i = process.argv.indexOf(f);
	return i >= 0 ? process.argv[i + 1] : undefined;
};
const DRY = argvHas('--dry-run');
// Recovery path for "audio posted but parking the review failed", and the only
// safe way to re-park a round: a bare --round on an already-sent round would
// rebuild and RE-SEND the audio playlist to the group.
const VIDEOS_ONLY = argvHas('--videos-only');
const FORCE_ROUND = argvVal('--round') ? Number(argvVal('--round')) : null;

const env = {};
for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
	const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
	if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
// Resolved per league; an unset key falls back to the TEST group, never to
// another league's group.
const targetFor = (lg) => env[lg.targetEnv]?.trim() || TEST_GROUP;
for (const k of ['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'YOUTUBE_REFRESH_TOKEN', 'SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET']) {
	if (!env[k]) { console.error(`[fatal] missing ${k} in .env`); process.exit(1); }
}

const db = new Database(path.join(ROOT, 'data/league.db'));
db.exec(`CREATE TABLE IF NOT EXISTS ytm_drops (
	round_id        INTEGER PRIMARY KEY REFERENCES rounds(id),
	ytm_playlist_id TEXT,
	ytm_url         TEXT,
	target          TEXT,
	status          TEXT NOT NULL,           -- sent | failed | dry-run
	error           TEXT,
	created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
)`);
// rounds.video_playlist_config is normally created by the UI's migration
// (ui/src/lib/db/client.ts), but this script runs on the host and must not
// depend on bot-ui having been started since the column was added — a missing
// column here would throw for EVERY league, not just a configured one.
const roundCols = new Set(db.prepare('PRAGMA table_info(rounds)').all().map((c) => c.name));
if (!roundCols.has('video_playlist_config')) db.exec('ALTER TABLE rounds ADD COLUMN video_playlist_config TEXT');

// Guarded ALTERs: the table predates the video playlist and the league column.
// video_playlist_id / video_url / video_manifest are SUPERSEDED by
// ytm_video_reviews (bot-ui owns the video side now) — kept, and preserved by
// COALESCE on write, only so the rows written before 2026-09-07 stay readable.
const dropCols = new Set(db.prepare('PRAGMA table_info(ytm_drops)').all().map((c) => c.name));
for (const [col, decl] of [['league_id', 'INTEGER'], ['video_playlist_id', 'TEXT'], ['video_url', 'TEXT'], ['video_manifest', 'TEXT']]) {
	if (!dropCols.has(col)) db.exec(`ALTER TABLE ytm_drops ADD COLUMN ${col} ${decl}`);
}

// ── candidates ────────────────────────────────────────────────────────────────
// BOTH paths stay league-scoped, and every candidate carries the league config
// that produced it: each league posts to its OWN group, so a round must never
// be picked up under another league's config — not even via --round.
const forceStmt = db.prepare(
	`SELECT r.id, r.name, r.description, r.ml_round_id AS mlRoundId,
	        COALESCE(re.playlist_url, r.spotify_playlist_url) AS playlistUrl
	   FROM rounds r
	   JOIN seasons s ON s.id = r.season_id
	   LEFT JOIN round_events re ON re.round_id = r.id AND re.event_type='voting_started'
	  WHERE r.id = ? AND s.league_id = ?`,
);
const pendingStmt = db.prepare(
	`SELECT r.id, r.name, r.description, r.ml_round_id AS mlRoundId,
	        COALESCE(re.playlist_url, r.spotify_playlist_url) AS playlistUrl
	   FROM round_events re
	   JOIN rounds r  ON r.id = re.round_id
	   JOIN seasons s ON s.id = r.season_id
	   LEFT JOIN ytm_drops d ON d.round_id = r.id
	  WHERE re.event_type = 'voting_started'
	    AND s.league_id = ?
	    AND re.occurred_at >= datetime('now', '-${WINDOW_DAYS} days')
	    AND (
	      d.round_id IS NULL
	      OR d.status = 'dry-run'
	      OR (
	        d.status = 'failed'
	        -- A round that failed on a YouTube rate limit must NOT come back on
	        -- the next 15-minute tick. Each attempt spends ~1,300 quota units on
	        -- track searches BEFORE it reaches the call that failed, so retrying
	        -- four times an hour against a per-day creation cap would exhaust the
	        -- 10,000-unit search quota and break everything else too. Rate-limit
	        -- failures wait for the daily reset; every other failure retries as
	        -- before, because those are the transient ones.
	        AND (
	          d.error IS NULL
	          OR d.error NOT LIKE '%RATE_LIMIT_EXCEEDED%'
	          OR d.created_at <= datetime('now', '-6 hours')
	        )
	      )
	    )
	  ORDER BY re.occurred_at`,
);
const candidates = [];
for (const lg of LEAGUES) {
	const rows = FORCE_ROUND ? forceStmt.all(FORCE_ROUND, lg.id) : pendingStmt.all(lg.id);
	for (const r of rows) candidates.push({ ...r, league: lg });
}

if (!candidates.length) {
	console.log('[ok] no pending voting_started rounds');
	// Still sweep: no new rounds is exactly when a snooze comes back due.
	await sweepPendingReviews();
	db.close();
	process.exit(0);
}

// ── youtube helpers (same retry discipline the spike proved) ─────────────────
async function ytToken() {
	const res = await fetch('https://oauth2.googleapis.com/token', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'refresh_token',
			refresh_token: env.YOUTUBE_REFRESH_TOKEN,
			client_id: env.YOUTUBE_CLIENT_ID,
			client_secret: env.YOUTUBE_CLIENT_SECRET,
		}).toString(),
	});
	if (!res.ok) throw new Error(`YouTube token refresh HTTP ${res.status}`);
	return (await res.json()).access_token;
}
async function ytApi(token, method, pathQ, payload, tries = 5) {
	for (let i = 0; ; i++) {
		const res = await fetch(`https://www.googleapis.com/youtube/v3/${pathQ}`, {
			method,
			headers: { Authorization: `Bearer ${token}`, ...(payload ? { 'Content-Type': 'application/json' } : {}) },
			body: payload ? JSON.stringify(payload) : undefined,
		});
		const body = await res.json();
		if (res.ok) return body;
		// 409: playlistItems.insert intermittently conflicts on rapid inserts
		// (spike 003). 429: playlists.insert has a per-day CREATION cap, separate
		// from the 10,000-unit quota — 13 playlists on 2026-09-07 exhausted it
		// while search kept working. Backing off rides out a burst; a genuine
		// daily cap will still fail, which is correct, but it must not fail on
		// the first 429 the way it did before.
		if (![409, 429, 500, 503].includes(res.status) || i >= tries - 1) {
			throw new Error(`${pathQ.split('?')[0]} HTTP ${res.status}: ${JSON.stringify(body.error?.errors ?? body).slice(0, 250)}`);
		}
		await new Promise((r) => setTimeout(r, (res.status === 429 ? 5000 : 1000) * 2 ** i));
	}
}
const iso8601ToSec = (d) => {
	const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(d ?? '');
	return m ? (Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)) : null;
};

async function spotifyPlaylistTracks(playlistUrl) {
	const id = playlistUrl?.match(/playlist\/([A-Za-z0-9]+)/)?.[1];
	if (!id) throw new Error(`no usable Spotify playlist URL (${playlistUrl})`);
	const tokRes = await fetch('https://accounts.spotify.com/api/token', {
		method: 'POST',
		headers: {
			Authorization: 'Basic ' + Buffer.from(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`).toString('base64'),
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body: 'grant_type=client_credentials',
	});
	if (!tokRes.ok) throw new Error(`Spotify token HTTP ${tokRes.status}`);
	const tok = (await tokRes.json()).access_token;
	const items = [];
	let url = `https://api.spotify.com/v1/playlists/${id}/tracks?limit=100&fields=next,items(track(name,uri,duration_ms,artists(name)))`;
	while (url) {
		const res = await fetch(url, { headers: { Authorization: `Bearer ${tok}` } });
		if (!res.ok) throw new Error(`Spotify playlist HTTP ${res.status}`);
		const body = await res.json();
		items.push(...(body.items ?? []));
		url = body.next;
	}
	return items
		.map((i) => i.track)
		.filter(Boolean)
		.map((t) => ({
			title: t.name,
			artists: t.artists?.map((a) => a.name).join(', ') ?? '',
			durationSec: Math.round((t.duration_ms ?? 0) / 1000),
		}));
}

/**
 * One search.list call, retried and normalized to {videoId,title,channel}.
 *
 * This is the call that trips YouTube's burst limiter: ten unpaced searches in
 * ~1s got the whole account 429'd for hours on 2026-09-06, and a bare throw
 * turned that into a 15-minute retry storm that made it worse. Callers must
 * still space their calls out (SEARCH_PACING_MS); this only handles the retry.
 */
async function ytSearch(token, q, { categoryId, maxResults = 3 } = {}) {
	const url = new URL('https://www.googleapis.com/youtube/v3/search');
	url.searchParams.set('part', 'snippet');
	url.searchParams.set('q', q);
	url.searchParams.set('type', 'video');
	if (categoryId) url.searchParams.set('videoCategoryId', categoryId);
	url.searchParams.set('maxResults', String(maxResults));
	let res;
	for (let i = 0; ; i++) {
		res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
		if (res.ok) break;
		if (![429, 500, 503].includes(res.status) || i >= 4) throw new Error(`search HTTP ${res.status}`);
		await new Promise((r) => setTimeout(r, 2000 * 2 ** i));
	}
	return ((await res.json()).items ?? [])
		.filter((i) => i.id?.videoId)
		.map((i) => ({ videoId: i.id.videoId, title: i.snippet?.title ?? '', channel: i.snippet?.channelTitle ?? '' }));
}

/**
 * Resolve one track: search top-3 in the music category, then prefer the
 * candidate whose duration matches Spotify's within 3s (this caught two real
 * mismatches during the spikes); among duration matches prefer "- Topic"
 * (YTM catalog) channels; fall back to the top result.
 */
async function resolveVideo(token, track) {
	const items = await ytSearch(token, `${track.title} ${track.artists}`, { categoryId: '10' });
	if (!items.length) return null;
	const ids = items.map((i) => i.videoId).join(',');
	let durById = {};
	try {
		const v = await ytApi(token, 'GET', `videos?part=contentDetails&id=${ids}`);
		durById = Object.fromEntries((v.items ?? []).map((x) => [x.id, iso8601ToSec(x.contentDetails?.duration)]));
	} catch { /* duration check is best-effort */ }
	const scored = items.map((i) => ({
		...i,
		durOk: track.durationSec && durById[i.videoId] != null && Math.abs(durById[i.videoId] - track.durationSec) <= 3,
	}));
	return (
		scored.find((s) => s.durOk && / - Topic$/.test(s.channel)) ??
		scored.find((s) => s.durOk) ??
		scored[0]
	);
}

// ── whatsapp send with wedge recovery (twice-documented today) ───────────────
function controlPost(route, payload, timeoutMs = 90_000) {
	const out = execFileSync(
		'docker',
		[
			'exec', BOT_CONTAINER, 'node', '-e',
			`fetch('http://localhost:3003/${route}',{method:'POST',headers:{'content-type':'application/json'},body:process.argv[1]}).then(async r=>{const t=await r.text(); console.log(r.status, t); process.exit(r.ok?0:1)})`,
			JSON.stringify(payload),
		],
		{ encoding: 'utf8', timeout: timeoutMs },
	);
	return out.trim();
}
function restartBotAndWait() {
	console.log('[recover] restarting wedged bot container');
	execFileSync('docker', ['restart', BOT_CONTAINER], { timeout: 60_000 });
	const deadline = Date.now() + 180_000;
	for (;;) {
		try {
			const logs = execFileSync('docker', ['logs', BOT_CONTAINER, '--since', '3m'], { encoding: 'utf8', timeout: 15_000 });
			if (logs.includes('Client ready')) return;
		} catch { /* keep waiting */ }
		if (Date.now() > deadline) throw new Error('bot did not become ready within 3m of restart');
		execFileSync('sleep', ['5']);
	}
}
function sendMedia(target, file, caption) {
	try {
		return controlPost('media', { target, file, caption });
	} catch (e) {
		// Puppeteer wedge presents as a hang (exec timeout) or 500 — restart once.
		console.log(`[warn] media send failed (${e.message?.slice(0, 80)}); attempting wedge recovery`);
		restartBotAndWait();
		return controlPost('media', { target, file, caption });
	}
}

/** Create an unlisted playlist and fill it, pacing the inserts per spike 003. */
async function createPlaylist(token, title, description, videoIds) {
	const pl = await ytApi(token, 'POST', 'playlists?part=snippet,status', {
		snippet: { title, description },
		status: { privacyStatus: 'unlisted' },
	});
	for (const vid of videoIds) {
		await ytApi(token, 'POST', 'playlistItems?part=snippet', {
			snippet: { playlistId: pl.id, resourceId: { kind: 'youtube#video', videoId: vid } },
		});
		await new Promise((r) => setTimeout(r, 400));
	}
	return pl.id;
}

/** Hand a resolved candidate set to bot-ui, which owns the review lifecycle. */
async function parkVideoReview(payload) {
	const res = await fetch(`${UI_BASE}/api/ytm/video-review/park`, {
		method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
	});
	if (!res.ok) throw new Error(`park HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
	// Notifying is a SEPARATE call so a notification failure cannot lose the
	// parked picks — the sweep below re-notifies anything still pending.
	const n = await fetch(`${UI_BASE}/api/ytm/video-review/notify`, {
		method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ roundId: payload.roundId }),
	});
	if (!n.ok) console.error(`[warn] review parked but notify failed: HTTP ${n.status}`);
	return res.json();
}

/**
 * Nudge anything still waiting on a human — a snooze that has expired, or a
 * review whose notification never went out because ntfy was down. Runs on every
 * tick of the existing 15-minute timer, so a snooze needs no scheduler of its
 * own. Never throws: this is a courtesy, not part of the drop.
 */
async function sweepPendingReviews() {
	try {
		const res = await fetch(`${UI_BASE}/api/ytm/video-review/notify`, {
			method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
		});
		if (!res.ok) { console.error(`[warn] review re-notify sweep: HTTP ${res.status}`); return; }
		const body = await res.json();
		if (body.notified?.length) console.log(`[info] re-notified ${body.notified.length} pending video review(s)`);
	} catch (e) {
		console.error(`[warn] review re-notify sweep failed: ${e.message}`);
	}
}

// ── per-round pipeline ────────────────────────────────────────────────────────
const record = db.prepare(
	`INSERT INTO ytm_drops (round_id, league_id, ytm_playlist_id, ytm_url, target, status, error,
	                        video_playlist_id, video_url, video_manifest)
	 VALUES (@round_id, @league_id, @ytm_playlist_id, @ytm_url, @target, @status, @error,
	         @video_playlist_id, @video_url, @video_manifest)
	 ON CONFLICT(round_id) DO UPDATE SET
	   league_id=excluded.league_id,
	   ytm_playlist_id=excluded.ytm_playlist_id, ytm_url=excluded.ytm_url,
	   target=excluded.target, status=excluded.status, error=excluded.error,
	   video_playlist_id=COALESCE(excluded.video_playlist_id, ytm_drops.video_playlist_id),
	   video_url=COALESCE(excluded.video_url, ytm_drops.video_url),
	   video_manifest=COALESCE(excluded.video_manifest, ytm_drops.video_manifest),
	   created_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')`,
);
/** Defaults so every record.run() names every bound parameter. */
const blank = {
	ytm_playlist_id: null, ytm_url: null, error: null,
	video_playlist_id: null, video_url: null, video_manifest: null,
};

for (const round of candidates) {
	const lg = round.league;
	const TARGET = targetFor(lg);
	console.log(`\n── ${lg.slug} round ${round.id} "${round.name}" → ${TARGET} ──`);
	try {
		const token = await ytToken();
		const tracks = VIDEOS_ONLY ? [] : await spotifyPlaylistTracks(round.playlistUrl);
		if (!VIDEOS_ONLY) {
			console.log(`[info] ${tracks.length} tracks from Spotify playlist`);
			if (!tracks.length) throw new Error('playlist has no tracks yet');
		}

		const resolved = [];
		let first = true;
		for (const t of tracks) {
			// Same reason as the retry above: space the searches out rather than
			// bursting them. 1.5s x ~10 tracks costs ~15s and is invisible on a
			// 15-minute timer.
			if (!first) await new Promise((r) => setTimeout(r, SEARCH_PACING_MS));
			first = false;
			const v = await resolveVideo(token, t);
			console.log(`  ${v ? '✓' : '✗'} ${t.title} — ${t.artists}${v ? ` → ${v.videoId} (${v.channel})` : ''}`);
			if (v) resolved.push(v.videoId);
		}
		if (!VIDEOS_ONLY && resolved.length < Math.ceil(tracks.length * 0.8)) {
			throw new Error(`only ${resolved.length}/${tracks.length} tracks resolved — refusing to ship a gutted playlist`);
		}

		// ── video candidates (per-round setting, global default) ────────────
		// Resolved here because this script owns the YouTube search; NOT built
		// here, because the whole point of the review is that the contents
		// change. Building first would mean either editing a live playlist
		// afterwards or handing the group a different link from the reviewed one.
		let picks = null;
		let videoStatus = null;
		const vcfg = readRoundVideoConfig(db, round.id);
		if (!vcfg.enabled) {
			console.log('[info] video playlist off for this round');
		} else if (hasNoVideoSource(vcfg)) {
			// Valid but inert. Say so rather than quietly building nothing.
			videoStatus = 'video playlist is on but BOTH sources are off — nothing to build';
			console.log(`[warn] ${videoStatus}`);
		} else {
			const subs = db
				.prepare('SELECT title, artists, comment, spotify_uri AS spotifyUri FROM ml_submissions WHERE round_id = ? ORDER BY spotify_uri')
				.all(round.id);
			if (!subs.length) {
				videoStatus = 'no submissions imported for this round yet';
				console.log(`[warn] ${videoStatus}`);
			} else {
				if (vcfg.useComments && !subs.some((x) => extractVideoIds(x.comment).length)) {
					// Nothing usable in the column — the comments are probably still
					// only on the open ballot. Best-effort; never fatal.
					const fetched = fetchBallotComments(db, round, {
						script: path.join(ROOT, 'scripts/ml-vote-comments.py'),
						cwd: ROOT,
					});
					console.log(`[info] ballot comments: ${fetched.ok ? `${fetched.updated} applied` : fetched.error}`);
					if (fetched.ok && fetched.updated) {
						const reread = db.prepare('SELECT comment FROM ml_submissions WHERE round_id=? AND spotify_uri=?');
						for (const x of subs) x.comment = reread.get(round.id, x.spotifyUri)?.comment ?? x.comment;
					}
				}
				await new Promise((r) => setTimeout(r, SEARCH_PACING_MS));
				picks = await resolveVideoPicks(subs, (q) => ytSearch(token, q, { maxResults: 5 }), {
					pacingMs: SEARCH_PACING_MS,
					useComments: vcfg.useComments,
					useSearch: vcfg.useSearch,
					autoAcceptPct: vcfg.searchAutoAcceptPct,
					hilPct: vcfg.hilPct,
				});
				const n = (b) => picks.filter((x) => x.band === b).length;
				const mark = { certain: '💬', auto: '🔎', review: '❓', suggestion: '·' };
				for (const x of picks) {
					const c = x.candidates[0];
					console.log(`  ${mark[x.band]} ${x.title} — ${x.artists}${c ? ` → ${c.videoId} (${c.channel || 'comment'}) [${x.score}]` : ` — ${x.reason}`}`);
				}
				videoStatus = `${n('certain')} from comments, ${n('auto')} auto, ${n('review')} need a call, ${n('suggestion')} long shots`;
				console.log(`[info] videos: ${videoStatus}`);
			}
		}

		// ── videos-only: park what we just resolved against the EXISTING audio
		// send and stop. No playlist is rebuilt, nothing is posted.
		if (VIDEOS_ONLY) {
			const prior = db.prepare('SELECT ytm_url, status FROM ytm_drops WHERE round_id = ?').get(round.id);
			if (!picks?.length) { console.log('[ok] nothing to park (video playlist off, or no candidates)'); continue; }
			const parked = await parkVideoReview({
				roundId: round.id, leagueId: lg.id, picks, config: vcfg, target: TARGET,
				audioUrl: prior?.ytm_url ?? null, audioSent: prior?.status === 'sent',
			});
			console.log(`[ok] parked review for round ${round.id}: ${JSON.stringify(parked)}`);
			continue;
		}

		let ytmUrl = null;
		let playlistId = null;
		if (!DRY) {
			playlistId = await createPlaylist(
				token,
				`${lg.title} · ${round.name}`,
				'Music League — YouTube Music mirror of the round playlist. Auto-built.',
				resolved,
			);
			ytmUrl = `https://music.youtube.com/playlist?list=${playlistId}`;
			console.log(`[info] playlist created: ${ytmUrl}`);
		}

		const coverHost = path.join(ROOT, `data/tmp/r${round.id}-drop-cover.png`);
		execFileSync(
			'node',
			[path.join(ROOT, 'scripts/ytm-cover/generate.mjs'), String(round.id), COVER_VARIANT,
			 '--playlist-url', round.playlistUrl, '--out', coverHost],
			{ stdio: 'inherit', timeout: 120_000 },
		);

		const base = { ...blank, round_id: round.id, league_id: lg.id, target: TARGET };

		if (DRY) {
			record.run({ ...base, status: 'dry-run' });
			console.log(`[dry-run] cover at ${coverHost}; ${picks ? `${picks.length} video candidates resolved; ` : ''}no playlist, no send, no review parked`);
			continue;
		}

		const caption = `🎧 *${round.name}* — this week's playlist, now for the YouTube Music crowd:\n${ytmUrl}`;
		const sendOut = sendMedia(TARGET, `/app/data/tmp/r${round.id}-drop-cover.png`, caption);
		console.log(`[info] sent to ${TARGET}: ${sendOut}`);
		record.run({ ...base, ytm_playlist_id: playlistId, ytm_url: ytmUrl, status: 'sent' });

		// ── park the video candidates for review ─────────────────────────────
		// Deliberately AFTER the audio send is recorded: the audio has already
		// gone out, so a failure here must not roll the round back to `failed`
		// and re-send it on the next tick. A parking failure is reported and
		// left for a manual `--round N` re-run.
		if (picks?.length) {
			try {
				await parkVideoReview({
					roundId: round.id, leagueId: lg.id, picks, config: vcfg,
					target: TARGET, audioUrl: ytmUrl, audioSent: true,
				});
				console.log(`[info] video review parked — ${videoStatus}`);
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				console.error(`[warn] could not park the video review: ${msg}`);
				try {
					controlPost('notify', { text: `⚠️ round ${round.id} "${round.name}": audio playlist posted, but parking the video review failed (${msg.slice(0, 140)}). Re-run: node scripts/ytm-drop/run.mjs --round ${round.id}` }, 30_000);
				} catch { /* owner notify is best-effort */ }
			}
		}
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		console.error(`[fail] round ${round.id}: ${msg}`);
		record.run({ ...blank, round_id: round.id, league_id: lg.id, target: TARGET, status: 'failed', error: msg.slice(0, 400) });
		try {
			controlPost('notify', { text: `⚠️ ytm-drop failed for round ${round.id} "${round.name}": ${msg.slice(0, 200)}` }, 30_000);
		} catch { /* owner notify is best-effort */ }
	}
}

await sweepPendingReviews();
db.close();
