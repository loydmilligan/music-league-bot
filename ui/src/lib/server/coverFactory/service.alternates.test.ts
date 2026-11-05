import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import { openLeagueDb } from '$lib/db/client.js';
import { insertModel } from '$lib/db/aiModels.js';

vi.mock('./inputs.js', async (orig) => {
	const actual = await orig<typeof import('./inputs.js')>();
	return {
		...actual,
		listPlayers: vi.fn((league: string) =>
			league === 'boarz-ii-men'
				? [{ slug: 'shane', name: 'Shane Smith', leagueSlug: league, headshotRel: 'x', lowRes: false, missing: false }]
				: [],
		),
		listRoundSongs: vi.fn(async () => [
			{ submissionId: 1, title: 'Linoleum', artists: 'NOFX', playerName: 'Shane', playerSlug: 'shane', artUrl: 'https://i.scdn.co/image/abc' },
		]),
	};
});

import { runAction, ApiError, buildExport, parseSongQuery } from './service.js';
import { createProject, getProject, updateProject, insertVersion, listVersions } from './repo.js';
import { COVER_JOB_KEYS } from './models.js';
import { coverFile } from './paths.js';
import { cleanConcepts } from './pitch.js';
import { averageHash } from './alternates.js';
import type { Breakdown } from './breakdown.js';

const db = openLeagueDb(':memory:');
let pid = 0;
let prevData: string | undefined;
let png: Buffer;
const fetchCalls: string[] = [];

const ALTS = [
	{ id: 'rel-1', releaseMbid: 'rel-1', releaseGroupMbid: 'g', title: 'Punk in Drublic', kind: 'Album', date: '1994', country: 'US', thumbUrl: 'https://coverartarchive.org/release/rel-1/front-250', fullUrl: 'https://coverartarchive.org/release/rel-1/front-500' },
	{ id: 'rel-2', releaseMbid: 'rel-2', releaseGroupMbid: 'g', title: 'Punk in Drublic', kind: 'Album', date: '1995', country: 'UK', thumbUrl: 'https://coverartarchive.org/release/rel-2/front-250', fullUrl: 'https://coverartarchive.org/release/rel-2/front-500' },
];
const BREAKDOWN: Breakdown = {
	style: 's', composition: 'c', palette_lighting: 'p', text_elements: [],
	subjects: [{ label: 'A', kind: 'object', role: 'main', position: 'center', pose: '', gaze: '', clothing: '', expression: '', color_treatment: '', focus: 'sharp', box: [0.2, 0.2, 0.6, 0.6] }],
	no_subjects: true,
};
const seed = (id: number, alts = ALTS) =>
	db.prepare('INSERT OR REPLACE INTO cover_alt_cache (key, json, fetched_at) VALUES (?, ?, ?)').run(`project:${id}`, JSON.stringify(alts), new Date().toISOString());

beforeAll(async () => {
	prevData = process.env.DATA_DIR;
	process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'cf-alt-data-'));
	png = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#c9a' } }).png().toBuffer();
	mkdirSync(dirname(coverFile('covers/p.png')), { recursive: true });
	writeFileSync(coverFile('covers/p.png'), png);
});
afterAll(() => { if (prevData === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = prevData; });
beforeEach(() => {
	fetchCalls.length = 0;
	db.exec('DELETE FROM cover_requests; DELETE FROM cover_versions; DELETE FROM cover_projects; DELETE FROM cover_alt_cache; DELETE FROM ai_models;');
	pid = createProject(db, {
		title: 'Linoleum — NOFX', source: 'spotify', round_id: null, spotify_uri: null, league_slug: 'boarz-ii-men',
		cover_rel: 'covers/p.png', cover_url: null, song_title: 'Linoleum', song_artist: 'NOFX', song_album: 'Punk in Drublic',
	}).id;
	vi.stubGlobal('fetch', async (u: string | URL) => {
		const url = String(u);
		fetchCalls.push(url);
		if (url.startsWith('https://coverartarchive.org/')) return new Response(new Uint8Array(png), { status: 200, headers: { 'content-type': 'image/png' } });
		if (url.startsWith('https://i.scdn.co/')) return new Response(new Uint8Array(png), { status: 200, headers: { 'content-type': 'image/png' } });
		return new Response('nope', { status: 404 });
	});
});
afterEach(() => vi.unstubAllGlobals());

const rejects400 = async (p: Promise<unknown>, re: RegExp) => {
	const e = await p.then(() => null, (x) => x);
	expect(e).toBeInstanceOf(ApiError);
	expect((e as ApiError).status).toBe(400);
	expect((e as ApiError).message).toMatch(re);
};

describe('create stores song terms', () => {
	it('round source copies title/artists/album from the submission', async () => {
		db.pragma('foreign_keys = OFF');
		db.exec(`DELETE FROM ml_submissions WHERE id = 1`);
		db.prepare(`INSERT INTO ml_submissions (id, round_id, spotify_uri, title, album, artists, created_at) VALUES (1, 5, 'spotify:track:x', 'Linoleum', 'Punk in Drublic', 'NOFX', datetime('now'))`).run();
		db.pragma('foreign_keys = ON');
		const r = (await runAction(db, { action: 'create', source: 'round', roundId: 5, submissionId: 1 })) as { project: { song_title: string; song_artist: string; song_album: string } };
		expect(r.project).toMatchObject({ song_title: 'Linoleum', song_artist: 'NOFX', song_album: 'Punk in Drublic' });
	});
});

describe('alternates action', () => {
	it('with no stored terms and no q is a 400', async () => {
		const up = createProject(db, { title: 'u', source: 'upload', round_id: null, spotify_uri: null, league_slug: null, cover_rel: 'covers/p.png', cover_url: null });
		await rejects400(runAction(db, { action: 'alternates', projectId: up.id }), /search for the song/i);
	});
	const stored = () => JSON.parse((db.prepare('SELECT json FROM cover_alt_cache WHERE key = ?').get(`project:${pid}`) as { json: string }).json);
	it('q overrides the terms; a no-match result keeps the previously shown list', async () => {
		seed(pid);
		const mb = vi.fn();
		vi.stubGlobal('fetch', async (u: string | URL) => { mb(String(u)); return new Response(JSON.stringify({ 'release-groups': [], recordings: [] }), { status: 200 }); });
		const r = (await runAction(db, { action: 'alternates', projectId: pid, q: 'Juicy — Notorious B.I.G.' })) as { alternates: unknown[]; message: string | null };
		expect(r.alternates).toEqual([]);
		expect(r.message).toMatch(/no alternate/i);
		expect(decodeURIComponent(mb.mock.calls.map((c) => c[0]).join(' '))).toContain('recording:"Juicy"');
		expect(stored().map((a: { id: string }) => a.id)).toEqual(['rel-1', 'rel-2']);
	});
	it('a busy MusicBrainz keeps the previously shown list', async () => {
		seed(pid);
		vi.stubGlobal('fetch', async () => new Response('slow down', { status: 503 }));
		const r = (await runAction(db, { action: 'alternates', projectId: pid })) as { alternates: unknown[]; message: string | null };
		expect(r.message).toMatch(/busy/i);
		expect(stored().map((a: { id: string }) => a.id)).toEqual(['rel-1', 'rel-2']);
	});
	it('a found list replaces the stored one and reports which alternate is the current cover', async () => {
		const key = 'alt:nofx|linoleum|punk in drublic';
		db.prepare('INSERT INTO cover_alt_cache (key, json, fetched_at) VALUES (?, ?, ?)').run(key, JSON.stringify([ALTS[1]]), new Date().toISOString());
		seed(pid);
		await runAction(db, { action: 'use-alternate', projectId: pid, alternateId: 'rel-2' });
		const r = (await runAction(db, { action: 'alternates', projectId: pid })) as { alternates: { id: string }[]; currentId: string | null };
		expect(r.alternates.map((a) => a.id)).toEqual(['rel-2']);
		expect(r.currentId).toBe('rel-2');
		expect(stored().map((a: { id: string }) => a.id)).toEqual(['rel-2']);
		await runAction(db, { action: 'restore-original', projectId: pid });
		const r2 = (await runAction(db, { action: 'alternates', projectId: pid })) as { currentId: string | null };
		expect(r2.currentId).toBeNull();
	});
});

describe('alternates vs the current cover', () => {
	const SONG_KEY = 'alt:nofx|linoleum|punk in drublic';
	let split: Buffer;
	beforeAll(async () => {
		// Left half black, right half white: an average hash far from the flat test cover.
		const half = await sharp({ create: { width: 8, height: 16, channels: 3, background: '#fff' } }).png().toBuffer();
		split = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#000' } }).composite([{ input: half, left: 8, top: 0 }]).png().toBuffer();
	});
	const seedSong = async () => {
		const alts = [{ ...ALTS[0], hash: await averageHash(png) }, { ...ALTS[1], hash: await averageHash(split) }];
		db.prepare('INSERT OR REPLACE INTO cover_alt_cache (key, json, fetched_at) VALUES (?, ?, ?)').run(SONG_KEY, JSON.stringify(alts), new Date().toISOString());
	};
	it('drops the edition that looks like the current cover, and keeps the current alternate listed after a switch', async () => {
		await seedSong();
		const r1 = (await runAction(db, { action: 'alternates', projectId: pid })) as { alternates: { id: string }[]; currentId: string | null };
		expect(r1.alternates.map((a) => a.id)).toEqual(['rel-2']);
		expect(r1.currentId).toBeNull();
		vi.stubGlobal('fetch', async (u: string | URL) => {
			fetchCalls.push(String(u));
			return new Response(new Uint8Array(String(u).includes('rel-2') ? split : png), { status: 200, headers: { 'content-type': 'image/png' } });
		});
		await runAction(db, { action: 'use-alternate', projectId: pid, alternateId: 'rel-2' });
		const r2 = (await runAction(db, { action: 'alternates', projectId: pid })) as { alternates: { id: string }[]; currentId: string | null };
		expect(r2.alternates.map((a) => a.id)).toEqual(['rel-1', 'rel-2']);
		expect(r2.currentId).toBe('rel-2');
	});
	it('an applied alternate concept is reported as current by the next listing', async () => {
		db.prepare('INSERT OR REPLACE INTO cover_alt_cache (key, json, fetched_at) VALUES (?, ?, ?)').run(SONG_KEY, JSON.stringify(ALTS), new Date().toISOString());
		seed(pid);
		updateProject(db, pid, { breakdown_json: JSON.stringify(BREAKDOWN) });
		await runAction(db, { action: 'apply-concept', projectId: pid, concept: { id: 'c-1', move: 'alternate', alternateId: 'rel-2', title: 't', plan: 'p', addSubjects: [], treatments: [] } });
		const r = (await runAction(db, { action: 'alternates', projectId: pid })) as { currentId: string | null };
		expect(r.currentId).toBe('rel-2');
	});
});

describe('song terms', () => {
	it('parseSongQuery splits on the last em dash first, then the last hyphen', () => {
		expect(parseSongQuery('A - B — C')).toEqual({ title: 'A - B', artist: 'C' });
		expect(parseSongQuery('Pays imaginaire - Remix - Polo & Pan')).toEqual({ title: 'Pays imaginaire - Remix', artist: 'Polo & Pan' });
		expect(parseSongQuery('Song — Part 2 — Artist')).toEqual({ title: 'Song — Part 2', artist: 'Artist' });
		expect(parseSongQuery('justatitle')).toBeNull();
	});
	it('a project with no song terms falls back to its "song — artist" title', async () => {
		const up = createProject(db, { title: 'Juicy — Notorious B.I.G.', source: 'upload', round_id: null, spotify_uri: null, league_slug: null, cover_rel: 'covers/p.png', cover_url: null });
		const mb = vi.fn();
		vi.stubGlobal('fetch', async (u: string | URL) => { mb(String(u)); return new Response(JSON.stringify({ 'release-groups': [], recordings: [] }), { status: 200 }); });
		await runAction(db, { action: 'alternates', projectId: up.id });
		expect(decodeURIComponent(mb.mock.calls.map((c) => c[0]).join(' '))).toContain('recording:"Juicy"');
	});
});

describe('per-version source cover', () => {
	it("export of a version made on cover A still wipes from A after switching to B", async () => {
		const v = insertVersion(db, { project_id: pid, model_id: 'm', provider: 'p', prompt: 'x', image_rel: 'covers/p.png', status: 'ok', error_reason: null, cover_rel: 'covers/p.png' });
		seed(pid);
		const sw = (await runAction(db, { action: 'use-alternate', projectId: pid, alternateId: 'rel-1' })) as { project: { cover_rel: string } };
		// Make B unreadable: an export that used the project's current cover would throw.
		updateProject(db, pid, { cover_rel: 'covers/gone.png' });
		expect(sw.project.cover_rel).not.toBe('covers/p.png');
		expect((await buildExport(db, v.id, 'gif')).length).toBeGreaterThan(0);
	});
});

describe('use-alternate / restore-original', () => {
	it('using the alternate already in use is a no-op: no download, read kept', async () => {
		seed(pid);
		await runAction(db, { action: 'use-alternate', projectId: pid, alternateId: 'rel-1' });
		updateProject(db, pid, { breakdown_json: JSON.stringify(BREAKDOWN) });
		const before = getProject(db, pid)!;
		fetchCalls.length = 0;
		const r = (await runAction(db, { action: 'use-alternate', projectId: pid, alternateId: 'rel-1' })) as { project: { cover_rel: string; breakdown_json: string | null }; unchanged: boolean };
		expect(r.unchanged).toBe(true);
		expect(fetchCalls).toEqual([]);
		expect(r.project.cover_rel).toBe(before.cover_rel);
		expect(getProject(db, pid)!.breakdown_json).not.toBeNull();
		const c = (await runAction(db, { action: 'apply-concept', projectId: pid, concept: { id: 'c-9', move: 'alternate', alternateId: 'rel-1', title: 't', plan: 'p', addSubjects: [], treatments: [] } })) as { unchanged: boolean; needsRead: boolean };
		expect(c.unchanged).toBe(true);
		expect(c.needsRead).toBe(false);
		expect(fetchCalls).toEqual([]);
		expect(getProject(db, pid)!.breakdown_json).not.toBeNull();
	});

	it('sets cover_rel, keeps the first original, clears read state, leaves versions alone', async () => {
		seed(pid);
		updateProject(db, pid, { breakdown_json: '{"x":1}', treatments_json: '[]' });
		insertVersion(db, { project_id: pid, model_id: 'm', provider: 'p', prompt: 'x', image_rel: null, status: 'failed', error_reason: 'e' } as never);
		const r1 = (await runAction(db, { action: 'use-alternate', projectId: pid, alternateId: 'rel-1' })) as { project: { cover_rel: string; original_cover_rel: string; breakdown_json: string | null; treatments_json: string | null } };
		expect(r1.project.original_cover_rel).toBe('covers/p.png');
		expect(r1.project.cover_rel).not.toBe('covers/p.png');
		expect(existsSync(coverFile(r1.project.cover_rel))).toBe(true);
		expect(r1.project.breakdown_json).toBeNull();
		expect(r1.project.treatments_json).toBeNull();
		expect(fetchCalls).toEqual(['https://coverartarchive.org/release/rel-1/front-500']);
		const r2 = (await runAction(db, { action: 'use-alternate', projectId: pid, alternateId: 'rel-2' })) as { project: { cover_rel: string; original_cover_rel: string } };
		expect(r2.project.original_cover_rel).toBe('covers/p.png');
		expect(r2.project.cover_rel).not.toBe(r1.project.cover_rel);
		expect(listVersions(db, pid)).toHaveLength(1);
		const back = (await runAction(db, { action: 'restore-original', projectId: pid })) as { project: { cover_rel: string; breakdown_json: string | null } };
		expect(back.project.cover_rel).toBe('covers/p.png');
		expect(back.project.breakdown_json).toBeNull();
	});
	it('unknown alternateId is a 400 and downloads nothing', async () => {
		seed(pid);
		await rejects400(runAction(db, { action: 'use-alternate', projectId: pid, alternateId: 'nope' }), /alternate/i);
		expect(fetchCalls).toEqual([]);
	});
	it('with no stored list is a 400', async () => {
		await rejects400(runAction(db, { action: 'use-alternate', projectId: pid, alternateId: 'rel-1' }), /alternate/i);
	});
	it('restore-original with no original is a 400', async () => {
		await rejects400(runAction(db, { action: 'restore-original', projectId: pid }), /original/i);
	});
});

describe('alternate concepts', () => {
	const names = new Map([['shane', 'Shane Smith']]);
	const raw = (id: string) => ({ concepts: [{ move: 'alternate', alternateId: id, title: 'Ribbed Era', plan: 'Jon as Fat Mike\'s dad on the Ribbed-era cover' }] });
	it('cleanConcepts keeps an alternate concept with a known id (no treatments) and drops an unknown one', () => {
		const kept = cleanConcepts(raw('rel-1'), BREAKDOWN, names, 6, ALTS);
		expect(kept).toHaveLength(1);
		expect(kept[0]).toMatchObject({ move: 'alternate', alternateId: 'rel-1', treatments: [], addSubjects: [] });
		expect(cleanConcepts(raw('zzz'), BREAKDOWN, names, 6, ALTS)).toEqual([]);
		expect(cleanConcepts(raw('rel-1'), BREAKDOWN, names, 6, [])).toEqual([]);
	});
	it('applying an alternate concept switches the cover with only the CAA image GET', async () => {
		seed(pid);
		updateProject(db, pid, { breakdown_json: JSON.stringify(BREAKDOWN) });
		const r = (await runAction(db, { action: 'apply-concept', projectId: pid, concept: { id: 'c-1', move: 'alternate', alternateId: 'rel-2', title: 't', plan: 'p', addSubjects: [], treatments: [] } })) as { project: { cover_rel: string }; needsRead: boolean; breakdown: unknown; treatments: unknown[] };
		expect(r.needsRead).toBe(true);
		expect(r.breakdown).toBeNull();
		expect(r.treatments).toEqual([]);
		expect(r.project.cover_rel).not.toBe('covers/p.png');
		expect(fetchCalls).toEqual(['https://coverartarchive.org/release/rel-2/front-500']);
		expect(getProject(db, pid)!.breakdown_json).toBeNull();
	});
	it('applying an alternate concept with an unknown id is a 400', async () => {
		seed(pid);
		updateProject(db, pid, { breakdown_json: JSON.stringify(BREAKDOWN) });
		await rejects400(runAction(db, { action: 'apply-concept', projectId: pid, concept: { id: 'c-1', move: 'alternate', alternateId: 'zzz', title: 't', plan: 'p', addSubjects: [], treatments: [] } }), /alternate/i);
	});
});
