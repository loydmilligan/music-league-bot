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
 *
 * Target group comes from .env YTM_DROP_TARGET; defaults to the TEST group.
 * State lives in ytm_drops (league.db) — one row per round, idempotent.
 * Designed to run from a host timer (see deploy/mlb-ytm-drop.*).
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(ROOT, 'ui/package.json'));
const Database = require('better-sqlite3');

const LEAGUE_ID = 5; // Boarz II Men only, by design
const TEST_GROUP = '120363428945055429@g.us';
const BOT_CONTAINER = 'music-league-bot-bot-1';
const WINDOW_DAYS = 7; // never backfill older transitions
const COVER_VARIANT = '1d'; // Matt's pick, 2026-08-29

const argvHas = (f) => process.argv.includes(f);
const argvVal = (f) => {
	const i = process.argv.indexOf(f);
	return i >= 0 ? process.argv[i + 1] : undefined;
};
const DRY = argvHas('--dry-run');
const FORCE_ROUND = argvVal('--round') ? Number(argvVal('--round')) : null;

const env = {};
for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
	const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
	if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const TARGET = env.YTM_DROP_TARGET?.trim() || TEST_GROUP;
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

// ── candidates ────────────────────────────────────────────────────────────────
// BOTH paths are league-scoped: this pipeline sends to the Boarz group, so it
// must never pick up a Second Best / SSSC / any other league's round — even
// via the manual --round override.
const candidates = FORCE_ROUND
	? db.prepare(`SELECT r.id, r.name, r.description,
	              COALESCE(re.playlist_url, r.spotify_playlist_url) AS playlistUrl
	         FROM rounds r
	         JOIN seasons s ON s.id = r.season_id
	         LEFT JOIN round_events re ON re.round_id = r.id AND re.event_type='voting_started'
	        WHERE r.id = ? AND s.league_id = ${LEAGUE_ID}`).all(FORCE_ROUND)
	: db.prepare(
			`SELECT r.id, r.name, r.description,
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
		).all(LEAGUE_ID);

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
 * Resolve one track: search top-3 in the music category, then prefer the
 * candidate whose duration matches Spotify's within 3s (this caught two real
 * mismatches during the spikes); among duration matches prefer "- Topic"
 * (YTM catalog) channels; fall back to the top result.
 */
async function resolveVideo(token, track) {
	const q = `${track.title} ${track.artists}`;
	const url = new URL('https://www.googleapis.com/youtube/v3/search');
	url.searchParams.set('part', 'snippet');
	url.searchParams.set('q', q);
	url.searchParams.set('type', 'video');
	url.searchParams.set('videoCategoryId', '10');
	url.searchParams.set('maxResults', '3');
	const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
	if (!res.ok) throw new Error(`search HTTP ${res.status}`);
	const items = ((await res.json()).items ?? []).filter((i) => i.id?.videoId);
	if (!items.length) return null;
	const ids = items.map((i) => i.id.videoId).join(',');
	let durById = {};
	try {
		const v = await ytApi(token, 'GET', `videos?part=contentDetails&id=${ids}`);
		durById = Object.fromEntries((v.items ?? []).map((x) => [x.id, iso8601ToSec(x.contentDetails?.duration)]));
	} catch { /* duration check is best-effort */ }
	const scored = items.map((i) => ({
		videoId: i.id.videoId,
		title: i.snippet?.title,
		channel: i.snippet?.channelTitle ?? '',
		durOk: track.durationSec && durById[i.id.videoId] != null && Math.abs(durById[i.id.videoId] - track.durationSec) <= 3,
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
function sendMedia(file, caption) {
	try {
		return controlPost('media', { target: TARGET, file, caption });
	} catch (e) {
		// Puppeteer wedge presents as a hang (exec timeout) or 500 — restart once.
		console.log(`[warn] media send failed (${e.message?.slice(0, 80)}); attempting wedge recovery`);
		restartBotAndWait();
		return controlPost('media', { target: TARGET, file, caption });
	}
}

// ── per-round pipeline ────────────────────────────────────────────────────────
const record = db.prepare(
	`INSERT INTO ytm_drops (round_id, ytm_playlist_id, ytm_url, target, status, error)
	 VALUES (@round_id, @ytm_playlist_id, @ytm_url, @target, @status, @error)
	 ON CONFLICT(round_id) DO UPDATE SET
	   ytm_playlist_id=excluded.ytm_playlist_id, ytm_url=excluded.ytm_url,
	   target=excluded.target, status=excluded.status, error=excluded.error,
	   created_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')`,
);

for (const round of candidates) {
	console.log(`\n── round ${round.id} "${round.name}" ──`);
	try {
		const tracks = await spotifyPlaylistTracks(round.playlistUrl);
		console.log(`[info] ${tracks.length} tracks from Spotify playlist`);
		if (!tracks.length) throw new Error('playlist has no tracks yet');

		const token = await ytToken();
		const resolved = [];
		for (const t of tracks) {
			const v = await resolveVideo(token, t);
			console.log(`  ${v ? '✓' : '✗'} ${t.title} — ${t.artists}${v ? ` → ${v.videoId} (${v.channel})` : ''}`);
			if (v) resolved.push(v.videoId);
		}
		if (resolved.length < Math.ceil(tracks.length * 0.8)) {
			throw new Error(`only ${resolved.length}/${tracks.length} tracks resolved — refusing to ship a gutted playlist`);
		}

		let ytmUrl = null;
		let playlistId = null;
		if (!DRY) {
			const pl = await ytApi(token, 'POST', 'playlists?part=snippet,status', {
				snippet: {
					title: `Boarz II Men · ${round.name}`,
					description: `Music League — YouTube Music mirror of the round playlist. Auto-built.`,
				},
				status: { privacyStatus: 'unlisted' },
			});
			playlistId = pl.id;
			for (const vid of resolved) {
				await ytApi(token, 'POST', 'playlistItems?part=snippet', {
					snippet: { playlistId, resourceId: { kind: 'youtube#video', videoId: vid } },
				});
				await new Promise((r) => setTimeout(r, 400)); // pacing per spike 003
			}
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

		if (DRY) {
			record.run({ round_id: round.id, ytm_playlist_id: null, ytm_url: null, target: TARGET, status: 'dry-run', error: null });
			console.log(`[dry-run] cover at ${coverHost}; no playlist, no send`);
			continue;
		}

		const caption = `🎧 *${round.name}* — this week's playlist, now for the YouTube Music crowd:\n${ytmUrl}`;
		const sendOut = sendMedia(`/app/data/tmp/r${round.id}-drop-cover.png`, caption);
		console.log(`[info] sent to ${TARGET}: ${sendOut}`);

		record.run({ round_id: round.id, ytm_playlist_id: playlistId, ytm_url: ytmUrl, target: TARGET, status: 'sent', error: null });
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		console.error(`[fail] round ${round.id}: ${msg}`);
		record.run({ round_id: round.id, ytm_playlist_id: null, ytm_url: null, target: TARGET, status: 'failed', error: msg.slice(0, 400) });
		try {
			controlPost('notify', { text: `⚠️ ytm-drop failed for round ${round.id} "${round.name}": ${msg.slice(0, 200)}` }, 30_000);
		} catch { /* owner notify is best-effort */ }
	}
}
db.close();
