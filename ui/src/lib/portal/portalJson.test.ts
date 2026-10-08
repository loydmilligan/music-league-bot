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
		expect(getSeasonSettings(db, 1)).toEqual({ feedUrl: 'https://s.example/feed.json', hubUrl: 'https://s.example/hub/', surveyKey: null });
		setSeasonSettings(db, 1, { feedUrl: null, hubUrl: null, surveyKey: null });
		expect(getSeasonSettings(db, 1)).toEqual({ feedUrl: null, hubUrl: null, surveyKey: null });
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
	it('stats is null when no stats publish is recorded', () => {
		expect(buildPortalJson(db, 1).stats).toBeNull();
	});
	it('stats carries the recorded stats publish', () => {
		db.prepare(`INSERT INTO settings (key, value) VALUES ('portal_stats_published:1', ?)`)
			.run(JSON.stringify({ updatedAt: '2026-10-03T03:30:00Z', current: 2, seasons: [1, 2] }));
		expect(buildPortalJson(db, 1).stats).toEqual({ updatedAt: '2026-10-03T03:30:00Z', current: 2, seasons: [1, 2] });
		expect(buildPortalJson(db, 2).stats).toBeNull(); // per league
	});
	it('stats is null when the setting is invalid JSON or the wrong shape', () => {
		const put = db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('portal_stats_published:1', ?)`);
		put.run('{not json');
		expect(buildPortalJson(db, 1).stats).toBeNull();
		put.run(JSON.stringify({ updatedAt: 'x', current: 'two', seasons: [1] }));
		expect(buildPortalJson(db, 1).stats).toBeNull();
	});
	it('carries the season settings', () => {
		setSeasonSettings(db, 1, { feedUrl: 'https://s.example/feed.json', hubUrl: null });
		expect(buildPortalJson(db, 1)).toMatchObject({ seasonFeedUrl: 'https://s.example/feed.json', seasonHubUrl: null, survey: null });
	});
	it('writes survey.apiBase on the digest host from a league/season key', () => {
		setSeasonSettings(db, 1, { feedUrl: null, hubUrl: null, surveyKey: 'boarz/season-2' });
		expect(buildPortalJson(db, 1).survey).toEqual({ apiBase: 'https://digest.mattmariani.com/api/survey/boarz/season-2' });
		expect(() => setSeasonSettings(db, 1, { feedUrl: null, hubUrl: null, surveyKey: 'Nope' })).toThrow(/invalid survey key/);
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

describe('roundLinks', () => {
	it('assembles per-round links from playlist sources + ML, omitting empty rounds', () => {
		db.exec(`UPDATE rounds SET round_number = 1 WHERE id = 1`);
		db.exec(`UPDATE rounds SET round_number = 2, spotify_playlist_url = 'https://open.spotify.com/playlist/abc' WHERE id = 2`);
		db.exec(`UPDATE rounds SET round_number = 3 WHERE id = 3`);
		db.exec(`UPDATE seasons SET source_competition_id = 'comp-1' WHERE id = 11`);
		// Host-side script owns this table (scripts/ytm-drop/run.mjs); the app
		// never creates it, so portal.json must tolerate its absence.
		db.exec(`CREATE TABLE ytm_drops (round_id INTEGER PRIMARY KEY, league_id INTEGER NOT NULL, ytm_url TEXT)`);
		db.prepare(`INSERT INTO ytm_drops (round_id, league_id, ytm_url) VALUES (?, 1, 'https://music.youtube.com/playlist?list=x')`).run(2);
		db.exec(`CREATE TABLE ytm_video_reviews (round_id INTEGER PRIMARY KEY, league_id INTEGER NOT NULL, video_url TEXT)`);
		db.prepare(`INSERT INTO ytm_video_reviews (round_id, league_id, video_url) VALUES (?, 1, 'https://www.youtube.com/playlist?list=v')`).run(2);

		const links = buildPortalJson(db, 1).roundLinks;
		expect(links).toEqual([
			{ n: 2, spotify: 'https://open.spotify.com/playlist/abc',
			  ytm: 'https://music.youtube.com/playlist?list=x',
			  youtube: 'https://www.youtube.com/playlist?list=v',
			  musicLeague: 'https://app.musicleague.com/l/comp-1/b/' }
		]);
	});

	it('skips rounds with no round_number and rounds with no playlist', () => {
		db.exec(`UPDATE rounds SET round_number = 2 WHERE id = 2`);
		const links = buildPortalJson(db, 1).roundLinks;
		// id 3 has a null round_number (survey-less league) AND no playlist.
		expect(links).toEqual([]);
	});

	it('does not emit musicLeague for a round whose only pointer is the ML id', () => {
		db.exec(`UPDATE rounds SET round_number = 2 WHERE id = 2`);
		db.exec(`UPDATE seasons SET source_competition_id = 'comp-1' WHERE id = 11`);
		expect(buildPortalJson(db, 1).roundLinks).toEqual([]);
	});

	it('survives absent host-side tables', () => {
		expect(() => buildPortalJson(db, 1).roundLinks).not.toThrow();
	});
});

describe('portal.json sections', () => {
	it('carries the display subset of the admin config', () => {
		const s = buildPortalJson(db, 1).sections;
		expect(s).toMatchObject({
			thisWeek: { cards: { latestDigest: true, currentRound: true, openPolls: true, themeSurvey: true }, links: { spotify: true, ytm: true, youtube: true, musicLeague: true } },
			byNumbers: { kpis: ['songs', 'points', 'winners', 'noteWords'] },
			family: { excluded: [] },
			enabled: { byNumbers: true, family: true, moments: true, pulse: true, thisWeek: true, yearbook: true }
		});
		const json = JSON.stringify(s);
		expect(json).not.toContain('prompt');
		expect(json).not.toContain('runState');
		expect(json).not.toContain('frequency');
	});

	it('reflects saved exclusions and card toggles', () => {
		db.prepare(`INSERT INTO settings (key, value) VALUES ('portal_admin_config:1', ?)`).run(JSON.stringify(
			{ version: 1, runState: {}, sections: { thisWeek: { enabled: true, frequency: 'on-event', cards: { latestDigest: false, currentRound: true, openPolls: true, themeSurvey: true }, links: { spotify: true, ytm: false, youtube: false, musicLeague: false } }, byNumbers: { enabled: true, frequency: 'daily', kpis: ['songs'] }, pulse: { enabled: true, frequency: 'weekly', prompt: 'SURPRISE PROMPT' }, yearbook: { enabled: false, frequency: 'on-event', season: null }, family: { enabled: true, frequency: 'weekly', players: { m1: false } }, moments: { enabled: true, frequency: 'on-event', prompt: null } } }
		));
		const s = buildPortalJson(db, 1).sections!;
		expect(s).toMatchObject({ thisWeek: { cards: { latestDigest: false } }, byNumbers: { kpis: ['songs'] }, family: { excluded: ['m1'] }, enabled: { yearbook: false } });
		expect(JSON.stringify(s)).not.toContain('SURPRISE PROMPT');
	});

	it('a corrupt config row yields defaults, never a throw', () => {
		db.prepare(`INSERT INTO settings (key, value) VALUES ('portal_admin_config:1', '{not json')`).run();
		expect(() => buildPortalJson(db, 1)).not.toThrow();
		expect(buildPortalJson(db, 1).sections?.enabled.byNumbers).toBe(true);
	});
});

describe('roundLinks leak guard', () => {
	it('refuses to write when a playlist url points at a forbidden host', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'portal-roundlinks-'));
		db.exec(`UPDATE rounds SET round_number = 1, spotify_playlist_url = '${appBaseUrl()}/open/leak' WHERE id = 1`);
		await expect(writePortalJson(db, 1, { digestsDir: dir })).rejects.toThrow(/forbidden host leak|blocked|leak/i);
	});
});
