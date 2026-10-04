import { mkdir, writeFile, rm, readdir, cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import puppeteer from 'puppeteer-core';
import { getDb } from '$lib/db/client.js';
import { appBaseUrl } from '$lib/config/urls.js';
import { buildSnapshotCached } from '$lib/server/boarzStats/data.js';
import { STATS_TABS } from '$lib/boarzStats/tabs.js';
import { computeVisibleTabIds } from '$lib/boarzStats/visibleTabs.js';
import { swapDirAtomically, localizeFonts, APP_INTERNAL_URL, TEXT_EXT } from '$lib/digest2/publish.js';
import { transformDigest2Html, findLeaks, missingAppAssets } from '$lib/digest2/publishHtml.js';
import { writePortalJson, statsPublishedKey } from './portalJson.js';

const EXEC_PATH = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';

export type StatsCapture = (urls: string[]) => Promise<{ html: Map<string, string>; assets: Map<string, Buffer> }>;
export interface StatsSeasonResult { number: number; path: string; ok: boolean; error?: string }
export class StatsPublishBusyError extends Error {
	constructor() { super('a stats publish is already running'); }
}

/** Base URL first (its HTML becomes index.html), then one `&tab=` URL per tab so lazy chunks get captured. */
export function statsCaptureUrls(leagueId: number, season: number, depth: 2 | 3, tabIds: string[]): string[] {
	const base = `${APP_INTERNAL_URL}/portal-stats/${leagueId}?season=${season}&depth=${depth}`;
	return [base, ...tabIds.map((id) => `${base}&tab=${encodeURIComponent(id)}`)];
}

/** One browser for the whole URL list; every same-origin /_app/ response is kept (mirrors publish.ts). */
const capturePuppeteer: StatsCapture = async (urls) => {
	const origin = new URL(APP_INTERNAL_URL).origin;
	const browser = await puppeteer.launch({
		executablePath: EXEC_PATH, headless: true,
		args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
	});
	const html = new Map<string, string>();
	const assets = new Map<string, Buffer>();
	const pending: Promise<void>[] = [];
	try {
		for (const url of urls) {
			const p = await browser.newPage();
			await p.setViewport({ width: 1280, height: 900 });
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
			if (!resp || !resp.ok()) throw new Error(`load failed (${resp?.status() ?? 'no-response'}): ${url}`);
			html.set(url, await resp.text());
			// Lazily-imported chart chunks mount on scroll; let them fetch.
			await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
			await p.waitForNetworkIdle({ idleTime: 500, timeout: 30_000 });
			await p.close().catch(() => {});
		}
		await Promise.allSettled(pending);
	} finally {
		await Promise.allSettled(pending);
		await browser.close().catch(() => {});
	}
	return { html, assets };
};

let running = false;

export async function publishLeagueStats(
	leagueId: number,
	deps: { capture?: StatsCapture; digestsDir?: string; localizeFonts?: typeof localizeFonts } = {}
): Promise<{ updatedAt: string; seasons: StatsSeasonResult[] }> {
	if (running) throw new StatsPublishBusyError();
	running = true;
	try {
		const db = getDb();
		const site = db
			.prepare(`SELECT d.slug AS site, l.slug AS league FROM dashboard_sites d JOIN leagues l ON l.id = d.league_id WHERE d.league_id = ?`)
			.get(leagueId) as { site: string; league: string } | undefined;
		if (!site) throw new Error('no b-side site');

		const snapshot = buildSnapshotCached({ leagueSlug: site.league, seasons: 'all' });
		const numbers = snapshot.league.seasons.map((s) => s.number);
		if (numbers.length === 0) return { updatedAt: new Date().toISOString(), seasons: [] };
		const current = snapshot.league.seasons.find((s) => s.status === 'active')?.number ?? Math.max(...numbers);
		const tabIds = computeVisibleTabIds(STATS_TABS, {
			hasChat: snapshot.capabilities.chat, isAllSeasons: false, crossSeasonView: 'combined', omitTabs: []
		});

		const slugDir = join(deps.digestsDir ?? process.env.DIGESTS_DIR ?? '/app/digests', site.site);
		const statsDir = join(slugDir, 'stats');
		// Current first: swapping stats/ replaces the whole folder, so the season folders it holds are
		// carried into the new copy — then each season folder swaps on top of that, independently.
		const targets: { season: number; depth: 2 | 3; dir: string }[] = [
			{ season: current, depth: 2, dir: 'stats' },
			...[...numbers].sort((a, b) => a - b).map((n) => ({ season: n, depth: 3 as const, dir: `stats/s${n}` }))
		];
		const forbiddenHosts = [new URL(appBaseUrl()).host, new URL(APP_INTERNAL_URL).host];
		const results: StatsSeasonResult[] = [];

		for (const t of targets) {
			const isCurrent = t.dir === 'stats';
			// The tmp dir can't live inside stats/ for the stats/ swap itself, so that one is a sibling.
			const tmpDir = isCurrent ? join(slugDir, '.stats.tmp') : join(statsDir, `.s${t.season}.tmp`);
			const finalDir = join(slugDir, t.dir);
			try {
				const urls = statsCaptureUrls(leagueId, t.season, t.depth, tabIds);
				const { html, assets } = await (deps.capture ?? capturePuppeteer)(urls);
				const rawHtml = html.get(urls[0]);
				if (!rawHtml) throw new Error('base page not captured');

				const fontCss = await (deps.localizeFonts ?? localizeFonts)(rawHtml, assets);
				const indexHtml = transformDigest2Html(rawHtml, { hasLocalFonts: !!fontCss });
				const textAssets = new Map<string, string>();
				for (const [p, buf] of assets) if (TEXT_EXT.has(extname(p))) textAssets.set(p, buf.toString('utf8'));
				if (fontCss) textAssets.set('/_app/fonts.css', fontCss);
				const leaks = findLeaks({ html: indexHtml, textAssets, forbiddenHosts });
				if (leaks.length) throw new Error(`leak blocked:\n${leaks.slice(0, 5).join('\n')}`);
				const missing = missingAppAssets(indexHtml, assets);
				if (missing.length) throw new Error(`missing assets: ${missing.slice(0, 10).join(', ')}`);

				await rm(tmpDir, { recursive: true, force: true });
				await mkdir(tmpDir, { recursive: true });
				const write = async (rel: string, data: Buffer | string) => {
					const dest = join(tmpDir, rel);
					await mkdir(dirname(dest), { recursive: true });
					await writeFile(dest, data);
				};
				for (const [p, buf] of assets) await write(p.replace(/^\//, ''), buf);
				if (fontCss) await write('_app/fonts.css', fontCss);
				await write('index.html', indexHtml);
				if (isCurrent) {
					const existing = await readdir(statsDir, { withFileTypes: true }).catch(() => []);
					for (const e of existing) {
						if (e.isDirectory() && /^s\d+$/.test(e.name)) await cp(join(statsDir, e.name), join(tmpDir, e.name), { recursive: true });
					}
				} else {
					await mkdir(statsDir, { recursive: true });
				}
				await swapDirAtomically(tmpDir, finalDir);
				results.push({ number: t.season, path: t.dir, ok: true });
			} catch (e) {
				await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
				results.push({ number: t.season, path: t.dir, ok: false, error: e instanceof Error ? e.message : String(e) });
			}
		}

		const updatedAt = new Date().toISOString();
		// Only advertise stats when stats/ is actually live (this run, or a previous publish).
		const currentLive = results.some((r) => r.ok && r.path === 'stats') || existsSync(join(statsDir, 'index.html'));
		if (currentLive && results.some((r) => r.ok)) {
			const okSeasons = results.filter((r) => r.ok && r.path !== 'stats').map((r) => r.number);
			db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
				.run(statsPublishedKey(leagueId), JSON.stringify({ updatedAt, current, seasons: okSeasons }));
			await writePortalJson(db, leagueId, { digestsDir: deps.digestsDir }).catch((e) =>
				console.warn('[portal] portal.json write failed', e)
			);
		}
		return { updatedAt, seasons: results };
	} finally {
		running = false;
	}
}
