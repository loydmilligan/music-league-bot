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
const outDir = path.join(HERE, 'renders');
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

	// a pre-recorded clip (a song snippet, a sting) stands in for the voice
	if (s.clip) {
		sh('ffmpeg', ['-y', '-v', 'error', '-i', path.resolve(HERE, s.clip),
			'-ar', '24000', '-ac', '1', s.wav]);
		s.dur = dur(s.wav);
		console.log(`  ${i} ${s.dur.toFixed(1)}s  [clip ${s.clip}]`);
		continue;
	}

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
		'--pitch', String(s.pitch ?? spec.pitch ?? 1),
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

/** `rows: [[label, value, flag]]` → a round-145-style standings table. */
const boardHtml = rows => `<table class="board">` + rows.map(([a, b, flag]) =>
	`<tr class="${flag ?? ''}"><td>${esc(a)}</td><td class="pts">${esc(b)}</td></tr>`
).join('') + `</table>`;

const cardHtml = s => {
	const lines = (s.card ?? '').split('\n');
	const body = lines.map(l => {
		const q = l.startsWith('>>');
		const txt = esc(q ? l.slice(2).trim() : l);
		return `<div class="${q ? 'q' : 'l'}">${txt || '&nbsp;'}</div>`;
	}).join('');

	// inlined, not file:// — setContent gives the page an about:blank origin and
	// local file requests are blocked, which silently renders a broken-image icon
	const art = s.img
		? `<img class="art" src="data:image/jpeg;base64,${
			fs.readFileSync(path.resolve(HERE, s.img)).toString('base64')}">`
		: '';
	const board = s.board ? boardHtml(s.board) : '';
	const centred = s.kind === 'title' || art || board;

	return `<!doctype html><meta charset="utf-8"><style>
    @page{margin:0}
    html,body{margin:0;padding:0;width:${W}px;height:${H}px;overflow:hidden;
              background:${s.video ? 'transparent' : '#0d0b0a'}}
    body{display:flex;align-items:center;justify-content:center;
         font-family:"DejaVu Sans","Liberation Sans",sans-serif;color:#ece6df}
    .wrap{max-width:${Math.round(W * 0.82)}px;text-align:${centred ? 'center' : 'left'};
          display:flex;flex-direction:column;align-items:center;gap:22px}
    .txt{width:100%;text-align:${centred ? 'center' : 'left'}}
    .l{font-size:${s.kind === 'title' ? 62 : s.kind === 'stat' ? 54 : art || board ? 32 : 38}px;
       font-weight:${s.kind === 'title' ? 750 : 500};line-height:1.32;
       letter-spacing:${s.kind === 'title' ? '-.02em' : '0'};margin:.16em 0;
       color:${s.kind === 'stat' ? '#e8b04b' : '#ece6df'}}
    /* a rubber stamp: ink-red, rotated off-square, roughed at the edges */
    .stamp .l{font-size:140px;font-weight:800;letter-spacing:.06em;color:#c0332b;
       border:9px solid #c0332b;border-radius:8px;padding:14px 46px 20px;
       display:inline-block;transform:rotate(-7deg);opacity:.92;
       text-shadow:0 0 3px #c0332b55}
    .q{font-size:40px;line-height:1.36;margin:.2em 0;color:#7fd1a8;font-style:italic}
    .art{width:300px;height:300px;object-fit:cover;border-radius:10px;
         box-shadow:0 18px 50px #000a}
    /* scene: the illustration fills the frame and the line rides underneath it */
    .scene{position:fixed;inset:0;max-width:none;gap:0}
    .scene .art{position:absolute;inset:0;width:100%;height:100%;border-radius:0;
                box-shadow:none;object-fit:cover;object-position:center 28%}
    .scene .txt{position:absolute;left:0;right:0;bottom:0;padding:34px 60px 40px;
                text-align:center;
                background:linear-gradient(transparent,#0a0806e0 42%,#0a0806f5)}
    .scene .l{font-size:40px;font-weight:600;color:#f4efe8;
              text-shadow:0 2px 14px #000c}
    .scene .q{font-size:40px;color:#a8e6c4;text-shadow:0 2px 14px #000c}
    .board{border-collapse:collapse;font-size:31px;min-width:${Math.round(W * 0.6)}px}
    .board td{padding:11px 20px;border-bottom:1px solid #2e2a28;text-align:left;color:#9b918a}
    .board td.pts{text-align:right;font-variant-numeric:tabular-nums;width:1%;white-space:nowrap}
    .board tr.up td{color:#ece6df}
    .board tr.down td{color:#d3706a;font-weight:650}
  </style><div class="wrap ${s.kind === 'stamp' ? 'stamp' : ''} ${s.kind === 'scene' ? 'scene' : ''}">${art}${
		// a board is a document being entered into evidence — it wants its heading first
		board ? `<div class="txt">${body}</div>${board}` : `${board}<div class="txt">${body}</div>`
	}</div>`;
};

const puppeteer = (await import(path.join(process.cwd(), 'node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js')))
	.default ?? (await import('puppeteer')).default;
const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: W, height: H });

for (const [i, s] of segs.entries()) {
	s.png = path.join(work, `${String(i).padStart(2, '0')}.png`);
	await page.setContent(cardHtml(s), { waitUntil: 'load' });
	if (s.img) await page.evaluate(() => Promise.all(
		[...document.images].map(im => im.complete ? 0 : new Promise(r => { im.onload = im.onerror = r; }))));
	await page.screenshot({ path: s.png, omitBackground: !!s.video });
}
await browser.close();

// ── 4. one clip per card, then concat ────────────────────────────────────────
// Illustrated cards get a slow push-in; text cards stay still, because drifting
// type reads as a screensaver rather than as camera movement.
const FPS = 25;
const clips = segs.map((s, i) => {
	const out = path.join(work, `${String(i).padStart(2, '0')}.mp4`);
	const frames = Math.max(2, Math.round(s.dur * FPS));
	const zoom = s.zoom ?? (s.img ? 1.09 : 0);       // end scale; 0 = locked off

	if (s.video) {
		const src = path.resolve(HERE, s.video);
		const start = s.videoStart ?? 0;
		sh('ffmpeg', ['-y', '-v', 'error',
			'-stream_loop', '-1', '-ss', String(start), '-i', src,
			'-i', s.png, '-t', s.dur.toFixed(3),
			'-filter_complex',
			`[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},`
			+ `colorbalance=rm=0.06:gm=0.02:bm=-0.07,eq=saturation=1.3,fps=${FPS}[bg];`
			+ `[bg][1:v]overlay=0:0:format=auto,format=yuv420p`,
			'-r', String(FPS), '-an',
			'-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', out]);
		return out;
	}

	const vf = zoom
		// zoompan works on the upscaled still so the push stays free of stair-stepping
		? `scale=${W * 2}:${H * 2},zoompan=z='min(1+(${zoom - 1})*on/${frames},${zoom})'`
		  + `:d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`
		  + `:s=${W}x${H}:fps=${FPS},format=yuv420p`
		: `scale=${W}:${H},format=yuv420p`;

	sh('ffmpeg', ['-y', '-v', 'error', '-loop', '1', '-i', s.png,
		'-t', s.dur.toFixed(3), '-vf', vf, '-r', String(FPS),
		'-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', out]);
	return out;
});

const vlist = path.join(work, 'video.txt');
fs.writeFileSync(vlist, clips.map(c => `file '${c}'`).join('\n'));

const videoOut = path.join(outDir, `${spec.id}.mp4`);
sh('ffmpeg', ['-y', '-v', 'error',
	'-f', 'concat', '-safe', '0', '-i', vlist,
	'-i', audioOut,
	'-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', String(FPS),
	'-c:a', 'aac', '-b:a', '160k', '-shortest', videoOut]);

console.log(`video → ${path.relative(process.cwd(), videoOut)} (${dur(videoOut).toFixed(1)}s)`);
