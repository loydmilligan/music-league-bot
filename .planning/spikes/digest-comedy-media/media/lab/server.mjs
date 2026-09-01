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
import os from 'node:os';
import { totals } from '../ledger.mjs';

// HOST=0.0.0.0 puts it on the LAN — handy for listening on a phone. Note that
// /say spends money, so only do that on a network you trust.
const HOST = process.env.HOST || '127.0.0.1';
const PORT = +(process.env.PORT || 7788);
// Hard spend ceiling for the whole spike. Enforced here rather than by greying
// the button, because a disabled button stops nobody — not another tab, not a
// second phone, not curl.
const CAP = +(process.env.CAP || 3);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MEDIA = path.dirname(HERE);
const CACHE = path.join(HERE, '.cache');
fs.mkdirSync(CACHE, { recursive: true });

// the key is needed for /cost and for fresh takes
if (!process.env.OPENROUTER_API_KEY) {
	for (const line of fs.readFileSync(path.join(MEDIA, '../../../../.env'), 'utf8').split('\n')) {
		const m = line.match(/^OPENROUTER_API_KEY=(.*)$/);
		if (m) process.env.OPENROUTER_API_KEY = m[1].trim().replace(/^["']|["']$/g, '');
	}
}

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

	// /m is the phone build; / stays the desktop one, untouched. Phones that hit
	// / get redirected once so a bookmark keeps working.
	if (req.method === 'GET' && (url.pathname === '/m' || url.pathname === '/mobile')) {
		res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
		return res.end(fs.readFileSync(path.join(HERE, 'mobile.html')));
	}

	if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
		const ua = req.headers['user-agent'] || '';
		if (/Android|iPhone|iPod|Mobile/i.test(ua) && !url.searchParams.has('desktop')) {
			res.writeHead(302, { location: '/m' }); return res.end();
		}
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

	// only what this tool has spent. The key's overall balance is deliberately
	// not served — nothing renders it, and this listens on the LAN.
	if (req.method === 'GET' && url.pathname === '/cost') {
		const t = totals();
		res.writeHead(200, { 'content-type': 'application/json' });
		return res.end(JSON.stringify({
			spike: { total: t.total, last: t.last?.cost ?? null },
			cap: CAP, remaining: Math.max(0, CAP - t.total), capped: t.total >= CAP,
		}));
	}

	// fresh TTS take, so you can audition new copy without leaving the lab
	if (req.method === 'POST' && url.pathname === '/say') {
		const b = json(await body(req));
		const spent = totals().total;
		if (spent >= CAP) {
			res.writeHead(402, { 'content-type': 'application/json' });
			return res.end(JSON.stringify({
				error: `Spend cap reached — $${spent.toFixed(2)} of $${CAP.toFixed(2)}. ` +
					`Raise it with CAP=<n> when starting the server.`, capped: true }));
		}
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
}).listen(PORT, HOST, () => {
	console.log(`voice lab → http://localhost:${PORT}`);
	if (HOST === '0.0.0.0') {
		for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
			for (const a of addrs || []) {
				if (a.family === 'IPv4' && !a.internal) console.log(`         → http://${a.address}:${PORT}  (${name})`);
			}
		}
	}
});
