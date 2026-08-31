#!/usr/bin/env node
/**
 * draw.mjs — one illustration, via OpenRouter image models.
 *
 * OpenRouter has NO video models (checked 2026-08-31: the only output
 * modalities across all 396 models are text, audio and image). So "video" here
 * means stills plus a slow push-in, which is what the spike brief recommended
 * anyway — "a deliberately simple 10-second fake-news clip is more useful than
 * a technically ambitious but cheesy AI movie".
 *
 * Usage:
 *   node draw.mjs --prompt "..." --out assets/foo.png [--model google/gemini-2.5-flash-image]
 *
 * ~4¢ an image on gemini-2.5-flash-image. Skips work if --out already exists.
 *
 * NOTE: never prompt for a likeness of a real player. These are generic
 * courtroom-sketch figures; the comedy comes from the quotes, not from
 * caricaturing someone's face.
 */
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i < 0 ? d : argv[i + 1]; };

const out = arg('out'), prompt = arg('prompt');
if (!out || !prompt) { console.error('need --prompt and --out'); process.exit(1); }
if (fs.existsSync(out) && !argv.includes('--force')) {
	console.log(`${out} (cached)`); process.exit(0);
}

if (!process.env.OPENROUTER_API_KEY) {
	const envPath = new URL('../../../../.env', import.meta.url).pathname;
	for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
		const m = line.match(/^OPENROUTER_API_KEY=(.*)$/);
		if (m) process.env.OPENROUTER_API_KEY = m[1].trim().replace(/^["']|["']$/g, '');
	}
}

const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
	method: 'POST',
	headers: {
		Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
		'Content-Type': 'application/json',
	},
	body: JSON.stringify({
		model: arg('model', 'google/gemini-2.5-flash-image'),
		modalities: ['image', 'text'],
		// --ref lets a real photo drive the likeness while the prompt keeps the
		// output a drawing. That is the whole trick for putting an actual player
		// in a scene without generating photoreal footage of them.
		messages: [{
			role: 'user',
			content: arg('ref')
				? [{ type: 'text', text: prompt },
				   { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${
					   fs.readFileSync(arg('ref')).toString('base64')}` } }]
				: prompt,
		}],
	}),
});

if (!res.ok) { console.error(res.status, await res.text()); process.exit(1); }
const data = await res.json();
const img = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
if (!img) {
	console.error('no image returned:', JSON.stringify(data.choices?.[0]?.message ?? data).slice(0, 300));
	process.exit(1);
}

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.from(img.split(',', 2)[1], 'base64'));
console.log(`${out}  ${(fs.statSync(out).size / 1024).toFixed(0)}KB  $${(data.usage?.cost ?? 0).toFixed(3)}`);
