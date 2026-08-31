#!/usr/bin/env node
/**
 * render.mjs — turns a bit spec into an audio file and (optionally) a video.
 *
 * Per-segment TTS is deliberate: each card gets its own clip, so the card holds
 * for exactly as long as its own line takes to say. One long narration would
 * force us to guess at sync.
 *
 * Usage:
 *   node render.mjs bits/tequila-attack-ad.json            # audio + video
 *   node render.mjs bits/foo.json --audio-only
 *
 * Spec shape:
 *   { id, format, incident, voice, style, width?, height?,
 *     segments: [ { card, say?, hold?, kind? } ] }
 *
 *   card  — text shown on screen (supports \n; `>>` prefixes a verbatim quote line)
 *   say   — what the voice reads; omit for a silent card
 *   hold  — extra seconds to hold after the line lands (default 0.35)
 *   kind  — 'title' | 'quote' | 'body' (default) | 'stat' — styling only
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const specPath = process.argv[2];
if (!specPath) { console.error('usage: render.mjs <spec.json> [--audio-only]'); process.exit(1); }
const audioOnly = process.argv.includes('--audio-only');

const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
const W = spec.width ?? 1280, H = spec.height ?? 720;
const outDir = path.join(HERE, 'out');
const work = path.join(outDir, '.work', spec.id);
fs.mkdirSync(work, { recursive: true });

const sh = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'] }).toString();
const dur = f => +sh('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
	'-of', 'default=nw=1:nk=1', f]).trim();

// ── 1. voice each segment ────────────────────────────────────────────────────
const segs = spec.segments;
console.log(`${spec.id}: ${segs.length} segments`);

for (const [i, s] of segs.entries()) {
	s.wav = path.join(work, `${String(i).padStart(2, '0')}.wav`);
	if (fs.existsSync(s.wav)) { s.dur = dur(s.wav); continue; }   // cache across reruns

	if (!s.say) {
		// silent beat — synthesise the pause rather than voicing it
		const secs = s.hold ?? 1.2;
		sh('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i',
			`anullsrc=r=24000:cl=mono:d=${secs}`, s.wav]);
		s.dur = secs;
		console.log(`  ${i} [silence ${secs}s]`);
		continue;
	}

	sh('node', [path.join(HERE, 'say.mjs'), '--text', s.say, '--out', s.wav,
		'--voice', s.voice ?? spec.voice ?? 'ash', '--style', s.style ?? spec.style ?? '',
		'--rate', String(s.rate ?? spec.rate ?? 1),
		// gpt-audio-mini refuses even mild profanity mid-quote; the full model reads it.
		'--model', s.model ?? spec.model ?? 'openai/gpt-audio-mini',
		'--retries', String(s.retries ?? spec.retries ?? 3)]);
	// pad the tail so cards don't cut on the last syllable
	const pad = s.hold ?? 0.35;
	if (pad > 0) {
		const padded = s.wav.replace('.wav', '-p.wav');
		sh('ffmpeg', ['-y', '-v', 'error', '-i', s.wav, '-af', `apad=pad_dur=${pad}`, padded]);
		fs.renameSync(padded, s.wav);
	}
	s.dur = dur(s.wav);
	console.log(`  ${i} ${s.dur.toFixed(1)}s  ${s.say.slice(0, 60)}`);
}

// ── 2. concatenate the audio ─────────────────────────────────────────────────
const listFile = path.join(work, 'audio.txt');
fs.writeFileSync(listFile, segs.map(s => `file '${s.wav}'`).join('\n'));
const audioOut = path.join(outDir, `${spec.id}.mp3`);
sh('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', listFile,
	'-c:a', 'libmp3lame', '-q:a', '4', audioOut]);
const total = dur(audioOut);
console.log(`audio → ${path.relative(process.cwd(), audioOut)} (${total.toFixed(1)}s)`);

if (audioOnly) process.exit(0);

// ── 3. render one PNG card per segment ───────────────────────────────────────
const esc = t => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const cardHtml = (s, i) => {
	const lines = (s.card ?? '').split('\n');
	const body = lines.map(l => {
		const q = l.startsWith('>>');
		const txt = esc(q ? l.slice(2).trim() : l);
		return `<div class="${q ? 'q' : 'l'}">${txt || '&nbsp;'}</div>`;
	}).join('');
	return `<!doctype html><meta charset="utf-8"><style>
    @page{margin:0}
    html,body{margin:0;padding:0;width:${W}px;height:${H}px;background:#0d0b0a;overflow:hidden}
    body{display:flex;align-items:center;justify-content:center;
         font-family:"DejaVu Sans","Liberation Sans",sans-serif;color:#ece6df}
    .wrap{max-width:${Math.round(W * 0.82)}px;text-align:${s.kind === 'title' ? 'center' : 'left'}}
    .l{font-size:${s.kind === 'title' ? 62 : s.kind === 'stat' ? 54 : 38}px;
       font-weight:${s.kind === 'title' ? 750 : 500};line-height:1.32;
       letter-spacing:${s.kind === 'title' ? '-.02em' : '0'};margin:.16em 0;
       color:${s.kind === 'stat' ? '#e8b04b' : '#ece6df'}}
    .q{font-size:40px;line-height:1.36;margin:.2em 0;color:#7fd1a8;
       font-style:italic;padding-left:.7em;border-left:4px solid #2e6b4f}
  </style><div class="wrap">${body}</div>`;
};

const puppeteer = (await import(path.join(process.cwd(), 'node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js')))
	.default ?? (await import('puppeteer')).default;
const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: W, height: H });

for (const [i, s] of segs.entries()) {
	s.png = path.join(work, `${String(i).padStart(2, '0')}.png`);
	await page.setContent(cardHtml(s, i), { waitUntil: 'load' });
	await page.screenshot({ path: s.png });
}
await browser.close();

// ── 4. mux: each card holds for its own clip's duration ──────────────────────
const vlist = path.join(work, 'video.txt');
fs.writeFileSync(vlist,
	segs.map(s => `file '${s.png}'\nduration ${s.dur.toFixed(3)}`).join('\n') +
	`\nfile '${segs.at(-1).png}'\n`);   // concat demuxer needs the last frame repeated

const videoOut = path.join(outDir, `${spec.id}.mp4`);
sh('ffmpeg', ['-y', '-v', 'error',
	'-f', 'concat', '-safe', '0', '-i', vlist,
	'-i', audioOut,
	'-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '25',
	'-vf', `scale=${W}:${H},format=yuv420p`,
	'-c:a', 'aac', '-b:a', '160k', '-shortest', videoOut]);

console.log(`video → ${path.relative(process.cwd(), videoOut)} (${dur(videoOut).toFixed(1)}s)`);
