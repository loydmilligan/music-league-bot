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
 *   node scripts/ytm-drop/run.mjs --round 142 --approve   # send an approval-gated drop
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
 *   videos    — also build a SECOND playlist of the music videos named in the
 *               submission comments. Second Best's "I Want My MTV" round puts
 *               the video link in the comment; Boarz rounds carry none, so
 *               searching for one there would invent links nobody chose.
 *   approval  — resolve and build everything, then report to the owner and
 *               STOP, instead of posting to the group. `--approve` sends.
 */
const LEAGUES = [
	{ id: 5, slug: 'boarz-ii-men', title: 'Boarz II Men', targetEnv: 'YTM_DROP_TARGET',             videos: false, approval: false },
	{ id: 3, slug: 'second-best',  title: 'Second Best',  targetEnv: 'YTM_DROP_TARGET_SECOND_BEST', videos: true,  approval: true  },
];
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
const APPROVE = argvHas('--approve');
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
// Guarded ALTERs: the table predates the video playlist and the league column.
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
	    AND (d.round_id IS NULL OR d.status IN ('failed','dry-run'))
	  ORDER BY re.occurred_at`,
);
const candidates = [];
for (const lg of LEAGUES) {
	const rows = FORCE_ROUND ? forceStmt.all(FORCE_ROUND, lg.id) : pendingStmt.all(lg.id);
	for (const r of rows) candidates.push({ ...r, league: lg });
}

if (!candidates.length) {
	console.log('[ok] no pending voting_started rounds');
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
		// playlistItems.insert intermittently 409s on rapid inserts (spike 003).
		if (![409, 500, 503].includes(res.status) || i >= tries - 1) {
			throw new Error(`${pathQ.split('?')[0]} HTTP ${res.status}: ${JSON.stringify(body.error?.errors ?? body).slice(0, 250)}`);
		}
		await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
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
		// ── approving an already-built drop ──────────────────────────────────
		// Short-circuit BEFORE any resolution: the playlists this round is
		// waiting on already exist on the account, and rebuilding them would
		// burn a few hundred quota units to orphan the originals and hand the
		// group a different link from the one that was approved.
		const held = APPROVE
			? db.prepare("SELECT ytm_url, video_url FROM ytm_drops WHERE round_id = ? AND status = 'pending-approval'").get(round.id)
			: null;
		if (held) {
			const coverHost = path.join(ROOT, `data/tmp/r${round.id}-drop-cover.png`);
			if (!fs.existsSync(coverHost)) {
				execFileSync('node', [path.join(ROOT, 'scripts/ytm-cover/generate.mjs'), String(round.id), COVER_VARIANT,
				                      '--playlist-url', round.playlistUrl, '--out', coverHost], { stdio: 'inherit', timeout: 120_000 });
			}
			const lines = [`🎧 *${round.name}* — this week's playlist, now for the YouTube Music crowd:`, held.ytm_url];
			if (held.video_url) lines.push('', '📺 …and the music videos:', held.video_url);
			const sendOut = sendMedia(TARGET, `/app/data/tmp/r${round.id}-drop-cover.png`, lines.join('\n'));
			console.log(`[info] approved + sent to ${TARGET}: ${sendOut}`);
			db.prepare("UPDATE ytm_drops SET status='sent', target=?, error=NULL WHERE round_id=?").run(TARGET, round.id);
			continue;
		}

		const tracks = await spotifyPlaylistTracks(round.playlistUrl);
		console.log(`[info] ${tracks.length} tracks from Spotify playlist`);
		if (!tracks.length) throw new Error('playlist has no tracks yet');

		const token = await ytToken();
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
		if (resolved.length < Math.ceil(tracks.length * 0.8)) {
			throw new Error(`only ${resolved.length}/${tracks.length} tracks resolved — refusing to ship a gutted playlist`);
		}

		// ── video playlist (opt-in per league) ───────────────────────────────
		// Separate from the audio mirror on purpose: these are the real music
		// videos the submitters picked, with their own runtimes and edits, and
		// mixing a 13-minute Thriller into a listening playlist ruins both.
		let picks = null;
		let videoStatus = null;
		let videoWeak = [];
		if (lg.videos) {
			const subs = db
				.prepare('SELECT title, artists, comment, spotify_uri AS spotifyUri FROM ml_submissions WHERE round_id = ? ORDER BY spotify_uri')
				.all(round.id);
			if (!subs.length) {
				videoStatus = 'no submissions imported for this round yet';
			} else {
				if (!subs.some((x) => extractVideoIds(x.comment).length)) {
					// Nothing usable in the column — the comments are probably still
					// only on the open ballot. Best-effort; never fatal.
					const fetched = fetchBallotComments(db, round, {
						script: path.join(ROOT, 'scripts/ml-vote-comments.py'),
						cwd: ROOT,
					});
					console.log(`[info] ballot comments: ${fetched.ok ? `${fetched.updated} applied` : fetched.error}`);
					if (fetched.ok && fetched.updated) {
						for (const x of subs) {
							x.comment = db.prepare('SELECT comment FROM ml_submissions WHERE round_id=? AND spotify_uri=?')
								.get(round.id, x.spotifyUri)?.comment ?? x.comment;
						}
					}
				}
				await new Promise((r) => setTimeout(r, SEARCH_PACING_MS));
				picks = await resolveVideoPicks(subs, (q) => ytSearch(token, q, { maxResults: 5 }), { pacingMs: SEARCH_PACING_MS });
				const fromComment = picks.filter((x) => x.source === 'comment').length;
				const weak = picks.filter((x) => x.confidence === 'weak');
				const strong = picks.filter((x) => x.confidence === 'likely').length;
				const holes = picks.filter((x) => !x.videoId);
				const mark = (x) => (!x.videoId ? '✗' : x.source === 'comment' ? '💬' : x.confidence === 'weak' ? '⚠️' : '🔎');
				for (const x of picks) {
					console.log(`  ${mark(x)} ${x.title} — ${x.artists}${x.videoId ? ` → ${x.videoId}${x.channel ? ` (${x.channel})` : ''}` : ''}`);
				}
				videoStatus = `${fromComment} from comments, ${strong} searched (artist channel), ${weak.length} searched (⚠️ unrelated channel), ${holes.length} unresolved`;
				console.log(`[info] videos: ${videoStatus}`);
				videoWeak = weak;
			}
		}

		let ytmUrl = null;
		let playlistId = null;
		let videoPlaylistId = null;
		let videoUrl = null;
		if (!DRY) {
			playlistId = await createPlaylist(
				token,
				`${lg.title} · ${round.name}`,
				'Music League — YouTube Music mirror of the round playlist. Auto-built.',
				resolved,
			);
			ytmUrl = `https://music.youtube.com/playlist?list=${playlistId}`;
			console.log(`[info] playlist created: ${ytmUrl}`);

			const videoIds = (picks ?? []).map((x) => x.videoId).filter(Boolean);
			if (videoIds.length) {
				videoPlaylistId = await createPlaylist(
					token,
					`${lg.title} · ${round.name} — the videos`,
					'Music League — the music videos for this round. Auto-built from submission comments.',
					videoIds,
				);
				// Plain YouTube, not music.youtube: these are videos to watch.
				videoUrl = `https://www.youtube.com/playlist?list=${videoPlaylistId}`;
				console.log(`[info] video playlist created: ${videoUrl}`);
			}
		}

		const coverHost = path.join(ROOT, `data/tmp/r${round.id}-drop-cover.png`);
		execFileSync(
			'node',
			[path.join(ROOT, 'scripts/ytm-cover/generate.mjs'), String(round.id), COVER_VARIANT,
			 '--playlist-url', round.playlistUrl, '--out', coverHost],
			{ stdio: 'inherit', timeout: 120_000 },
		);

		const manifest = picks
			? JSON.stringify(picks.map((x) => ({ title: x.title, artists: x.artists, videoId: x.videoId, source: x.source, channel: x.channel, confidence: x.confidence })))
			: null;
		const base = { ...blank, round_id: round.id, league_id: lg.id, target: TARGET, video_manifest: manifest };

		if (DRY) {
			record.run({ ...base, status: 'dry-run' });
			console.log(`[dry-run] cover at ${coverHost}; no playlist, no send`);
			continue;
		}

		const lines = [`🎧 *${round.name}* — this week's playlist, now for the YouTube Music crowd:`, ytmUrl];
		if (videoUrl) lines.push('', '📺 …and the music videos:', videoUrl);
		const caption = lines.join('\n');

		// ── approval gate ────────────────────────────────────────────────────
		// Everything above is built and durable; the only thing withheld is the
		// group post. `--approve` on a later run does the send using the
		// playlists this run already made.
		if (lg.approval && !APPROVE) {
			record.run({ ...base, ytm_playlist_id: playlistId, ytm_url: ytmUrl, video_playlist_id: videoPlaylistId, video_url: videoUrl, status: 'pending-approval' });
			const report = [
				`🕵️ ytm-drop is holding round ${round.id} "${round.name}" (${lg.title}) for approval.`,
				`Songs: ${ytmUrl}`,
				videoUrl ? `Videos: ${videoUrl}\n  ${videoStatus}` : `Videos: none (${videoStatus ?? 'disabled'})`,
				// Name the weak picks outright. "12 from search" reads like a
				// success; it is the ones on an unrelated channel that need eyes.
				...(videoWeak.length
					? ['Check these — searched, channel is not the artist:',
					   ...videoWeak.map((x) => `  • ${x.title} — ${x.artists} → youtu.be/${x.videoId} (${x.channel})`)]
					: []),
				`Cover: ${coverHost}`,
				`Send with: node scripts/ytm-drop/run.mjs --round ${round.id} --approve`,
			].join('\n');
			console.log(`\n${report}\n`);
			try { controlPost('notify', { text: report }, 30_000); } catch { /* owner notify is best-effort */ }
			continue;
		}

		const sendOut = sendMedia(TARGET, `/app/data/tmp/r${round.id}-drop-cover.png`, caption);
		console.log(`[info] sent to ${TARGET}: ${sendOut}`);

		record.run({ ...base, ytm_playlist_id: playlistId, ytm_url: ytmUrl, video_playlist_id: videoPlaylistId, video_url: videoUrl, status: 'sent' });
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		console.error(`[fail] round ${round.id}: ${msg}`);
		record.run({ ...blank, round_id: round.id, league_id: lg.id, target: TARGET, status: 'failed', error: msg.slice(0, 400) });
		try {
			controlPost('notify', { text: `⚠️ ytm-drop failed for round ${round.id} "${round.name}": ${msg.slice(0, 200)}` }, 30_000);
		} catch { /* owner notify is best-effort */ }
	}
}
db.close();
