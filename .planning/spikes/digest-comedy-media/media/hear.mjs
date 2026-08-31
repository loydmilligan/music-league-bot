#!/usr/bin/env node
/**
 * hear.mjs — transcribe/describe an audio clip via OpenRouter (audio INPUT).
 *
 * 42 models on OpenRouter accept audio input; this defaults to gpt-audio-mini,
 * which will both transcribe and characterise delivery if asked.
 *
 * Usage: node hear.mjs <file.wav> [--prompt "..."] [--model ...]
 */
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i < 0 ? d : argv[i + 1]; };
const file = argv[0];
if (!file) { console.error('usage: hear.mjs <file> [--prompt ...]'); process.exit(1); }

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
		model: arg('model', 'openai/gpt-audio-mini'),
		messages: [{
			role: 'user',
			content: [
				{ type: 'text', text: arg('prompt', 'Transcribe this clip exactly, including filler sounds like "uh". Then describe the delivery: pitch, pace, nasality, affect.') },
				{
					type: 'input_audio',
					input_audio: {
						data: fs.readFileSync(file).toString('base64'),
						format: path.extname(file).slice(1),
					},
				},
			],
		}],
	}),
});

const d = await res.json();
if (!res.ok || d.error) { console.error(res.status, JSON.stringify(d).slice(0, 500)); process.exit(1); }
console.log(d.choices[0].message.content);
