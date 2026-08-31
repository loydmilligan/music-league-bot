#!/usr/bin/env node
/**
 * film.mjs — generate a video shot via OpenRouter's async video endpoint.
 *
 * NOTE for anyone reading the catalogue: video models do NOT appear in
 * `GET /api/v1/models`. You have to ask for them:
 *     GET /api/v1/models?output_modalities=video      → 27 models
 * and they are driven by a different endpoint from chat —
 *     POST /api/v1/videos  → { polling_url }, then poll until it completes.
 *
 * Usage:
 *   node film.mjs --prompt "..." --out assets/shot.mp4 [--model kwaivgi/kling-v3.0-std]
 *   node film.mjs --prompt "..." --image assets/sk-witness.png --out assets/shot.mp4
 *
 * --image is the interesting mode: it animates one of our own courtroom
 * sketches, so the shot keeps the drawn look instead of turning into photoreal
 * footage of a real league member. Prefer it.
 */
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i < 0 ? d : argv[i + 1]; };

const out = arg('out'), prompt = arg('prompt');
if (!out || !prompt) { console.error('need --prompt and --out'); process.exit(1); }
if (fs.existsSync(out) && !argv.includes('--force')) { console.log(`${out} (cached)`); process.exit(0); }

if (!process.env.OPENROUTER_API_KEY) {
	const envPath = new URL('../../../../.env', import.meta.url).pathname;
	for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
		const m = line.match(/^OPENROUTER_API_KEY=(.*)$/);
		if (m) process.env.OPENROUTER_API_KEY = m[1].trim().replace(/^["']|["']$/g, '');
	}
}
const KEY = process.env.OPENROUTER_API_KEY;
const H = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

const body = { model: arg('model', 'kwaivgi/kling-v3.0-std'), prompt };
if (arg('image')) {
	const p = path.resolve(arg('image'));
	const ext = path.extname(p).slice(1).replace('jpg', 'jpeg');
	body.image_url = `data:image/${ext};base64,${fs.readFileSync(p).toString('base64')}`;
}
// 1080p bills at ~2x 720p ($0.125/s vs $0.063/s) and the render pipeline is
// 1280x720 anyway, so never generate taller than we use.
if (arg('size')) body.size = arg('size');
if (arg('resolution')) body.resolution = arg('resolution');
if (arg('seconds')) body.seconds = +arg('seconds');
if (arg('seed')) body.seed = +arg('seed');

const submit = await fetch('https://openrouter.ai/api/v1/videos', {
	method: 'POST', headers: H, body: JSON.stringify(body),
});
const job = await submit.json();
if (!submit.ok) { console.error(submit.status, JSON.stringify(job).slice(0, 700)); process.exit(1); }

const poll = job.polling_url ?? job.data?.polling_url;
if (!poll) { console.error('no polling_url:', JSON.stringify(job).slice(0, 700)); process.exit(1); }
console.log(`submitted ${body.model}${body.image_url ? ' (image-to-video)' : ''} …`);

const deadline = Date.now() + 10 * 60_000;
let url, cost;
while (Date.now() < deadline) {
	await new Promise(r => setTimeout(r, 6000));
	const res = await fetch(poll, { headers: { Authorization: `Bearer ${KEY}` } });
	const st = await res.json();
	const status = st.status ?? st.data?.status;
	const err = st.error ?? st.data?.error;
	if (err) { console.error('failed:', JSON.stringify(err).slice(0, 500)); process.exit(1); }
	// the completed job returns `unsigned_urls`, which need the key to fetch
	url = st.unsigned_urls?.[0] ?? st.data?.unsigned_urls?.[0] ??
		st.video?.url ?? st.output?.[0]?.url ?? st.videos?.[0]?.url;
	if (url) cost = st.usage?.cost ?? st.data?.usage?.cost;
	if (url) break;
	if (status && !['pending', 'processing', 'queued', 'running', 'in_progress'].includes(status)) {
		console.error('unexpected status:', JSON.stringify(st).slice(0, 600)); process.exit(1);
	}
	process.stdout.write('.');
}
console.log();
if (!url) { console.error('timed out'); process.exit(1); }

const vid = await fetch(url, { headers: { Authorization: `Bearer ${KEY}` } });
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.from(await vid.arrayBuffer()));
console.log(`${out}  ${(fs.statSync(out).size / 1024 / 1024).toFixed(1)}MB  $${(cost ?? 0).toFixed(2)}`);
