import { mkdir, writeFile, rm, rename, stat } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import puppeteer from 'puppeteer-core';
import { getDb } from '$lib/db/client.js';
import { appBaseUrl } from '$lib/config/urls.js';
import { getActiveDraftForRound } from '$lib/digest/llm.js';
import { getOrCreateDigest2Slug, touchDigest2Share, digest2ShareUrl } from './shares.js';
import { transformDigest2Html, findLeaks } from './publishHtml.js';

const EXEC_PATH = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';
const APP_INTERNAL_URL = process.env.DIGEST_EXPORT_INTERNAL_URL || `http://localhost:${process.env.PORT || 3002}`;
const DIGESTS_DIR = process.env.DIGESTS_DIR || '/app/digests';
const CHROME_UA =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const TEXT_EXT = new Set(['.js', '.css', '.json', '.html', '.svg']);

export class Digest2PublishError extends Error {
	constructor(public status: 409 | 422 | 500, message: string) { super(message); }
}

/** Swap a fully-written tmp dir into place; the old copy survives any failure before the swap. */
export async function swapDirAtomically(tmpDir: string, finalDir: string): Promise<void> {
	await stat(join(tmpDir, 'index.html')); // throws if the new copy is incomplete
	const backup = `${finalDir}.old`;
	await rm(backup, { recursive: true, force: true });
	let hadOld = true;
	try { await rename(finalDir, backup); } catch { hadOld = false; }
	try {
		await rename(tmpDir, finalDir);
	} catch (e) {
		if (hadOld) await rename(backup, finalDir);
		throw e;
	}
	await rm(backup, { recursive: true, force: true });
}

// Forked from 1.0 export.ts localizeFonts (not imported: that module is 1.0-owned).
async function localizeFonts(html: string, assets: Map<string, Buffer>): Promise<string | null> {
	const m = html.match(/https:\/\/fonts\.googleapis\.com\/css2\?[^"'\s]+/);
	if (!m) return null;
	try {
		let css = await (await fetch(m[0].replace(/&amp;/g, '&'), { headers: { 'User-Agent': CHROME_UA } })).text();
		const urls = [...new Set([...css.matchAll(/https:\/\/fonts\.gstatic\.com\/[^)'"]+\.woff2/g)].map((x) => x[0]))];
		let i = 0;
		for (const u of urls) {
			const name = `f${i++}.woff2`;
			assets.set(`/_app/fonts/${name}`, Buffer.from(await (await fetch(u, { headers: { 'User-Agent': CHROME_UA } })).arrayBuffer()));
			css = css.split(u).join(`./fonts/${name}`);
		}
		return css;
	} catch {
		return null;
	}
}

export async function publishDigest2(roundId: number): Promise<{ slug: string; url: string; files: number; bytes: number }> {
	const db = getDb();
	if (!getActiveDraftForRound(db, roundId)) throw new Digest2PublishError(409, 'No story draft yet — press Generate first.');
	const slug = getOrCreateDigest2Slug(db, roundId);
	const finalDir = join(DIGESTS_DIR, 'd2', slug);
	const tmpDir = join(DIGESTS_DIR, 'd2', `.${slug}.tmp`);
	const origin = new URL(APP_INTERNAL_URL).origin;

	const browser = await puppeteer.launch({
		executablePath: EXEC_PATH, headless: true,
		args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
	});
	let rawHtml: string;
	const assets = new Map<string, Buffer>();
	try {
		const page = await browser.newPage();
		await page.setViewport({ width: 480, height: 1000, deviceScaleFactor: 2 });
		page.on('response', async (resp) => {
			try {
				if (resp.request().method() !== 'GET' || !resp.ok()) return;
				const u = new URL(resp.url());
				if (u.origin === origin && u.pathname.startsWith('/_app/')) assets.set(u.pathname, await resp.buffer());
			} catch { /* a single asset capture failure is non-fatal; the leak scan + integration check catch gaps */ }
		});
		const url = `${APP_INTERNAL_URL}/digest2/${roundId}?share=1`;
		const resp = await page.goto(url, { waitUntil: 'networkidle0', timeout: 45_000 });
		if (!resp || !resp.ok()) throw new Digest2PublishError(500, `render load failed: ${resp?.status() ?? 'no-response'}`);
		rawHtml = await resp.text();
	} catch (e) {
		if (e instanceof Digest2PublishError) throw e;
		throw new Digest2PublishError(500, `render failed: ${e instanceof Error ? e.message : String(e)}`);
	} finally {
		await browser.close().catch(() => {});
	}

	const fontCss = await localizeFonts(rawHtml, assets);
	const indexHtml = transformDigest2Html(rawHtml, { hasLocalFonts: !!fontCss });
	const textAssets = new Map<string, string>();
	for (const [p, buf] of assets) if (TEXT_EXT.has(extname(p))) textAssets.set(p, buf.toString('utf8'));
	const leaks = findLeaks({
		html: indexHtml,
		textAssets,
		forbiddenHosts: [new URL(appBaseUrl()).host, new URL(APP_INTERNAL_URL).host]
	});
	if (leaks.length) throw new Digest2PublishError(422, `Publish blocked — admin links found:\n${leaks.slice(0, 5).join('\n')}`);

	await rm(tmpDir, { recursive: true, force: true });
	await mkdir(tmpDir, { recursive: true });
	let bytes = 0, files = 0;
	const write = async (rel: string, data: Buffer | string) => {
		const dest = join(tmpDir, rel);
		await mkdir(dirname(dest), { recursive: true });
		await writeFile(dest, data);
		bytes += typeof data === 'string' ? Buffer.byteLength(data) : data.length;
		files += 1;
	};
	for (const [p, buf] of assets) await write(p.replace(/^\//, ''), buf);
	if (fontCss) await write('_app/fonts.css', fontCss);
	await write('index.html', indexHtml);
	await swapDirAtomically(tmpDir, finalDir);
	touchDigest2Share(db, roundId);
	return { slug, url: digest2ShareUrl(slug), files, bytes };
}
