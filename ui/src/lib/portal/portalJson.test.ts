import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { openLeagueDb } from '$lib/db/client.js';
import { appBaseUrl } from '$lib/config/urls.js';
import { buildPortalJson, writePortalJson, getSeasonSettings, setSeasonSettings } from './portalJson.js';

let db: Database.Database;
function seed() {
	db.exec(`
		INSERT INTO leagues (id, slug, name) VALUES (1, 'bz', 'Boarz'), (2, 'np', 'Nostalgia');
		INSERT INTO seasons (id, league_id, season_number, status) VALUES (10, 1, 1, 'complete'), (11, 1, 2, 'active');
		INSERT INTO rounds (id, season_id, ml_round_id, name, created_at, phase, voting_deadline) VALUES
			(1, 10, 'a', 'Old Round', '2026-01-01', 'complete', '2026-01-08'),
			(2, 11, 'b', 'New Round', '2026-09-01', 'complete', '2026-09-08'),
			(3, 11, 'c', 'Open Round', '2026-09-10', NULL, NULL);
		INSERT INTO digest_shares (round_id, slug) VALUES (1, 'oldv1slug0000000');
		INSERT INTO digest2_shares (round_id, slug) VALUES (2, 'newv2slug0000000');
		INSERT INTO dashboard_sites (slug, league_id, season, read_model, archived_rounds, is_live, published_at, refreshed_at)
			VALUES ('LeagueSlugAAAAAAAAAAAA', 1, 2, '{}', '[]', 1, '2026-01-01', '2026-01-01');
	`);
}
beforeEach(() => { db = openLeagueDb(':memory:'); seed(); });

describe('season settings', () => {
	it('round-trips and clears', () => {
		setSeasonSettings(db, 1, { feedUrl: 'https://s.example/feed.json', hubUrl: 'https://s.example/hub/' });
		expect(getSeasonSettings(db, 1)).toEqual({ feedUrl: 'https://s.example/feed.json', hubUrl: 'https://s.example/hub/' });
		setSeasonSettings(db, 1, { feedUrl: null, hubUrl: null });
		expect(getSeasonSettings(db, 1)).toEqual({ feedUrl: null, hubUrl: null });
	});
	it('rejects non-https urls', () => {
		expect(() => setSeasonSettings(db, 1, { feedUrl: 'http://s.example/f.json', hubUrl: null })).toThrow(/invalid url/);
		expect(() => setSeasonSettings(db, 1, { feedUrl: 'not a url', hubUrl: null })).toThrow(/invalid url/);
	});
});

describe('buildPortalJson', () => {
	it('lists completed rounds across seasons newest first with v2/v1/null links', () => {
		const p = buildPortalJson(db, 1, '2026-10-03T00:00:00Z');
		expect(p.version).toBe(1);
		expect(p.digests.map((d) => [d.roundId, d.digestKind])).toEqual([[2, 'v2'], [1, 'v1']]);
		expect(p.digests[0].digestUrl).toMatch(/\/d2\/newv2slug0000000$/);
		expect(p.digests.find((d) => d.roundId === 3)).toBeUndefined(); // not completed
	});
	it('a round with no share has null link + kind', () => {
		db.exec(`DELETE FROM digest_shares`);
		expect(buildPortalJson(db, 1).digests.find((d) => d.roundId === 1)).toMatchObject({ digestUrl: null, digestKind: null });
	});
	it('carries the season settings', () => {
		setSeasonSettings(db, 1, { feedUrl: 'https://s.example/feed.json', hubUrl: null });
		expect(buildPortalJson(db, 1)).toMatchObject({ seasonFeedUrl: 'https://s.example/feed.json', seasonHubUrl: null });
	});
});

describe('writePortalJson', () => {
	it('writes <dir>/<slug>/portal.json atomically', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'portal-'));
		const res = await writePortalJson(db, 1, { digestsDir: dir });
		expect(res?.digests).toBe(2);
		const body = JSON.parse(await readFile(join(dir, 'LeagueSlugAAAAAAAAAAAA', 'portal.json'), 'utf8'));
		expect(body.digests).toHaveLength(2);
		expect(await readdir(join(dir, 'LeagueSlugAAAAAAAAAAAA'))).toEqual(['portal.json']); // no tmp left
	});
	it('returns null and writes nothing when the league has no b-side site', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'portal-'));
		expect(await writePortalJson(db, 2, { digestsDir: dir })).toBeNull();
		expect(await readdir(dir)).toEqual([]);
	});
	it('refuses to write when the admin host would leak (e.g. via a setting)', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'portal-'));
		const adminHub = `${appBaseUrl()}/hub`;
		db.prepare(`INSERT INTO settings (key, value) VALUES ('portal_season_hub_url:1', ?)`).run(adminHub); // bypass validation
		await expect(writePortalJson(db, 1, { digestsDir: dir })).rejects.toThrow(/admin|leak|forbidden/i);
		expect(await readdir(dir)).toEqual([]);
	});
	it('refuses to write when the internal origin host would leak', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'portal-'));
		const internalHost = new URL(process.env.DIGEST_EXPORT_INTERNAL_URL || `http://localhost:${process.env.PORT || 3002}`).host;
		db.prepare(`INSERT INTO settings (key, value) VALUES ('portal_season_hub_url:1', ?)`).run(`https://${internalHost}/x`); // bypass validation
		await expect(writePortalJson(db, 1, { digestsDir: dir })).rejects.toThrow(/forbidden host leak/);
		expect(await readdir(dir)).toEqual([]);
	});
});
