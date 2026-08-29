#!/usr/bin/env node
/**
 * resolve-chat-songs — extract every music link from the Boarz export and
 * resolve the Spotify ones to real track metadata.
 *
 * Writes ui/scripts/chat-songs.json so page builds are reproducible and don't
 * hit the Spotify API every time. Re-run to refresh.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';
import Database from 'better-sqlite3';
import { createJiti } from 'jiti';

const UI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(UI, '..');
const jiti = createJiti(import.meta.url);

const { parseExport } = await jiti.import(path.join(UI, 'src/lib/digest/chatExport.ts'));
const { extractLinks } = await jiti.import(path.join(UI, 'src/lib/digest/chatLinks.ts'));

// Latest full-history export wins; BOARZ_EXPORT_ZIP overrides (mirrors
// chat-superlatives-data.mjs).
function latestExportZip() {
	if (process.env.BOARZ_EXPORT_ZIP) return path.resolve(process.env.BOARZ_EXPORT_ZIP);
	const dir = path.join(ROOT, 'data/boarz-ii-men/season-1');
	const dated = fs
		.readdirSync(dir)
		.filter((f) => /^whatsapp-boarz-chat-export-.*\.zip$/.test(f))
		.sort((a, b) => fs.statSync(path.join(dir, a)).mtimeMs - fs.statSync(path.join(dir, b)).mtimeMs);
	if (dated.length) return path.join(dir, dated[dated.length - 1]);
	return path.join(dir, 'WhatsApp Chat with Boarz II Men - Music League.zip');
}
const ZIP = latestExportZip();
const OUT = path.join(UI, 'scripts/chat-songs.json');

// ── env ───────────────────────────────────────────────────────────────────────

for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
	const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
	if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

async function token() {
	const id = process.env.SPOTIFY_CLIENT_ID;
	const secret = process.env.SPOTIFY_CLIENT_SECRET;
	// Client credentials are enough to READ track metadata.
	const res = await fetch('https://accounts.spotify.com/api/token', {
		method: 'POST',
		headers: {
			Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'),
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body: 'grant_type=client_credentials',
	});
	if (!res.ok) throw new Error(`Spotify token failed: ${res.status} ${await res.text()}`);
	return (await res.json()).access_token;
}

// ── run ───────────────────────────────────────────────────────────────────────

const zip = new AdmZip(ZIP);
const txt = zip.getEntries().find((e) => e.entryName.endsWith('.txt')).getData().toString('utf8');
const links = extractLinks(parseExport(txt));

const trackIds = [...new Set(links.filter((l) => l.trackId).map((l) => l.trackId))];
console.error(
	`[info] ${links.length} music links — ${trackIds.length} Spotify tracks, ` +
		`${links.filter((l) => l.kind === 'youtube').length} YouTube, ` +
		`${links.filter((l) => l.kind === 'spotify' && !l.trackId).length} Spotify album/playlist`,
);

const meta = {};
if (trackIds.length) {
	const t = await token();
	for (let i = 0; i < trackIds.length; i += 50) {
		const batch = trackIds.slice(i, i + 50);
		const res = await fetch(`https://api.spotify.com/v1/tracks?ids=${batch.join(',')}`, {
			headers: { Authorization: `Bearer ${t}` },
		});
		if (!res.ok) throw new Error(`Spotify tracks failed: ${res.status} ${await res.text()}`);
		for (const tr of (await res.json()).tracks) {
			if (!tr) continue;
			meta[tr.id] = {
				title: tr.name,
				artists: tr.artists.map((a) => a.name).join(', '),
				album: tr.album?.name ?? null,
				year: tr.album?.release_date ? Number(tr.album.release_date.slice(0, 4)) : null,
				art: tr.album?.images?.slice(-1)[0]?.url ?? null,
				uri: tr.uri,
				url: tr.external_urls?.spotify ?? null,
			};
		}
	}
}

// YouTube titles come from the public oEmbed endpoint — no API key required.
const ytMeta = {};
const ytIds = [...new Set(links.filter((l) => l.videoId).map((l) => l.videoId))];
for (const id of ytIds) {
	try {
		const res = await fetch(
			`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`,
		);
		if (!res.ok) continue; // private/deleted video — leave it unlabelled
		const j = await res.json();
		ytMeta[id] = { title: j.title, artists: j.author_name, art: j.thumbnail_url ?? null };
	} catch {
		/* network hiccup on one video shouldn't fail the build */
	}
}
console.error(`[info] ${Object.keys(ytMeta).length}/${ytIds.length} YouTube titles resolved`);

const resolved = links.map((l) => ({
	...l,
	track: l.trackId
		? meta[l.trackId] ?? null
		: l.videoId
			? ytMeta[l.videoId] ?? null
			: null,
}));
const unresolved = resolved.filter((l) => l.trackId && !l.track).length;
if (unresolved) console.error(`[warn] ${unresolved} Spotify id(s) did not resolve`);

// ── season podium ─────────────────────────────────────────────────────────────
// Top 3 submissions across ALL rounds to date (no round filter — the template
// labels this "season to date"; it was mislabelled "round one" until 2026-08-29).
// Competitor display names differ from chat names ("Mashew", "djensen37"), so
// map through ml_competitor_id the same way the stats do.
const { PEOPLE } = await jiti.import(path.join(UI, 'src/lib/digest/chatIdentity.ts'));
const byCid = new Map(PEOPLE.filter((p) => p.mlCompetitorId).map((p) => [p.mlCompetitorId, p.name]));

const db = new Database(path.join(ROOT, 'data/league.db'), { readonly: true });
const podiumRows = db
	.prepare(
		`SELECT s.title, s.artists, s.spotify_uri AS uri, s.album_art_url AS art,
		        c.ml_competitor_id AS cid, c.name AS fallback,
		        SUM(v.points) AS pts
		   FROM ml_submissions s
		   JOIN rounds r ON s.round_id = r.id
		   JOIN seasons se ON r.season_id = se.id
		   LEFT JOIN competitors c ON c.id = s.competitor_id
		   LEFT JOIN votes v ON v.round_id = s.round_id AND v.spotify_uri = s.spotify_uri
		  WHERE se.league_id = 5
		  GROUP BY s.id
		  ORDER BY pts DESC
		  LIMIT 3`,
	)
	.all();
const roundName = db
	.prepare(
		`SELECT r.name FROM rounds r JOIN seasons se ON r.season_id = se.id
		  WHERE se.league_id = 5 AND EXISTS (SELECT 1 FROM votes v WHERE v.round_id = r.id)
		  ORDER BY r.id LIMIT 1`,
	)
	.get()?.name ?? 'Round 1';

// Round eras, for tagging links: a link belongs to the earliest round whose
// voting deadline hadn't passed when it was posted — the round in play.
const eras = db
	.prepare(
		`SELECT r.name, r.voting_deadline AS vd
		   FROM rounds r JOIN seasons se ON r.season_id = se.id
		  WHERE se.league_id = 5 AND r.voting_deadline IS NOT NULL
		  ORDER BY r.voting_deadline`,
	)
	.all()
	.map((r, i) => ({ name: r.name, num: i + 1, end: Date.parse(r.vd) }));
db.close();

for (const l of resolved) {
	const era = eras.find((e) => l.ts <= e.end) ?? eras[eras.length - 1] ?? null;
	l.round = era?.name ?? null;
	l.roundNum = era?.num ?? null;
}

const podium = podiumRows.map((r, i) => ({
	place: i + 1,
	title: r.title,
	artists: r.artists,
	uri: r.uri,
	art: r.art,
	points: r.pts ?? 0,
	submitter: byCid.get(r.cid) ?? r.fallback ?? 'Unknown',
	url: r.uri?.startsWith('spotify:track:')
		? 'https://open.spotify.com/track/' + r.uri.slice('spotify:track:'.length)
		: null,
}));

fs.writeFileSync(
	OUT,
	JSON.stringify(
		{ round: roundName, podium, rounds: eras.map((e) => ({ name: e.name, num: e.num })), links: resolved },
		null,
		2,
	),
);
console.error(
	`[ok] ${path.relative(ROOT, OUT)} — ${resolved.length} links, ` +
		`${Object.keys(meta).length} tracks resolved, podium for "${roundName}"`,
);
