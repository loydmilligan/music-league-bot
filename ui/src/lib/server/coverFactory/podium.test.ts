import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openLeagueDb } from '$lib/db/client.js';
import { seedLeagues, upsertSeason } from '$lib/db/leagues.js';
import { upsertRound } from '$lib/db/rounds.js';
import { createProject, insertVersion } from './repo.js';
import {
	AUTO_LEAGUES_KEY, applyCoverKeepers, autoLeagues, isAutoLeague, isHandMade, matchSubmission,
	medalItems, setAutoLeague, writePodiumCover,
} from './podium.js';
import { runAction } from './service.js';

let db: Database.Database;
let roundId: number;
let offRoundId: number;

function round(slug: string, ml: string): number {
	const leagueId = (db.prepare('SELECT id FROM leagues WHERE slug = ?').get(slug) as { id: number }).id;
	const seasonId = upsertSeason(db, leagueId, 1, 'active');
	return upsertRound(db, seasonId, { mlRoundId: ml, name: 'R', description: '', spotifyPlaylistUrl: '', createdAt: '2026-01-01T00:00:00Z' });
}
function slot(o: { round?: number; rank: number; title: string; status?: string; note?: string | null; project?: number | null; publicUrl?: string | null; gifRel?: string | null }): number {
	return Number(db.prepare(
		`INSERT INTO cover_podium_slots (round_id, rank, title, project_id, status, note, public_url, gif_rel, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, '2026-11-04T00:00:00Z')`,
	).run(o.round ?? roundId, o.rank, o.title, o.project ?? null, o.status ?? 'done', o.note ?? null, o.publicUrl ?? null, o.gifRel ?? null).lastInsertRowid);
}
function draft(r: number, podium: unknown, id = `d-${r}`): void {
	db.prepare(`INSERT INTO digest_drafts (id, round_id, rel_context, prep_checks, generated_at) VALUES (?, ?, '', '', '2026-11-04T00:00:00Z')`).run(id, r);
	db.prepare(`INSERT INTO digest_sections (id, draft_id, kind, position, state, content_json) VALUES (?, ?, 'podium', 0, 'default', ?)`)
		.run(`${id}-podium`, id, typeof podium === 'string' ? podium : JSON.stringify(podium));
}
const podiumJson = (r: number): string =>
	(db.prepare(`SELECT s.content_json FROM digest_sections s JOIN digest_drafts d ON d.id = s.draft_id WHERE d.round_id = ? AND s.kind = 'podium'`).get(r) as { content_json: string }).content_json;

const SPOT = 'https://i.scdn.co/image/abc';
const PODIUM = {
	title: 'Podium',
	body: 'b',
	items: [
		{ rank: 1, title: 'Chaise Longue', artist: 'Wet Leg', coverUrl: SPOT },
		{ rank: 2, title: 'Two A', artist: 'X', coverUrl: SPOT },
		{ rank: 2, title: 'Two B', artist: 'Y', coverUrl: SPOT },
		{ rank: 4, title: 'Fourth', artist: 'Z', coverUrl: SPOT },
	],
};

beforeEach(() => {
	db = openLeagueDb(':memory:');
	seedLeagues(db);
	roundId = round('boarz-ii-men', 'r-on');
	offRoundId = round('sssc', 'r-off');
});

describe('auto-league settings', () => {
	it('defaults when the key is missing; missing league is false', () => {
		expect(autoLeagues(db)).toEqual({ 'boarz-ii-men': true, 'second-best': true, 'hip-jammers': true });
		expect(isAutoLeague(db, roundId)).toBe(true);
		expect(isAutoLeague(db, offRoundId)).toBe(false);
		expect(isAutoLeague(db, 999999)).toBe(false);
	});
	it('setAutoLeague persists under cover_factory_auto_leagues', () => {
		setAutoLeague(db, 'boarz-ii-men', false);
		setAutoLeague(db, 'sssc', true);
		const raw = (db.prepare('SELECT value FROM settings WHERE key = ?').get(AUTO_LEAGUES_KEY) as { value: string }).value;
		expect(JSON.parse(raw)).toEqual({ 'boarz-ii-men': false, 'second-best': true, 'hip-jammers': true, sssc: true });
		expect(isAutoLeague(db, roundId)).toBe(false);
		expect(isAutoLeague(db, offRoundId)).toBe(true);
	});
});

describe('medalItems', () => {
	it('keeps ranks 1-3 incl. ties, ordered, and excludes rank 4', () => {
		const m = medalItems(PODIUM);
		expect(m.map((x) => [x.index, x.rank, x.title])).toEqual([[0, 1, 'Chaise Longue'], [1, 2, 'Two A'], [2, 2, 'Two B']]);
		expect(m[0]).toEqual({ index: 0, rank: 1, title: 'Chaise Longue', artist: 'Wet Leg', coverUrl: SPOT });
	});
	it('reads place-only and position items, caps at 5, and tolerates junk', () => {
		const m = medalItems({ items: [{ place: 3, title: 'C' }, { place: '1', title: 'A', albumArtUrl: 'u' }, { position: 2, title: 'B' }, null] });
		expect(m.map((x) => [x.rank, x.title, x.coverUrl])).toEqual([[1, 'A', 'u'], [2, 'B', null], [3, 'C', null]]);
		const six = { items: Array.from({ length: 6 }, (_, i) => ({ rank: 1, title: `t${i}` })) };
		expect(medalItems(six)).toHaveLength(5);
		expect(medalItems(null)).toEqual([]);
		expect(medalItems({ items: 'x' })).toEqual([]);
	});
});

describe('matchSubmission', () => {
	it('matches by the same normalized title enrichPodiumArt uses, artist breaking ties', () => {
		db.prepare(`INSERT INTO ml_submissions (id, round_id, spotify_uri, title, artists, created_at) VALUES
			(11, ?, 'u1', 'Chaise Longue!', 'Wet Leg', 'x'), (12, ?, 'u2', 'Home', 'Band A', 'x'), (13, ?, 'u3', 'Home', 'Band B', 'x')`).run(roundId, roundId, roundId);
		const ref = (title: string, artist = '') => ({ index: 0, rank: 1, title, artist, coverUrl: null });
		expect(matchSubmission(db, roundId, ref('chaise longue'))).toBe(11);
		expect(matchSubmission(db, roundId, ref('Home', 'Band B'))).toBe(13);
		expect(matchSubmission(db, roundId, ref('Nope'))).toBeNull();
		expect(matchSubmission(db, offRoundId, ref('Chaise Longue'))).toBeNull();
	});
});

describe('isHandMade', () => {
	it('classifies cover URLs', () => {
		expect(isHandMade('https://digest.mattmariani.com/_media/r182/x.gif', 182)).toBe(true);
		expect(isHandMade('https://i.scdn.co/image/ab67616d0000b273', 182)).toBe(false);
		expect(isHandMade('/api/cover-factory/media/export/9.gif', 182)).toBe(false);
		expect(isHandMade('/api/cover-factory/media/exports/9-ab.gif', 182)).toBe(false);
		expect(isHandMade('https://digest.mattmariani.com/_media/covers/0123abcd/wipe.gif', 182)).toBe(false);
		expect(isHandMade(null, 182)).toBe(false);
	});
});

describe('applyCoverKeepers', () => {
	it('returns the identical object when the round has no slots', () => {
		slot({ round: roundId, rank: 1, title: 'Chaise Longue', gifRel: 'exports/1.gif' }); // another round's slot
		const c = structuredClone(PODIUM);
		expect(applyCoverKeepers(db, offRoundId, c)).toBe(c);
	});
	it('sets done-slot coverUrl (gif_rel, then public_url) and writes _coverNotes/_coverProjects', () => {
		const pid = createProject(db, { title: 'T', source: 'round', round_id: roundId, spotify_uri: null, league_slug: 'boarz-ii-men', cover_rel: 'c.png', cover_url: null }).id;
		slot({ rank: 1, title: 'Chaise Longue', gifRel: 'exports/7-ab.gif', note: 'main replaced', project: pid });
		slot({ rank: 2, title: 'Two B', status: 'failed', note: 'no headshot for Jon' });
		slot({ rank: 2, title: 'Two A', status: 'pending' });
		const c = structuredClone(PODIUM);
		const out = applyCoverKeepers(db, roundId, c);
		expect(out).not.toBe(c);
		expect(c).toEqual(PODIUM); // input not mutated
		expect(out.items.map((i: { coverUrl: string }) => i.coverUrl)).toEqual(['/api/cover-factory/media/exports/7-ab.gif', SPOT, SPOT, SPOT]);
		expect(out._coverNotes).toEqual({ '1': 'main replaced', 'Two B': 'no headshot for Jon' });
		expect(out._coverProjects).toEqual({ '1': pid });

		db.prepare(`UPDATE cover_podium_slots SET public_url = 'https://d/_media/covers/aa/wipe.gif' WHERE rank = 1`).run();
		expect(applyCoverKeepers(db, roundId, c).items[0].coverUrl).toBe('https://d/_media/covers/aa/wipe.gif');
	});
	it('falls back to the keeper export URL and never overwrites a hand-made cover', () => {
		const pid = createProject(db, { title: 'T', source: 'round', round_id: roundId, spotify_uri: null, league_slug: 'boarz-ii-men', cover_rel: 'c.png', cover_url: null }).id;
		const v = insertVersion(db, { project_id: pid, model_id: 'm', provider: 'p', prompt: 'x', image_rel: 'i.png', status: 'ok', error_reason: null });
		db.prepare('UPDATE cover_projects SET keeper_version_id = ? WHERE id = ?').run(v.id, pid);
		slot({ rank: 1, title: 'chaise longue', project: pid });
		slot({ rank: 2, title: 'Two A', gifRel: 'exports/2.gif' });
		const c = structuredClone(PODIUM);
		c.items[1].coverUrl = 'https://digest.mattmariani.com/_media/r182/hand.gif';
		const out = applyCoverKeepers(db, roundId, c);
		expect(out.items[0].coverUrl).toBe(`/api/cover-factory/media/export/${v.id}.gif`);
		expect(out.items[1].coverUrl).toBe('https://digest.mattmariani.com/_media/r182/hand.gif');
	});
});

describe('writePodiumCover', () => {
	it('is a no-op (byte-identical row) for a round without slots', () => {
		const raw = '{ "items": [ {"rank":1,"title":"Chaise Longue","coverUrl":"https://i.scdn.co/x"} ] }';
		draft(offRoundId, raw);
		slot({ rank: 1, title: 'Chaise Longue', gifRel: 'exports/1.gif' }); // another round's slot
		expect(writePodiumCover(db, offRoundId)).toBe(false);
		expect(podiumJson(offRoundId)).toBe(raw);
	});
	it('persists the keeper cover into the active draft and is idempotent', () => {
		draft(roundId, PODIUM);
		slot({ rank: 1, title: 'Chaise Longue', gifRel: 'exports/1.gif' });
		expect(writePodiumCover(db, roundId)).toBe(true);
		expect(JSON.parse(podiumJson(roundId)).items[0].coverUrl).toBe('/api/cover-factory/media/exports/1.gif');
		expect(writePodiumCover(db, roundId)).toBe(false);
	});
});

describe('keeper action re-applies to the draft', () => {
	it('marks the linked slot done and rewrites the podium cover to the new keeper', async () => {
		const pid = createProject(db, { title: 'T', source: 'round', round_id: roundId, spotify_uri: null, league_slug: 'boarz-ii-men', cover_rel: 'c.png', cover_url: null }).id;
		const base = { project_id: pid, model_id: 'm', provider: 'p', prompt: 'x', status: 'ok' as const, error_reason: null };
		const v1 = insertVersion(db, { ...base, image_rel: 'a.png' });
		const v2 = insertVersion(db, { ...base, image_rel: 'b.png' });
		db.prepare('UPDATE cover_projects SET keeper_version_id = ? WHERE id = ?').run(v1.id, pid);
		draft(roundId, PODIUM);
		const sid = slot({ rank: 1, title: 'Chaise Longue', status: 'failed', project: pid, gifRel: 'exports/old.gif', publicUrl: 'https://d/_media/covers/old/wipe.gif' });
		await runAction(db, { action: 'keeper', projectId: pid, versionId: v2.id });
		const s = db.prepare('SELECT status, gif_rel, public_url FROM cover_podium_slots WHERE id = ?').get(sid);
		expect(s).toEqual({ status: 'done', gif_rel: null, public_url: null });
		expect(JSON.parse(podiumJson(roundId)).items[0].coverUrl).toBe(`/api/cover-factory/media/export/${v2.id}.gif`);
	});
	it('leaves unlinked projects and drafts alone', async () => {
		const pid = createProject(db, { title: 'T', source: 'upload', round_id: null, spotify_uri: null, league_slug: null, cover_rel: 'c.png', cover_url: null }).id;
		const v = insertVersion(db, { project_id: pid, model_id: 'm', provider: 'p', prompt: 'x', image_rel: 'a.png', status: 'ok', error_reason: null });
		draft(roundId, PODIUM);
		const before = podiumJson(roundId);
		await runAction(db, { action: 'keeper', projectId: pid, versionId: v.id });
		expect(podiumJson(roundId)).toBe(before);
	});
});
