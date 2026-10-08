import { mkdir, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { appBaseUrl, digestBaseUrl } from '$lib/config/urls.js';
import { buildArchiveRows } from '$lib/dashboard/buildReadModel.js';
import { findLeaks } from '$lib/digest2/publishHtml.js';
import { publicSections, type PublicSections } from '$lib/portalAdmin/config.js';
import { readConfig } from '$lib/portalAdmin/store.js';

const DIGESTS_DIR = process.env.DIGESTS_DIR || '/app/digests';
const INTERNAL_URL = process.env.DIGEST_EXPORT_INTERNAL_URL || `http://localhost:${process.env.PORT || 3002}`;

export interface PortalDigest {
	roundId: number; n: number; season: number; theme: string; date: string;
	winnerSong: string; winnerArtist: string; submitter: string; votes: number; hue: string;
	digestUrl: string | null; digestKind: 'v2' | 'v1' | null;
}
/**
 * Per-round deep links for the Home "Current round" card. URLs and the round
 * number ONLY — no theme, name or credit, so a link can never describe a round
 * the season feed has not revealed. `n` matches the season feed's `round`
 * (both are `rounds.round_number`); a round without one is omitted rather than
 * guessed at. `null` = the link does not exist and the card omits the button.
 */
export interface PortalRoundLinks {
	n: number;
	spotify: string | null;
	ytm: string | null;
	youtube: string | null;
	musicLeague: string | null;
}
export interface PortalJson {
	version: 1; generatedAt: string;
	seasonFeedUrl: string | null; seasonHubUrl: string | null;
	survey: { apiBase: string } | null;
	/** Display config for the b-side; `null` only if the admin config is unreadable. */
	sections: PublicSections | null;
	roundLinks: PortalRoundLinks[];
	digests: PortalDigest[];
	stats: PortalStats | null;
}
export interface PortalStats { updatedAt: string; current: number; seasons: number[] }

const feedKey = (id: number) => `portal_season_feed_url:${id}`;
const hubKey = (id: number) => `portal_season_hub_url:${id}`;
const surveyKey = (id: number) => `portal_survey_key:${id}`;
export const SURVEY_KEY_RE = /^[a-z0-9-]+\/[a-z0-9-]+$/;
export const statsPublishedKey = (id: number) => `portal_stats_published:${id}`;

function readSetting(db: Database.Database, key: string): string | null {
	const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
	return row?.value ? row.value : null;
}

function tableExists(db: Database.Database, name: string): boolean {
	return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(name);
}

type RoundLinkRow = {
	round_id: number; ml_round_id: string; round_number: number; spotify_playlist_url: string | null;
	source_competition_id: string | null; ytm_url: string | null; video_url: string | null;
};

/**
 * URL + round-number rows for deep-link buttons. The YTM tables are created by
 * host-side scripts (`scripts/ytm-drop/run.mjs`, ytm video review), not by
 * `openLeagueDb`, so they are queried only after a sqlite_master check.
 */
export function buildRoundLinks(db: Database.Database, leagueId: number): PortalRoundLinks[] {
	const hasDrops = tableExists(db, 'ytm_drops');
	const hasVideo = tableExists(db, 'ytm_video_reviews');

	const rows = db.prepare(
		`SELECT r.id AS round_id, r.ml_round_id, r.round_number, r.spotify_playlist_url,
		        se.source_competition_id
		 FROM rounds r
		 JOIN seasons se ON se.id = r.season_id
		 WHERE se.league_id = ?
		 ORDER BY se.season_number, r.round_number, r.id`
	).all(leagueId) as Omit<RoundLinkRow, 'ytm_url' | 'video_url'>[];

	const drops = hasDrops
		? (db.prepare('SELECT round_id, ytm_url FROM ytm_drops WHERE league_id = ?').all(leagueId) as Array<{ round_id: number; ytm_url: string | null }>)
		: [];
	const videos = hasVideo
		? (db.prepare('SELECT round_id, video_url FROM ytm_video_reviews WHERE league_id = ?').all(leagueId) as Array<{ round_id: number; video_url: string | null }>)
		: [];
	const ytmByRound = new Map(drops.filter((d) => d.ytm_url).map((d) => [d.round_id, d.ytm_url!]));
	const videoByRound = new Map(videos.filter((v) => v.video_url).map((v) => [v.round_id, v.video_url!]));

	const out: PortalRoundLinks[] = [];
	for (const r of rows) {
		if (r.round_number == null) continue;
		const spotify = r.spotify_playlist_url ?? null;
		const ytm = ytmByRound.get(r.round_id) ?? null;
		const youtube = videoByRound.get(r.round_id) ?? null;
		const musicLeague =
			r.source_competition_id && r.ml_round_id
				? `https://app.musicleague.com/l/${r.source_competition_id}/${r.ml_round_id}/`
				: null;
		// Only rounds some deep link actually exists for. A round that has no
		// playlist yet is either unstarted or was silently dropped by the YTM
		// job; advertising it (plus its ML id) would leak a hidden round.
		if (!spotify && !ytm && !youtube) continue;
		out.push({ n: r.round_number, spotify, ytm, youtube, musicLeague });
	}
	return out;
}

function validHttps(u: string | null): string | null {
	if (u === null || u.trim() === '') return null;
	let parsed: URL;
	try { parsed = new URL(u.trim()); } catch { throw new Error(`invalid url: ${u}`); }
	if (parsed.protocol !== 'https:') throw new Error(`invalid url: ${u}`);
	return parsed.toString();
}

/** The recorded stats publish for a league; anything missing/malformed → null. */
function readStats(db: Database.Database, leagueId: number): PortalStats | null {
	const raw = readSetting(db, statsPublishedKey(leagueId));
	if (!raw) return null;
	try {
		const v = JSON.parse(raw) as Partial<PortalStats>;
		if (typeof v?.updatedAt !== 'string' || typeof v.current !== 'number' || !Array.isArray(v.seasons)) return null;
		if (!v.seasons.every((n) => typeof n === 'number')) return null;
		return { updatedAt: v.updatedAt, current: v.current, seasons: v.seasons };
	} catch {
		return null;
	}
}

export function parseSurveyKey(raw: string | null | undefined): string | null {
	if (raw == null || raw.trim() === '') return null;
	const key = raw.trim();
	if (!SURVEY_KEY_RE.test(key)) throw new Error(`invalid survey key: ${raw}`);
	return key;
}

export function getSeasonSettings(db: Database.Database, leagueId: number) {
	return {
		feedUrl: readSetting(db, feedKey(leagueId)),
		hubUrl: readSetting(db, hubKey(leagueId)),
		surveyKey: readSetting(db, surveyKey(leagueId)),
	};
}

export function setSeasonSettings(
	db: Database.Database,
	leagueId: number,
	s: { feedUrl: string | null; hubUrl: string | null; surveyKey?: string | null }
): void {
	const feed = validHttps(s.feedUrl);
	const hub = validHttps(s.hubUrl);
	const survey = s.surveyKey === undefined ? undefined : parseSurveyKey(s.surveyKey);
	const put = db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
	const del = db.prepare('DELETE FROM settings WHERE key = ?');
	db.transaction(() => {
		if (feed) put.run(feedKey(leagueId), feed); else del.run(feedKey(leagueId));
		if (hub) put.run(hubKey(leagueId), hub); else del.run(hubKey(leagueId));
		if (survey !== undefined) {
			if (survey) put.run(surveyKey(leagueId), survey); else del.run(surveyKey(leagueId));
		}
	})();
}

export function buildPortalJson(db: Database.Database, leagueId: number, now = new Date().toISOString()): PortalJson {
	const { feedUrl, hubUrl, surveyKey: key } = getSeasonSettings(db, leagueId);
	let sections: PublicSections | null;
	try {
		sections = publicSections(readConfig(db, leagueId));
	} catch (e) {
		console.warn('[portal] portal_admin config unreadable; sections omitted', e);
		sections = null;
	}
	return {
		version: 1,
		generatedAt: now,
		seasonFeedUrl: feedUrl,
		seasonHubUrl: hubUrl,
		survey: key ? { apiBase: `${digestBaseUrl()}/api/survey/${key}` } : null,
		sections,
		roundLinks: buildRoundLinks(db, leagueId),
		digests: buildArchiveRows(db, leagueId).map((r) => ({
			roundId: r.roundId, n: r.n, season: r.season, theme: r.theme, date: r.date,
			winnerSong: r.winnerSong, winnerArtist: r.winnerArtist, submitter: r.submitter,
			votes: r.votes, hue: r.hue, digestUrl: r.digestUrl ?? null, digestKind: r.digestKind
		})),
		stats: readStats(db, leagueId)
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
