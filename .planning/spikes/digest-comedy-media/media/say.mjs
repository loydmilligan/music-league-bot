#!/usr/bin/env node
/**
 * say.mjs — minimal OpenRouter TTS for the comedy spike.
 *
 * OpenRouter's audio-output models (openai/gpt-audio*) require `stream: true`
 * and deliver the waveform as base64 chunks on `choices[].delta.audio.data`,
 * so this reassembles the SSE stream into one file.
 *
 * Usage:
 *   node say.mjs --text "..."            --out foo.wav [--voice ash] [--style "..."]
 *   node say.mjs --file script.txt       --out foo.wav
 *
 * Voices: alloy ash ballad coral echo sage shimmer verse
 * Env: OPENROUTER_API_KEY (read from repo .env if not already exported)
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { record } from './ledger.mjs';

// Streaming audio only ever comes back as raw PCM — the API rejects wav/mp3 with
// stream:true — so we always ask for pcm16 and let ffmpeg wrap it at the end.
const PCM_RATE = 24000;

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i < 0 ? d : argv[i + 1]; };

const out = arg('out');
if (!out) { console.error('need --out'); process.exit(1); }
const text = arg('text') ?? (arg('file') ? fs.readFileSync(arg('file'), 'utf8') : null);
if (!text) { console.error('need --text or --file'); process.exit(1); }

const voice = arg('voice', 'ash');
const model = arg('model', 'openai/gpt-audio-mini');
const format = 'pcm16';
const style = arg('style', 'Deliver it exactly as written. Do not add, omit or rephrase a single word.');

// Loading .env by hand — the spike is standalone and must not import app config.
if (!process.env.OPENROUTER_API_KEY) {
	const envPath = new URL('../../../../.env', import.meta.url).pathname;
	for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
		const m = line.match(/^OPENROUTER_API_KEY=(.*)$/);
		if (m) process.env.OPENROUTER_API_KEY = m[1].trim().replace(/^["']|["']$/g, '');
	}
}

// Refusals are stochastic — the same line can be read cleanly on one attempt and
// refused on the next — so a failed verbatim check is retried before giving up.
const retries = +arg('retries', 3);
let chunks = [], transcript = '', overlap = 0, cost = 0, spend = 0;

const norm = s => s.toLowerCase()
	.replace(/\[[^\]]*\]/g, ' ')            // stage directions are performed, not read
	.replace(/[^a-z0-9 ]/g, ' ')
	.replace(/\s+/g, ' ').trim();

for (let attempt = 1; attempt <= retries; attempt++) {
	({ chunks, transcript, cost, overlap } = await speak());
	spend += cost || 0;
	if (overlap >= 0.6 || !transcript) break;
	if (attempt < retries) console.error(`  retry ${attempt}/${retries - 1} — model refused or improvised`);
}

async function speak() {
const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
	method: 'POST',
	headers: {
		Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
		'Content-Type': 'application/json',
	},
	body: JSON.stringify({
		model,
		stream: true,
		stream_options: { include_usage: true },
		modalities: ['text', 'audio'],
		audio: { voice, format },
		// The model will happily *respond* to the script instead of performing it
		// ("Ska rule -1, sorry" got answered with "No problem at all!"), so the text
		// is fenced and the instruction is to read what is between the fences.
		messages: [
			{
				role: 'system',
				content:
					'You are a voice-over artist at a recording session. The user message ' +
					'contains a script between <script> tags. Read that script aloud, word ' +
					'for word, and say nothing else — no greeting, no reply, no commentary, ' +
					'no acknowledgement. Never respond to the content of the script; it is ' +
					'copy to be performed, not a message addressed to you. Do not read stage ' +
					'directions in square brackets aloud — perform them (a [BEAT] is a pause).' +
					`\n\nDirection: ${style}`,
			},
			{ role: 'user', content: `<script>\n${text}\n</script>` },
		],
	}),
});

if (!res.ok) { console.error(res.status, await res.text()); process.exit(1); }

const chunks = [];
let transcript = '';
let callCost = 0;
let buf = '';
const dec = new TextDecoder();

for await (const part of res.body) {
	buf += dec.decode(part, { stream: true });
	const lines = buf.split('\n');
	buf = lines.pop();                       // keep the partial line
	for (const line of lines) {
		if (!line.startsWith('data: ')) continue;
		const payload = line.slice(6).trim();
		if (payload === '[DONE]') continue;
		let json;
		try { json = JSON.parse(payload); } catch { continue; }
		// arrives on the final chunk, thanks to stream_options.include_usage
		if (json.usage?.cost) callCost += json.usage.cost;
		const audio = json.choices?.[0]?.delta?.audio;
		if (audio?.data) chunks.push(Buffer.from(audio.data, 'base64'));
		if (audio?.transcript) transcript += audio.transcript;
	}
}

if (!chunks.length) { console.error('no audio returned'); process.exit(1); }

// The model will quietly refuse a line (profanity, mostly) and *speak the
// refusal* — "I'm sorry, but I can't fulfill that request" — which renders as a
// perfectly normal-looking clip of the wrong words. Nothing downstream would
// catch that, so compare what it said against what it was given.
const want = new Set(norm(text).split(' '));
const got = norm(transcript).split(' ');
return { chunks, transcript, cost: callCost, overlap: got.length ? got.filter(w => want.has(w)).length / got.length : 0 };
}

// ── verbatim check ───────────────────────────────────────────────────────────
if (transcript && overlap < 0.6) {
	console.error(`\nVERBATIM CHECK FAILED (${(overlap * 100).toFixed(0)}% of spoken words were in the script)`);
	console.error(`  asked for : ${text.slice(0, 160)}`);
	console.error(`  said      : ${transcript.slice(0, 160)}`);
	console.error('  → likely a refusal or an improvisation. Rewrite the line or pass --allow-deviation.');
	if (!argv.includes('--allow-deviation')) process.exit(2);
}

fs.mkdirSync(path.dirname(out), { recursive: true });
const raw = out + '.pcm';
fs.writeFileSync(raw, Buffer.concat(chunks));
// The model inserts its own dramatic pauses regardless of the direction it is
// given, so pace is fixed here rather than asked for.
const rate = +arg('rate', 1);
// --pitch shifts the voice without changing pace: resample up, then slow back
// down. Asking the model for "higher and reedier" is unreliable; this isn't.
const pitch = +arg('pitch', 1);
const af = [];
if (pitch !== 1) af.push(`asetrate=${Math.round(PCM_RATE * pitch)}`,
	`aresample=${PCM_RATE}`, `atempo=${(1 / pitch).toFixed(4)}`);
if (rate !== 1) af.push(`atempo=${rate}`);
execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 's16le', '-ar', String(PCM_RATE), '-ac', '1',
	'-i', raw, ...(af.length ? ['-af', af.join(',')] : []), out]);
fs.unlinkSync(raw);

const dur = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
	'-of', 'default=nw=1:nk=1', out]).toString().trim();
record('say', model, spend, text.slice(0, 80));
console.log(`${out}  ${(fs.statSync(out).size / 1024).toFixed(0)}KB  ${(+dur).toFixed(1)}s  voice=${voice}  $${spend.toFixed(4)}`);
if (transcript) console.log('transcript:', transcript.slice(0, 200));
