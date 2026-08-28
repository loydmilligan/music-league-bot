#!/usr/bin/env node
/**
 * build-chat-superlatives — render the static "Boarz Tape" page.
 *
 * Inlines the computed stats into the template and copies the self-hosted
 * fonts from an existing digest artifact, so the published page makes no
 * external requests.
 *
 *   node ui/scripts/build-chat-superlatives.mjs [--out <dir>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const UI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(UI, '..');

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const OUT =
	outIdx >= 0 && args[outIdx + 1]
		? path.resolve(args[outIdx + 1])
		: path.join(ROOT, 'digests/d/boarz-chat-superlatives');

// CD "compact tape" redesign (2026-08-28) — tabs+bento home, section overlays.
// The old long-scroll template is kept at chat-superlatives.template.html for
// rollback: flip this constant back.
const TEMPLATE = path.join(UI, 'scripts/chat-tape.template.html');
const DATA_SCRIPT = path.join(UI, 'scripts/chat-superlatives-data.mjs');

// ── data ──────────────────────────────────────────────────────────────────────

const json = execFileSync('node', [DATA_SCRIPT], {
	cwd: UI,
	encoding: 'utf8',
	maxBuffer: 64 * 1024 * 1024,
	stdio: ['ignore', 'pipe', 'inherit'],
});

// Sanity-check before baking it into a page we hand to other people.
const parsed = JSON.parse(json);
if (!parsed.people?.length) throw new Error('No people in computed data — refusing to build');
if (!parsed.awards?.motormouth) throw new Error('Awards missing — refusing to build');

// Songs and the playlist are produced by separate scripts (they need network
// access); fold them in when present so the page degrades rather than breaks.
const songsPath = path.join(UI, 'scripts/chat-songs.json');
const playlistPath = path.join(UI, 'scripts/chat-playlist.json');
if (fs.existsSync(songsPath)) {
	parsed.songs = JSON.parse(fs.readFileSync(songsPath, 'utf8'));
	if (fs.existsSync(playlistPath)) {
		const pl = JSON.parse(fs.readFileSync(playlistPath, 'utf8'));
		parsed.songs.playlistUrl = pl.url;
		parsed.songs.playlistTracks = pl.tracks;
	}
} else {
	console.error('[warn] no chat-songs.json — track list will be omitted');
}

// Hand-authored Regulars + Glossary content, maintained separately so a
// content pass never touches the template.
const editorialPath = path.join(UI, 'scripts/chat-tape-editorial.json');
if (fs.existsSync(editorialPath)) {
	parsed.editorial = JSON.parse(fs.readFileSync(editorialPath, 'utf8'));
} else {
	console.error('[warn] no chat-tape-editorial.json — Regulars/Glossary sections will be empty');
}

// </script> inside the JSON would close the tag early and break the page.
const safe = JSON.stringify(parsed, null, 2).replace(/<\//g, '<\\/');

// ── fonts ─────────────────────────────────────────────────────────────────────

function copyFonts(dest) {
	const dRoot = path.join(ROOT, 'digests/d');
	if (!fs.existsSync(dRoot)) return false;
	const donor = fs
		.readdirSync(dRoot)
		.map((slug) => path.join(dRoot, slug, '_app'))
		.find((p) => fs.existsSync(path.join(p, 'fonts.css')) && fs.existsSync(path.join(p, 'fonts')));
	if (!donor) return false;

	const appDir = path.join(dest, '_app');
	fs.mkdirSync(appDir, { recursive: true });
	fs.copyFileSync(path.join(donor, 'fonts.css'), path.join(appDir, 'fonts.css'));
	fs.cpSync(path.join(donor, 'fonts'), path.join(appDir, 'fonts'), { recursive: true });
	return true;
}

// ── write ─────────────────────────────────────────────────────────────────────

const html = fs.readFileSync(TEMPLATE, 'utf8').replace('__DATA__', () => safe);
if (html.includes('__DATA__')) throw new Error('Template placeholder not substituted');

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'index.html'), html);

const fonts = copyFonts(OUT);
if (!fonts) console.error('[warn] no donor _app/fonts found — page will fall back to system fonts');

console.error(
	`[ok] ${path.relative(ROOT, path.join(OUT, 'index.html'))} — ` +
		`${(html.length / 1024).toFixed(0)} KB, ${parsed.people.length} people, fonts=${fonts}`,
);
