import { mkdir, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { appBaseUrl } from '$lib/config/urls.js';
import { buildArchiveRows } from '$lib/dashboard/buildReadModel.js';
import { findLeaks } from '$lib/digest2/publishHtml.js';

const DIGESTS_DIR = process.env.DIGESTS_DIR || '/app/digests';
const INTERNAL_URL = process.env.DIGEST_EXPORT_INTERNAL_URL || `http://localhost:${process.env.PORT || 3002}`;

export interface PortalDigest {
	roundId: number; n: number; season: number; theme: string; date: string;
	winnerSong: string; winnerArtist: string; submitter: string; votes: number; hue: string;
	digestUrl: string | null; digestKind: 'v2' | 'v1' | null;
}
export interface PortalJson {
	version: 1; generatedAt: string;
	seasonFeedUrl: string | null; seasonHubUrl: string | null;
	digests: PortalDigest[];
}

const feedKey = (id: number) => `portal_season_feed_url:${id}`;
const hubKey = (id: number) => `portal_season_hub_url:${id}`;

function readSetting(db: Database.Database, key: string): string | null {
	const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
	return row?.value ? row.value : null;
}

function validHttps(u: string | null): string | null {
	if (u === null || u.trim() === '') return null;
	let parsed: URL;
	try { parsed = new URL(u.trim()); } catch { throw new Error(`invalid url: ${u}`); }
	if (parsed.protocol !== 'https:') throw new Error(`invalid url: ${u}`);
	return parsed.toString();
}

export function getSeasonSettings(db: Database.Database, leagueId: number) {
	return { feedUrl: readSetting(db, feedKey(leagueId)), hubUrl: readSetting(db, hubKey(leagueId)) };
}

export function setSeasonSettings(
	db: Database.Database,
	leagueId: number,
	s: { feedUrl: string | null; hubUrl: string | null }
): void {
	const feed = validHttps(s.feedUrl);
	const hub = validHttps(s.hubUrl);
	const put = db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
	const del = db.prepare('DELETE FROM settings WHERE key = ?');
	db.transaction(() => {
		if (feed) put.run(feedKey(leagueId), feed); else del.run(feedKey(leagueId));
		if (hub) put.run(hubKey(leagueId), hub); else del.run(hubKey(leagueId));
	})();
}

export function buildPortalJson(db: Database.Database, leagueId: number, now = new Date().toISOString()): PortalJson {
	const { feedUrl, hubUrl } = getSeasonSettings(db, leagueId);
	return {
		version: 1,
		generatedAt: now,
		seasonFeedUrl: feedUrl,
		seasonHubUrl: hubUrl,
		digests: buildArchiveRows(db, leagueId).map((r) => ({
			roundId: r.roundId, n: r.n, season: r.season, theme: r.theme, date: r.date,
			winnerSong: r.winnerSong, winnerArtist: r.winnerArtist, submitter: r.submitter,
			votes: r.votes, hue: r.hue, digestUrl: r.digestUrl ?? null, digestKind: r.digestKind
		}))
	};
}

/** Build, leak-check, and atomically write <digestsDir>/<leagueSlug>/portal.json. */
export async function writePortalJson(
	db: Database.Database,
	leagueId: number,
	opts: { digestsDir?: string } = {}
): Promise<{ path: string; digests: number } | null> {
	const site = db.prepare('SELECT slug FROM dashboard_sites WHERE league_id = ?').get(leagueId) as { slug: string } | undefined;
	if (!site) return null;
	const portal = buildPortalJson(db, leagueId);
	const body = JSON.stringify(portal);
	const leaks = findLeaks({
		html: '',
		textAssets: new Map([['portal.json', body]]),
		forbiddenHosts: [new URL(appBaseUrl()).host, new URL(INTERNAL_URL).host]
	});
	if (leaks.length) throw new Error(`portal.json blocked — forbidden host leak:\n${leaks.slice(0, 3).join('\n')}`);
	const dir = join(opts.digestsDir ?? DIGESTS_DIR, site.slug);
	await mkdir(dir, { recursive: true });
	const tmp = join(dir, '.portal.json.tmp');
	const path = join(dir, 'portal.json');
	await writeFile(tmp, body, 'utf8');
	await rename(tmp, path);
	return { path, digests: portal.digests.length };
}
