import { describe, it, expect, beforeEach, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { openLeagueDb } from '$lib/db/client.js';
import { appBaseUrl } from '$lib/config/urls.js';

let db: Database.Database;
vi.mock('$lib/db/client.js', async (orig) => ({ ...(await orig<typeof import('$lib/db/client.js')>()), getDb: () => db }));
const snapshotFor = vi.fn();
vi.mock('$lib/server/boarzStats/data.js', () => ({ buildSnapshotCached: (sel: unknown) => snapshotFor(sel) }));

const { publishLeagueStats, statsCaptureUrls, StatsPublishBusyError } = await import('./statsPublish.js');

const SLUG = 'LeagueSlugAAAAAAAAAAAA';
const seasonOf = (url: string) => Number(new URL(url).searchParams.get('season'));
const page = (season: number, extra = '') =>
	`<html><head></head><body><script src="../_app/x.js"></script>S${season}${extra}</body></html>`;

/** Fake capture: per-URL HTML + the one asset it references; records every call's URLs. */
function fakeCapture(htmlFor: (url: string) => string = (u) => page(seasonOf(u))) {
	const calls: string[][] = [];
	const capture = async (urls: string[]) => {
		calls.push(urls);
		return {
			html: new Map(urls.map((u) => [u, htmlFor(u)])),
			assets: new Map([['/_app/x.js', Buffer.from('console.log(1)')]])
		};
	};
	return { capture, calls };
}
const noFonts = async () => null;

let dir: string;
beforeEach(async () => {
	db = openLeagueDb(':memory:');
	db.exec(`
		INSERT INTO leagues (id, slug, name) VALUES (1, 'bz', 'Boarz'), (2, 'np', 'Nostalgia');
		INSERT INTO seasons (id, league_id, season_number, status) VALUES (10, 1, 1, 'complete'), (11, 1, 2, 'active');
		INSERT INTO dashboard_sites (slug, league_id, season, read_model, archived_rounds, is_live, published_at, refreshed_at)
			VALUES ('${SLUG}', 1, 2, '{}', '[]', 1, '2026-01-01', '2026-01-01');
	`);
	snapshotFor.mockReset();
	snapshotFor.mockReturnValue({
		league: { seasons: [{ number: 1, status: 'complete' }, { number: 2, status: 'active' }] },
		capabilities: { chat: true, deepRatings: false }
	});
	dir = await mkdtemp(join(tmpdir(), 'portal-stats-'));
});

const read = (rel: string) => readFile(join(dir, SLUG, rel), 'utf8');
const setting = () =>
	(db.prepare(`SELECT value FROM settings WHERE key = 'portal_stats_published:1'`).get() as { value: string } | undefined)?.value;

describe('statsCaptureUrls', () => {
	it('base url first, then one &tab= url per tab id', () => {
		const urls = statsCaptureUrls(7, 3, 3, ['songs', 'chat']);
		expect(urls.map((u) => u.replace(/^.*\/portal-stats/, '/portal-stats'))).toEqual([
			'/portal-stats/7?season=3&depth=3',
			'/portal-stats/7?season=3&depth=3&tab=songs',
			'/portal-stats/7?season=3&depth=3&tab=chat'
		]);
	});
});

describe('publishLeagueStats', () => {
	it('publishes stats/ (current) + stats/s<N>/ for every season, records the setting and portal.json', async () => {
		const { capture } = fakeCapture();
		const res = await publishLeagueStats(1, { capture, digestsDir: dir, localizeFonts: noFonts });
		expect(res.seasons.every((s) => s.ok)).toBe(true);
		expect(res.seasons).toHaveLength(3);
		expect(await read('stats/index.html')).toContain('S2');
		expect(await read('stats/s1/index.html')).toContain('S1');
		expect(await read('stats/s2/index.html')).toContain('S2');
		expect(await read('stats/s1/index.html')).toContain('./_app/x.js'); // transformed
		expect(await read('stats/s1/_app/x.js')).toBe('console.log(1)');
		const s = JSON.parse(setting()!);
		expect(s.current).toBe(2);
		expect([...s.seasons].sort()).toEqual([1, 2]);
		expect(s.updatedAt).toBe(res.updatedAt);
		const portal = JSON.parse(await read('portal.json'));
		expect(portal.stats.current).toBe(2);
		expect(snapshotFor).toHaveBeenCalledWith({ leagueSlug: 'bz', seasons: 'all' });
	});

	it('the current season is published at depth 2, season folders at depth 3', async () => {
		const { capture, calls } = fakeCapture();
		await publishLeagueStats(1, { capture, digestsDir: dir, localizeFonts: noFonts });
		const bases = calls.map((urls) => urls[0].replace(/^.*\/portal-stats/, '/portal-stats'));
		expect(bases.sort()).toEqual([
			'/portal-stats/1?season=1&depth=3',
			'/portal-stats/1?season=2&depth=2',
			'/portal-stats/1?season=2&depth=3'
		]);
	});

	it('captures one &tab= url per visible tab, including chat when the league has chat', async () => {
		const { capture, calls } = fakeCapture();
		await publishLeagueStats(1, { capture, digestsDir: dir, localizeFonts: noFonts });
		const tabs = calls[0].slice(1).map((u) => new URL(u).searchParams.get('tab'));
		expect(tabs).toEqual(['leaderboard', 'songs', 'artists', 'heatmap', 'votesgiven', 'playlist', 'chat', 'fun', 'wrapped']);
	});

	it('omits the chat tab when the league has no chat', async () => {
		snapshotFor.mockReturnValue({
			league: { seasons: [{ number: 1, status: 'active' }] },
			capabilities: { chat: false, deepRatings: false }
		});
		const { capture, calls } = fakeCapture();
		await publishLeagueStats(1, { capture, digestsDir: dir, localizeFonts: noFonts });
		const tabs = calls[0].slice(1).map((u) => new URL(u).searchParams.get('tab'));
		expect(tabs).not.toContain('chat');
		expect(tabs).toContain('songs');
	});

	it('a leak in one season blocks only that season; others still swap', async () => {
		const host = new URL(appBaseUrl()).host;
		const { capture } = fakeCapture((u) => page(seasonOf(u), seasonOf(u) === 1 ? ` ${host}` : ''));
		const res = await publishLeagueStats(1, { capture, digestsDir: dir, localizeFonts: noFonts });
		const s1 = res.seasons.find((s) => s.path === 'stats/s1')!;
		expect(s1.ok).toBe(false);
		expect(s1.error).toMatch(/forbidden host/);
		expect(res.seasons.filter((s) => s.ok)).toHaveLength(2);
		expect(existsSync(join(dir, SLUG, 'stats', 's1'))).toBe(false);
		expect(await read('stats/s2/index.html')).toContain('S2');
		expect(JSON.parse(setting()!).seasons).toEqual([2]);
	});

	it('a failed season leaves its previous copy live, even across the current-season swap of stats/', async () => {
		await mkdir(join(dir, SLUG, 'stats', 's1'), { recursive: true });
		await writeFile(join(dir, SLUG, 'stats', 's1', 'index.html'), 'OLD');
		await writeFile(join(dir, SLUG, 'stats', 'index.html'), 'OLDCURRENT');
		const host = new URL(appBaseUrl()).host;
		const { capture } = fakeCapture((u) => page(seasonOf(u), seasonOf(u) === 1 ? ` ${host}` : ''));
		await publishLeagueStats(1, { capture, digestsDir: dir, localizeFonts: noFonts });
		expect(await read('stats/s1/index.html')).toBe('OLD');
		expect(await read('stats/index.html')).toContain('S2');
	});

	it('a missing referenced asset fails that target', async () => {
		const { capture } = fakeCapture((u) => page(seasonOf(u), seasonOf(u) === 1 ? '<script src="../_app/missing.js"></script>' : ''));
		const res = await publishLeagueStats(1, { capture, digestsDir: dir, localizeFonts: noFonts });
		expect(res.seasons.find((s) => s.path === 'stats/s1')).toMatchObject({ ok: false, error: expect.stringMatching(/missing/) });
	});

	it('a concurrent second call is rejected while the first is running', async () => {
		let release!: () => void;
		const gate = new Promise<void>((r) => { release = r; });
		const { capture: inner } = fakeCapture();
		const capture = async (urls: string[]) => { await gate; return inner(urls); };
		const first = publishLeagueStats(1, { capture, digestsDir: dir, localizeFonts: noFonts });
		await expect(publishLeagueStats(1, { capture, digestsDir: dir, localizeFonts: noFonts })).rejects.toBeInstanceOf(StatsPublishBusyError);
		release();
		await first;
		// lock released afterwards
		const { capture: again } = fakeCapture();
		await expect(publishLeagueStats(1, { capture: again, digestsDir: dir, localizeFonts: noFonts })).resolves.toBeTruthy();
	});

	it('rejects a league without a b-side site (and releases the lock)', async () => {
		const { capture } = fakeCapture();
		await expect(publishLeagueStats(2, { capture, digestsDir: dir, localizeFonts: noFonts })).rejects.toThrow(/no b-side site/);
		await expect(publishLeagueStats(1, { capture, digestsDir: dir, localizeFonts: noFonts })).resolves.toBeTruthy();
	});

	it('records nothing when every target fails', async () => {
		const host = new URL(appBaseUrl()).host;
		const { capture } = fakeCapture((u) => page(seasonOf(u), host));
		const res = await publishLeagueStats(1, { capture, digestsDir: dir, localizeFonts: noFonts });
		expect(res.seasons.some((s) => s.ok)).toBe(false);
		expect(setting()).toBeUndefined();
		expect(existsSync(join(dir, SLUG, 'portal.json'))).toBe(false);
	});
});
