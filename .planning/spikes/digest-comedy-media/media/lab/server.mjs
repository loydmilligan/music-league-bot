#!/usr/bin/env node
/**
 * server.mjs — voice lab. Sliders in the browser, real ffmpeg DSP on the box.
 *
 *   node lab/server.mjs            # then open http://localhost:7788
 *
 * A page can't run ffmpeg, and Web Audio can't do formant-independent pitch
 * shifting, so the browser is just the control surface: it posts params, this
 * shells out to process.py, and streams the mp3 back.
 *
 * POST /render {src, params, words, text?}  → audio/mpeg (+ X-Stats header)
 * POST /say    {text, voice, style}         → renders a fresh TTS take to cache
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MEDIA = path.dirname(HERE);
const CACHE = path.join(HERE, '.cache');
fs.mkdirSync(CACHE, { recursive: true });

// word counts travel with the clip — words/sec is meaningless against the
// wrong script, and the text box is for *new* takes, not the loaded one
const SOURCES = {
	'kazakhstan-v2': ['renders/jon-kazakhstan-v2.mp3', 71],
	'jonified-v2':   ['renders/jon-jonified-v2.mp3', 96],
	'kazakhstan-v1': ['renders/jon-kazakhstan.mp3', 75],
	'jonified-v1':   ['renders/jon-jonified-mashew.mp3', 110],
	'ab-conorline':  ['assets/jon-ref/03-synth-conorline.mp3', 34],
	'ref-matt':      ['assets/jon-ref/00-matt.mp3', 9],
	'ref-conor':     ['assets/jon-ref/01-conor.mp3', 30],
	'ref-mara':      ['assets/jon-ref/02-mara.mp3', 16],
};

const body = req => new Promise(r => { let b = ''; req.on('data', c => b += c); req.on('end', () => r(b)); });
const json = s => { try { return JSON.parse(s); } catch { return {}; } };

http.createServer(async (req, res) => {
	const url = new URL(req.url, 'http://x');

	if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
		res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
		return res.end(fs.readFileSync(path.join(HERE, 'index.html')));
	}

	if (req.method === 'GET' && url.pathname === '/sources') {
		res.writeHead(200, { 'content-type': 'application/json' });
		return res.end(JSON.stringify(SOURCES));
	}

	if (req.method === 'GET' && url.pathname === '/favicon.ico') {
		res.writeHead(204); return res.end();
	}

	// fresh TTS take, so you can audition new copy without leaving the lab
	if (req.method === 'POST' && url.pathname === '/say') {
		const b = json(await body(req));
		const key = crypto.createHash('sha1')
			.update(b.text + (b.voice || '') + (b.style || '')).digest('hex').slice(0, 12);
		const out = path.join(CACHE, `say-${key}.mp3`);
		if (!fs.existsSync(out)) {
			try {
				execFileSync('node', [path.join(MEDIA, 'say.mjs'),
					'--text', b.text, '--out', out, '--voice', b.voice || 'verse',
					'--style', b.style || '', '--model', 'openai/gpt-audio', '--retries', '4'],
					{ stdio: 'pipe' });
			} catch (e) {
				res.writeHead(500, { 'content-type': 'application/json' });
				return res.end(JSON.stringify({ error: String(e.stderr || e).slice(0, 400) }));
			}
		}
		res.writeHead(200, { 'content-type': 'application/json' });
		return res.end(JSON.stringify({ src: `cache:say-${key}.mp3` }));
	}

	if (req.method === 'POST' && url.pathname === '/render') {
		const b = json(await body(req));
		const rel = b.src?.startsWith('cache:')
			? path.join(CACHE, b.src.slice(6))
			: path.join(MEDIA, (SOURCES[b.src] || SOURCES['kazakhstan-v2'])[0]);
		if (!fs.existsSync(rel)) { res.writeHead(404); return res.end('no source'); }

		const out = path.join(CACHE, `r-${crypto.randomBytes(6).toString('hex')}.mp3`);
		let stats = {};
		try {
			const o = execFileSync('python3', [path.join(HERE, 'process.py'),
				'--src', rel, '--out', out, '--words', String(b.words || 0),
				'--json', JSON.stringify(b.params || {})], { encoding: 'utf8' });
			stats = json(o.trim().split('\n').pop());
		} catch (e) {
			res.writeHead(500, { 'content-type': 'application/json' });
			return res.end(JSON.stringify({ error: String(e.stderr || e).slice(0, 500) }));
		}
		const buf = fs.readFileSync(out); fs.unlinkSync(out);
		res.writeHead(200, {
			'content-type': 'audio/mpeg',
			'content-length': buf.length,
			'x-stats': JSON.stringify(stats),
			'access-control-expose-headers': 'x-stats',
		});
		return res.end(buf);
	}

	res.writeHead(404); res.end('nope');
}).listen(7788, () => console.log('voice lab → http://localhost:7788'));
