import { mkdir, writeFile, rm, rename, stat } from 'node:fs/promises';
import { join, dirname, basename, extname } from 'node:path';
import puppeteer from 'puppeteer-core';
import { getDb } from '$lib/db/client.js';
import { appBaseUrl } from '$lib/config/urls.js';
import { getActiveDraftForRound } from '$lib/digest/llm.js';
import { peekDigest2Slug, newDigest2Slug, recordDigest2Share, touchDigest2Share, digest2ShareUrl } from './shares.js';
import { transformDigest2Html, findLeaks, missingAppAssets } from './publishHtml.js';
import { promotePodiumCovers } from '$lib/server/coverFactory/podium.js';

const EXEC_PATH = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';
export const APP_INTERNAL_URL = process.env.DIGEST_EXPORT_INTERNAL_URL || `http://localhost:${process.env.PORT || 3002}`;
const DIGESTS_DIR = process.env.DIGESTS_DIR || '/app/digests';
const CHROME_UA =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
export const TEXT_EXT = new Set(['.js', '.css', '.json', '.html', '.svg']);

export class Digest2PublishError extends Error {
	constructor(public status: 409 | 422 | 500, message: string) { super(message); }
}

/** Swap a fully-written tmp dir into place; the old copy survives any failure before the swap. */
export async function swapDirAtomically(tmpDir: string, finalDir: string): Promise<void> {
	await stat(join(tmpDir, 'index.html')); // throws if the new copy is incomplete
	const backup = join(dirname(finalDir), '.' + basename(finalDir) + '.old');
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
export async function localizeFonts(html: string, assets: Map<string, Buffer>): Promise<string | null> {
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

export type Digest2Capture = { rawHtml: string; assets: Map<string, Buffer> };

async function capturePuppeteer(roundId: number): Promise<Digest2Capture> {
	const origin = new URL(APP_INTERNAL_URL).origin;
	const browser = await puppeteer.launch({
		executablePath: EXEC_PATH, headless: true,
		args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
	});
	let rawHtml: string;
	const assets = new Map<string, Buffer>();
	const pending: Promise<void>[] = [];
	try {
		// Loads one URL, adding its same-origin /_app/ responses to the shared assets map.
		const load = async (url: string) => {
			const p = await browser.newPage();
			await p.setViewport({ width: 480, height: 1000, deviceScaleFactor: 2 });
			p.on('response', (resp) => {
				pending.push((async () => {
					try {
						if (resp.request().method() !== 'GET' || !resp.ok()) return;
						const u = new URL(resp.url());
						if (u.origin === origin && u.pathname.startsWith('/_app/')) assets.set(u.pathname, await resp.buffer());
					} catch { /* surfaced by the missing-assets check */ }
				})());
			});
			const resp = await p.goto(url, { waitUntil: 'networkidle0', timeout: 45_000 });
			if (!resp || !resp.ok()) throw new Error(`load failed: ${resp?.status() ?? 'no-response'}`);
			const html = await resp.text();
			if (url.includes('view=stats')) {
				// Let lazily-imported chart chunks (e.g. zoom plugin) mount and fetch.
				await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
				await p.waitForNetworkIdle({ idleTime: 500, timeout: 30_000 });
			}
			await Promise.allSettled(pending);
			return html;
		};
		const base = `${APP_INTERNAL_URL}/digest2/${roundId}?share=1`;
		try {
			rawHtml = await load(base);
		} catch (e) {
			throw new Digest2PublishError(500, `render load failed: ${e instanceof Error ? e.message : String(e)}`);
		}
		// The Stats view lazy-imports chunks the Digest view never fetches; capture them too.
		try {
			await load(`${base}&view=stats`);
		} catch (e) {
			throw new Digest2PublishError(500, `stats render failed: ${e instanceof Error ? e.message : String(e)}`);
		}
	} catch (e) {
		if (e instanceof Digest2PublishError) throw e;
		throw new Digest2PublishError(500, `render failed: ${e instanceof Error ? e.message : String(e)}`);
	} finally {
		await browser.close().catch(() => {});
	}
	return { rawHtml, assets };
}

export async function publishDigest2(
	roundId: number,
	deps: {
		capture?: (roundId: number) => Promise<Digest2Capture>;
		localizeFonts?: (html: string, assets: Map<string, Buffer>) => Promise<string | null>;
	} = {}
): Promise<{ slug: string; url: string; files: number; bytes: number; coverWarning?: string }> {
	const db = getDb();
	if (!getActiveDraftForRound(db, roundId)) throw new Digest2PublishError(409, 'No story draft yet — press Generate first.');
	// Share rows are written only once the publish has fully succeeded: a failed attempt leaves no share
	// row. (Cover promotion below does write slot public_url + the podium row before the capture.)
	const slug = peekDigest2Slug(db, roundId) ?? newDigest2Slug();
	const finalDir = join(DIGESTS_DIR, 'd2', slug);
	const tmpDir = join(DIGESTS_DIR, 'd2', `.${slug}.tmp`);

	// Cover Factory: auto podium covers become public digest-host URLs before the capture renders the
	// page. No slot rows (OFF leagues) → no-op. On failure we still capture: if a podium cover is still
	// an app-relative URL the leak gate below blocks the publish (and its message says why).
	let coverWarning: string | undefined;
	try {
		await promotePodiumCovers(db, roundId, DIGESTS_DIR);
	} catch (e) {
		coverWarning = e instanceof Error ? e.message : String(e);
		console.warn('[digest2] podium cover promotion failed', coverWarning);
	}

	const { rawHtml, assets } = await (deps.capture ?? capturePuppeteer)(roundId);

	const fontCss = await (deps.localizeFonts ?? localizeFonts)(rawHtml, assets);
	const indexHtml = transformDigest2Html(rawHtml, { hasLocalFonts: !!fontCss });
	const textAssets = new Map<string, string>();
	for (const [p, buf] of assets) if (TEXT_EXT.has(extname(p))) textAssets.set(p, buf.toString('utf8'));
	if (fontCss) textAssets.set('/_app/fonts.css', fontCss);
	const leaks = findLeaks({
		html: indexHtml,
		textAssets,
		forbiddenHosts: [new URL(appBaseUrl()).host, new URL(APP_INTERNAL_URL).host]
	});
	if (leaks.length) {
		const why = coverWarning ? `\n(${coverWarning} — a podium cover may still be a private app URL)` : '';
		throw new Digest2PublishError(422, `Publish blocked — admin links found:\n${leaks.slice(0, 5).join('\n')}${why}`);
	}

	const missing = missingAppAssets(indexHtml, assets);
	if (missing.length) throw new Digest2PublishError(500, `Publish blocked — missing assets: ${missing.slice(0, 10).join(', ')}`);

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
	const finalSlug = recordDigest2Share(db, roundId, slug);
	touchDigest2Share(db, roundId);
	const result = { slug: finalSlug, url: digest2ShareUrl(finalSlug), files, bytes };
	return coverWarning ? { ...result, coverWarning } : result;
}
