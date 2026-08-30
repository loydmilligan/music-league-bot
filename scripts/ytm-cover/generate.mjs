#!/usr/bin/env node
/**
 * ytm-cover/generate — render the weekly YTM playlist cover for a round.
 *
 *   node scripts/ytm-cover/generate.mjs <roundId> <1a|1b|1c> [--ytm-url URL] [--out PATH]
 *
 * Implements CD's handoffs (design_handoff_ytm_cover*, 2026-08-29; the
 * 1b/1d/1e revision supersedes the first drop for those concepts):
 *   1a Mosaic Frame    — textless 4×3 cover grid + pulp badge cells
 *   1b Marquee Title   — tiled 4×4 art wash, round name bottom-right (auto-fit)
 *   1c Track Manifest  — mono receipt, zero album art
 *   1d Filmstrip Band  — pulp header band + cover strip + theme text
 *   1e Pulp Stamp      — full tiled art grid behind a rotated pulp stamp
 *
 * Send-time data only: no winners, scores, or submitter identities.
 * Deterministic: all art is fetched up front and inlined as data URIs;
 * fonts are the self-hosted digest set loaded via file://.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(ROOT, 'ui/package.json'));
const Database = require('better-sqlite3');
const puppeteer = require('puppeteer');

const LEAGUE_ID = 5; // Boarz II Men
const FONTS_CSS = path.join(ROOT, 'digests/d/boarz-chat-superlatives/_app/fonts.css');

// ── args ──────────────────────────────────────────────────────────────────────
const [roundIdArg, variant] = process.argv.slice(2);
const ROUND_ID = Number(roundIdArg);
if (!ROUND_ID || !['1a', '1b', '1c', '1d', '1e'].includes(variant)) {
	console.error('usage: generate.mjs <roundId> <1a|1b|1c|1d|1e> [--ytm-url URL] [--out PATH]');
	process.exit(1);
}
const flag = (name) => {
	const i = process.argv.indexOf(name);
	return i >= 0 ? process.argv[i + 1] : undefined;
};
const OUT = flag('--out') ?? path.join(ROOT, `data/tmp/r${ROUND_ID}-cover-${variant}.png`);
const YTM_URL = flag('--ytm-url') ?? null;

// ── round data (send-time only) ───────────────────────────────────────────────
const env = {};
for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
	const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
	if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const db = new Database(path.join(ROOT, 'data/league.db'), { readonly: true });
const round = db.prepare('SELECT name, description FROM rounds WHERE id = ?').get(ROUND_ID);
if (!round) throw new Error(`round ${ROUND_ID} not found`);
// Round number = chronological position by voting deadline (same rule as the Tape).
const eras = db
	.prepare(
		`SELECT r.id FROM rounds r JOIN seasons se ON r.season_id = se.id
		  WHERE se.league_id = ? AND r.voting_deadline IS NOT NULL ORDER BY r.voting_deadline`,
	)
	.all(LEAGUE_ID);
const roundNum = eras.findIndex((e) => e.id === ROUND_ID) + 1 || ROUND_ID;
const songs = db
	.prepare(
		`SELECT title, artists, spotify_uri, album_art_url FROM ml_submissions
		  WHERE round_id = ? ORDER BY spotify_uri`,
	)
	.all(ROUND_ID);
db.close();
if (!songs.length) throw new Error(`round ${ROUND_ID} has no submissions`);

const themeBy = round.description?.match(/Theme submitted by\s+(.+?)\s*$/im)?.[1] ?? null;
const themeText = round.description?.replace(/\s*Theme submitted by\s+.+$/im, '').trim() ?? '';

// Total runtime via one Spotify batch call; cover degrades to trackCount-only on failure.
async function totalRuntimeMin() {
	try {
		const tok = await fetch('https://accounts.spotify.com/api/token', {
			method: 'POST',
			headers: {
				Authorization:
					'Basic ' + Buffer.from(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`).toString('base64'),
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: 'grant_type=client_credentials',
		}).then((r) => r.json());
		const ids = songs.map((s) => s.spotify_uri.split(':')[2]).join(',');
		const res = await fetch(`https://api.spotify.com/v1/tracks?ids=${ids}`, {
			headers: { Authorization: `Bearer ${tok.access_token}` },
		}).then((r) => r.json());
		const ms = res.tracks?.reduce((n, t) => n + (t?.duration_ms ?? 0), 0) ?? 0;
		return ms ? Math.round(ms / 60000) : null;
	} catch {
		return null;
	}
}

async function dataUri(url) {
	if (!url) return null;
	try {
		const r = await fetch(url);
		if (!r.ok) return null;
		return 'data:image/jpeg;base64,' + Buffer.from(await r.arrayBuffer()).toString('base64');
	} catch {
		return null;
	}
}

const runtimeMin = await totalRuntimeMin();
const arts = variant === '1c' ? [] : await Promise.all(songs.map((s) => dataUri(s.album_art_url)));

// Grid-fill helper (CD 1b/1e): tile the resolved covers to fill N cells so no
// cell is ever blank, whatever the track count.
const gridFill = (n) => {
	const covers = arts.filter(Boolean);
	if (!covers.length) return Array.from({ length: n }, () => null);
	return Array.from({ length: n }, (_, i) => covers[i % covers.length]);
};

// ── shared style ──────────────────────────────────────────────────────────────
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const rr = String(roundNum).padStart(2, '0');
const head = `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="${pathToFileURL(FONTS_CSS)}">
<style>
:root{--ink-0:#07090c;--ink-1:#0d1116;--ink-2:#141921;--ink-3:#1c232c;--ink-4:#283039;--ink-5:#3a4451;
--fg:#f1f4f7;--fg-2:#c2cad3;--fg-muted:#8b97a4;--fg-quiet:#5a6773;
--mash-pulp:#ff5b2e;--mash-pulp-deep:#d94c23;--mash-pulp-edge:#8a2d15;--bone:#faf7f2;
--font-display:"Bricolage Grotesque",sans-serif;--font-body:"Inter Tight",sans-serif;--font-mono:"JetBrains Mono",monospace}
*{margin:0;box-sizing:border-box}
body{width:640px;height:640px;background:var(--ink-0);overflow:hidden;position:relative;font-family:var(--font-body);color:var(--fg)}
</style>`;

// Track-number chip used by 1a; missing art falls back to yt thumb crop or ♪ cell.
const cellArt = (i) =>
	arts[i]
		? `<img src="${arts[i]}" style="width:100%;height:100%;object-fit:cover;display:block">`
		: `<div style="width:100%;height:100%;background:var(--ink-3);display:flex;align-items:center;justify-content:center;font-family:var(--font-display);font-weight:800;font-size:34px;color:var(--mash-pulp)">♪</div>`;

let html;
if (variant === '1a') {
	// 4×3 (10 covers + 2 brand cells); 3×3 for ≤7 songs per degradation note.
	const cols = songs.length <= 7 ? 3 : 4;
	const cells = songs
		.map(
			(s, i) => `<div style="position:relative">${cellArt(i)}
			<span style="position:absolute;top:6px;left:8px;font-family:var(--font-mono);font-weight:700;font-size:15px;color:rgba(255,255,255,.82);text-shadow:0 1px 3px rgba(0,0,0,.8)">${i + 1}</span></div>`,
		)
		.join('');
	html = `${head}<body>
	<div style="position:absolute;inset:0;display:grid;grid-template-columns:repeat(${cols},1fr);grid-auto-rows:1fr;gap:3px;background:var(--ink-5)">
		${cells}
		<div style="background:var(--mash-pulp);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px">
			<span style="font-family:var(--font-display);font-weight:800;font-style:italic;font-size:50px;letter-spacing:-.04em;color:var(--bone);text-shadow:0 2px 0 var(--mash-pulp-edge)">R${roundNum}</span>
			<span style="font-family:var(--font-mono);font-weight:700;font-size:13px;letter-spacing:.1em;color:var(--bone)">SEASON 1</span>
		</div>
		<div style="background:var(--ink-0);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;text-align:center;padding:8px">
			<span style="font-family:var(--font-mono);font-weight:700;font-size:15px;letter-spacing:.12em;color:var(--mash-pulp)">BOARZ II MEN</span>
			<span style="font-family:var(--font-body);font-weight:600;font-size:17px;color:var(--fg-muted)">${songs.length} tracks · YTM drop</span>
		</div>
	</div></body>`;
} else if (variant === '1b') {
	// Revised per the 1b/1d/1e handoff: 4×4 grid-fill backdrop, title block bottom-right.
	const wash = gridFill(16)
		.map((a) => (a ? `<img src="${a}" style="width:100%;height:100%;object-fit:cover">` : `<div style="background:var(--ink-2)"></div>`))
		.join('');
	html = `${head}<body>
	<div style="position:absolute;inset:0;display:grid;grid-template-columns:repeat(4,1fr);grid-auto-rows:1fr;filter:blur(5px) saturate(.7);opacity:.4">${wash}</div>
	<div style="position:absolute;inset:0;background:radial-gradient(120% 90% at 50% 40%, rgba(7,9,12,.35), rgba(7,9,12,.92))"></div>
	<div style="position:absolute;inset:0;padding:56px;display:flex;flex-direction:column;justify-content:space-between">
		<div style="font-family:var(--font-mono);font-weight:700;font-size:17px;letter-spacing:.14em"><span style="color:var(--mash-pulp)">ROUND ${rr}</span><span style="color:var(--fg-muted)"> · THE DROP</span></div>
		<div style="align-self:flex-end;text-align:right;max-width:80%">
			<h1 id="title" style="font-family:var(--font-display);font-weight:800;font-size:67px;line-height:.98;letter-spacing:-.03em;color:var(--bone);text-shadow:0 4px 24px rgba(0,0,0,.7);text-wrap:balance">${esc(round.name)}</h1>
			<div style="display:flex;justify-content:flex-end;align-items:baseline;gap:16px;margin-top:20px">
				<span style="font-family:var(--font-body);font-weight:500;font-size:17px;color:var(--fg-muted)">${themeBy ? `Themed by <b style="color:var(--fg-2)">${esc(themeBy)}</b> · ` : ''}${songs.length} tracks</span>
				<span style="font-family:var(--font-display);font-weight:800;font-style:italic;font-size:26px;letter-spacing:-.04em;color:var(--mash-pulp);text-shadow:0 3px 0 var(--mash-pulp-edge)">B-II-M</span>
			</div>
		</div>
	</div>
	<script>
		// Auto-fit: shrink from 67px until the title fits its share of the frame (min 46px).
		const t = document.getElementById('title');
		const max = 640 - 56*2 - 140; let size = 67;
		while (t.scrollHeight > max && size > 46) { size -= 2; t.style.fontSize = size + 'px'; }
	</script></body>`;
} else if (variant === '1d') {
	const k = songs.length <= 7 ? songs.length - 1 : 4;
	const strip = arts
		.map((a, i) => ({ a, i }))
		.filter((x) => x.a)
		.slice(0, k)
		.map((x) => `<div style="flex:1;aspect-ratio:1;overflow:hidden"><img src="${x.a}" style="width:100%;height:100%;object-fit:cover;display:block"></div>`)
		.join('');
	const overflow = songs.length - k;
	html = `${head}<body>
	<div style="position:absolute;inset:0;display:flex;flex-direction:column;background:var(--ink-0)">
		<div style="background:var(--mash-pulp);padding:27px 37px;display:flex;justify-content:space-between;align-items:center">
			<span style="font-family:var(--font-display);font-weight:800;font-style:italic;font-size:32px;letter-spacing:-.04em;color:var(--bone);text-shadow:0 3px 0 var(--mash-pulp-edge)">BOARZ II MEN</span>
			<span style="font-family:var(--font-mono);font-weight:700;font-size:17px;color:var(--bone);background:rgba(0,0,0,.28);padding:4px 8px;border-radius:5px">R${rr} · S1</span>
		</div>
		<div style="display:flex;gap:3px">
			${strip}
			${overflow > 0 ? `<div style="flex:1;aspect-ratio:1;background:var(--ink-2);display:flex;align-items:center;justify-content:center;font-family:var(--font-display);font-weight:700;font-size:25px;color:var(--mash-pulp)">+${overflow}</div>` : ''}
		</div>
		<div style="flex:1;padding:37px;display:flex;flex-direction:column;justify-content:space-between">
			<div style="font-family:var(--font-mono);font-weight:700;font-size:15px;letter-spacing:.12em;color:var(--mash-pulp)">THIS WEEK'S THEME</div>
			<h1 id="title" style="font-family:var(--font-display);font-weight:700;font-size:37px;line-height:1.1;color:var(--fg);text-wrap:balance">${esc(round.name)}</h1>
			<div style="font-family:var(--font-body);font-size:21px;line-height:1.4;color:var(--fg-muted)">${esc(themeText)}</div>
			<div style="display:flex;justify-content:space-between;align-items:baseline">
				<span style="font-family:var(--font-body);font-weight:500;font-size:17px;color:var(--fg-quiet)">${themeBy ? `Themed by ${esc(themeBy)}` : ''}</span>
				<span style="font-family:var(--font-mono);font-weight:700;font-size:15px;color:var(--mash-pulp)">▶ ${songs.length} tracks</span>
			</div>
		</div>
	</div>
	<script>
		const t = document.getElementById('title');
		let size = 37; while (t.scrollHeight > 130 && size > 26) { size -= 2; t.style.fontSize = size + 'px'; }
	</script></body>`;
} else if (variant === '1e') {
	const grid = gridFill(16)
		.map((a) => (a ? `<img src="${a}" style="width:100%;height:100%;object-fit:cover">` : `<div style="background:var(--mash-pulp-edge)"></div>`))
		.join('');
	html = `${head}<body>
	<div style="position:absolute;inset:0;display:grid;grid-template-columns:repeat(4,1fr);grid-auto-rows:1fr">${grid}</div>
	<div style="position:absolute;inset:0;background:radial-gradient(90% 90% at 50% 50%, rgba(7,9,12,.15), rgba(7,9,12,.82))"></div>
	<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center">
		<div style="position:relative;width:357px;height:357px;border-radius:50%;border:3px solid var(--mash-pulp);transform:rotate(-8deg);box-shadow:0 0 0 8px rgba(255,91,46,.1);backdrop-filter:blur(3px);background:radial-gradient(circle, rgba(255,91,46,.16) 0%, rgba(7,9,12,.62) 55%, rgba(7,9,12,.86) 100%);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px">
			<div style="position:absolute;inset:20px;border-radius:50%;border:1.5px dashed var(--mash-pulp)"></div>
			<span style="font-family:var(--font-mono);font-weight:700;font-size:15px;letter-spacing:.24em;color:var(--mash-pulp)">★ SEASON 1 ★</span>
			<span style="font-family:var(--font-display);font-weight:800;font-style:italic;font-size:110px;line-height:1;letter-spacing:-.04em;color:var(--mash-pulp);text-shadow:0 3px 0 var(--mash-pulp-edge)">R${roundNum}</span>
			<span style="font-family:var(--font-mono);font-weight:700;font-size:17px;letter-spacing:.16em;color:var(--bone)">BOARZ II MEN</span>
		</div>
	</div>
	<div style="position:absolute;left:0;right:0;bottom:0;padding:18px 0 16px;text-align:center;background:linear-gradient(transparent, rgba(7,9,12,.7))">
		<span style="font-family:var(--font-mono);font-weight:600;font-size:17px;letter-spacing:.14em;color:rgba(255,255,255,.72)">WEEKLY YTM DROP</span>
	</div></body>`;
} else {
	const rows = songs
		.map(
			(s, i) => `<div style="display:flex;align-items:baseline;gap:12px;border-top:1px solid rgba(255,255,255,.045);padding:7.5px 0">
			<span style="font-family:var(--font-mono);font-weight:500;font-size:15px;color:var(--mash-pulp);width:16px;flex:none">${i + 1}</span>
			<span style="font-family:var(--font-body);font-weight:600;font-size:${songs.length > 10 ? 16 : 18}px;color:var(--fg-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(s.title)}</span>
			<span style="font-family:var(--font-body);font-size:${songs.length > 10 ? 16 : 18}px;color:var(--fg-quiet);margin-left:auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:38%">${esc(s.artists)}</span></div>`,
		)
		.join('');
	html = `${head}<body>
	<div style="position:absolute;inset:0;background:var(--ink-1);padding:43px 40px;display:flex;flex-direction:column">
		<div style="display:flex;justify-content:space-between;border-bottom:1px solid var(--ink-4);padding-bottom:12px;margin-bottom:18px">
			<span style="font-family:var(--font-mono);font-weight:700;font-size:15px;letter-spacing:.12em;color:var(--mash-pulp)">BOARZ II MEN · YTM MIRROR</span>
			<span style="font-family:var(--font-mono);font-weight:700;font-size:15px;color:var(--fg-quiet)">S1 / R${rr}</span>
		</div>
		<h1 style="font-family:var(--font-display);font-weight:800;font-size:40px;line-height:1.02;color:var(--fg);text-wrap:balance;margin-bottom:14px">${esc(round.name)}</h1>
		<div style="flex:1;display:flex;flex-direction:column;justify-content:center">${rows}</div>
		<div style="display:flex;justify-content:space-between;border-top:1px solid var(--ink-4);padding-top:14px;margin-top:6px">
			<span style="font-family:var(--font-body);font-size:17px;color:var(--fg-muted)">${songs.length} tracks${runtimeMin ? ` · ${runtimeMin} min` : ''}</span>
			<span style="font-family:var(--font-mono);font-weight:700;font-size:15px;color:var(--mash-pulp)">▶ OPEN IN YTM</span>
		</div>
	</div></body>`;
}

// ── render ────────────────────────────────────────────────────────────────────
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const tmpHtml = OUT.replace(/\.png$/, '.html');
fs.writeFileSync(tmpHtml, html);

const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 640, height: 640, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(tmpHtml).href, { waitUntil: 'networkidle0' });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: OUT });
await browser.close();
fs.unlinkSync(tmpHtml);
console.log(`[ok] ${path.relative(ROOT, OUT)} — R${roundNum} "${round.name}" · ${variant} · ${songs.length} tracks${YTM_URL ? ` · ${YTM_URL}` : ''}`);
