import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import type Database from 'better-sqlite3';
import { openLeagueDb } from '$lib/db/client.js';
import { insertModel } from '$lib/db/aiModels.js';
import { seedLeagues, upsertSeason } from '$lib/db/leagues.js';
import { upsertRound } from '$lib/db/rounds.js';
import type { FetchLike } from '../avatarFactory/openrouter.js';

let png: Buffer;

vi.mock('./inputs.js', async (orig) => {
	const actual = await orig<typeof import('./inputs.js')>();
	return {
		...actual,
		listPlayers: vi.fn((league: string) =>
			league === 'boarz-ii-men'
				? [
						{ slug: 'shane', name: 'Shane Smith', leagueSlug: league, headshotRel: 'x', lowRes: false, missing: false },
						{ slug: 'nohead', name: 'No Head', leagueSlug: league, headshotRel: null, lowRes: false, missing: true },
					]
				: [],
		),
		loadHeadshot: vi.fn(async (_pid: number, p: { slug: string }) => (p.slug === 'shane' ? png : null)),
		submitterOfSubmission: vi.fn((_db: unknown, id: number) =>
			id === 2 ? { slug: 'nohead', name: 'No Head' } : { slug: 'shane', name: 'Shane Smith' },
		),
	};
});

import { runSlot, roundSpend, reclaimStaleSlots } from './autoRun.js';
import { createProject, getProject, listVersions, logRequest } from './repo.js';
import { COVER_JOB_KEYS } from './models.js';
import { coverFile } from './paths.js';
import { IDENTITY_PROMPT } from './breakdown.js';

const SPOT = 'https://i.scdn.co/image/abc';
const subj = (o: Record<string, unknown>) => ({ position: 'center', pose: '', gaze: '', clothing: '', expression: '', color_treatment: '', focus: 'sharp', ...o });
const PERSON = { style: 's', composition: 'c', palette_lighting: 'p', text_elements: [], subjects: [subj({ label: 'A', kind: 'person', role: 'main' }), subj({ label: 'B', kind: 'object', role: 'background' })] };
const OBJECT = { style: 's', composition: 'c', palette_lighting: 'p', text_elements: [], subjects: [subj({ label: 'A', kind: 'object', role: 'main' })] };
const CONCEPTS = {
	concepts: [
		{ move: 'morph', title: 'Cube Shane', plan: "Shane's face as the cube", treatments: [{ label: 'A', mode: 'player', playerSlug: 'shane', notes: 'the cube becomes his face' }], addSubjects: [] },
		{ move: 'recast', title: 'Other', plan: 'x', treatments: [{ label: 'A', mode: 'player', playerSlug: 'shane' }], addSubjects: [] },
		{ move: 'signature', title: 'Third', plan: 'y', treatments: [{ label: 'A', mode: 'player', playerSlug: 'shane' }], addSubjects: [] },
	],
};

let db: Database.Database;
let roundId: number;
let prev: Record<string, string | undefined> = {};

interface Fake { breakdown?: unknown; gen?: ('ok' | 'fail')[]; fal?: 'ok' | 'fail'; readCost?: number; concepts?: unknown }
let calls: { kind: string; model?: string }[] = [];

function fakeFetch(o: Fake): FetchLike {
	const gen = [...(o.gen ?? ['ok'])];
	return (async (u: string | URL, init?: RequestInit) => {
		const url = String(u);
		if (url.startsWith('https://i.scdn.co/')) {
			calls.push({ kind: 'art' });
			return new Response(new Uint8Array(png), { status: 200, headers: { 'content-type': 'image/png' } });
		}
		if (url.startsWith('https://queue.fal.run/')) {
			calls.push({ kind: 'fal' });
			if (o.fal !== 'ok') return new Response('boom', { status: 500 });
			return new Response(JSON.stringify({ images: [{ url: `data:image/png;base64,${png.toString('base64')}` }], cost: 0.04 }), { status: 200 });
		}
		if (url === 'https://openrouter.ai/api/v1/chat/completions') {
			const body = JSON.parse(String(init?.body ?? '{}'));
			const text = String(body.messages?.[0]?.content?.[0]?.text ?? '');
			const chat = (content: unknown, cost: number) =>
				new Response(JSON.stringify({ choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }], usage: { cost } }), { status: 200 });
			if (body.model === 'vis/reader') {
				if (text === IDENTITY_PROMPT) { calls.push({ kind: 'identity' }); return chat('short brown hair, beard', 0.002); }
				calls.push({ kind: 'read' });
				return chat(o.breakdown ?? PERSON, o.readCost ?? 0.01);
			}
			if (body.model === 'txt/pitch') { calls.push({ kind: 'pitch' }); return chat(o.concepts ?? CONCEPTS, 0.004); }
			if (body.model === 'img/gen') {
				calls.push({ kind: 'generate' });
				const r = gen.shift() ?? 'fail';
				if (r === 'ok') {
					return new Response(JSON.stringify({ choices: [{ message: { images: [{ image_url: { url: `data:image/png;base64,${png.toString('base64')}` } }] } }], usage: { cost: 0.07 } }), { status: 200 });
				}
				return new Response(JSON.stringify({ choices: [{ message: { content: 'I cannot do that' } }], usage: { cost: 0.01 } }), { status: 200 });
			}
		}
		calls.push({ kind: `unexpected ${url}` });
		throw new Error(`unexpected fetch ${url}`);
	}) as FetchLike;
}

const paid = () => calls.filter((c) => c.kind !== 'art');
const slotRow = (id: number) => db.prepare('SELECT * FROM cover_podium_slots WHERE id = ?').get(id) as {
	status: string; note: string | null; project_id: number | null; gif_rel: string | null; updated_at: string;
};
function addSlot(o: { submission?: number | null; status?: string; rank?: number; title?: string; project?: number | null } = {}): number {
	return Number(db.prepare(
		`INSERT INTO cover_podium_slots (round_id, rank, title, submission_id, project_id, status, updated_at) VALUES (?, ?, ?, ?, ?, ?, '2026-11-04T00:00:00Z')`,
	).run(roundId, o.rank ?? 1, o.title ?? 'Linoleum', o.submission === undefined ? 1 : o.submission, o.project ?? null, o.status ?? 'pending').lastInsertRowid);
}
const podium = () => JSON.parse((db.prepare(`SELECT content_json FROM digest_sections WHERE id = 'd1-podium'`).get() as { content_json: string }).content_json);
/** Spend already on this round: a linked project with one logged request. */
function seedSpend(usd: number): void {
	const p = createProject(db, { title: 'old', source: 'upload', round_id: roundId, spotify_uri: null, league_slug: null, cover_rel: 'covers/x.png', cover_url: null });
	logRequest(db, { project_id: p.id, version_id: null, step: 'generate', model_id: 'img/gen', provider: 'openrouter', latency_ms: 1, cost_usd: usd, cost_estimated: 0, outcome: 'ok', error_reason: null });
	addSlot({ rank: 2, title: 'Other Song', submission: null, status: 'done', project: p.id });
}
const model = (id: string, kinds: string) => insertModel(db, {
	model_id: id, nickname: null, description: null, model_type: null, context_len: null, price_in: null, price_out: null, is_free: 0,
	cost_override: null, cap_reason: 0, cap_stream: 1, cap_vision: 1, cap_tools: 0, cap_json: 1, favorite: 0, sort_order: 0, kinds,
});

beforeAll(async () => {
	for (const k of ['DATA_DIR', 'OPENROUTER_API_KEY', 'FAL_KEY', 'AVATAR_FACTORY_GEN_PAUSED']) prev[k] = process.env[k];
	process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'cf-auto-'));
	process.env.OPENROUTER_API_KEY = 'test-key';
	png = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#c9a' } }).png().toBuffer();
});
afterAll(() => {
	for (const [k, v] of Object.entries(prev)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
});
beforeEach(() => {
	calls = [];
	delete process.env.FAL_KEY;
	delete process.env.AVATAR_FACTORY_GEN_PAUSED;
	// Any un-injected network call fails the test loudly.
	vi.stubGlobal('fetch', async (u: string | URL) => { calls.push({ kind: `global ${String(u)}` }); throw new Error('no network in tests'); });
	db = openLeagueDb(':memory:');
	seedLeagues(db);
	const leagueId = (db.prepare(`SELECT id FROM leagues WHERE slug = 'boarz-ii-men'`).get() as { id: number }).id;
	roundId = upsertRound(db, upsertSeason(db, leagueId, 1, 'active'), { mlRoundId: 'ml-1', name: 'R', description: '', spotifyPlaylistUrl: '', createdAt: '2026-01-01T00:00:00Z' });
	db.prepare(`INSERT INTO ml_submissions (id, round_id, spotify_uri, title, album, artists, album_art_url, created_at) VALUES (1, ?, 'spotify:track:a', 'Linoleum', 'Punk', 'NOFX', ?, datetime('now'))`).run(roundId, SPOT);
	db.prepare(`INSERT INTO ml_submissions (id, round_id, spotify_uri, title, album, artists, album_art_url, created_at) VALUES (2, ?, 'spotify:track:b', 'Headless', 'H', 'Band', ?, datetime('now'))`).run(roundId, SPOT);
	model('vis/reader', '["vision"]');
	model('img/gen', '["image"]');
	model('txt/pitch', '["text"]');
	const pin = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
	pin.run(COVER_JOB_KEYS.reader, 'vis/reader');
	pin.run(COVER_JOB_KEYS.generator, 'img/gen');
	pin.run(COVER_JOB_KEYS.pitch, 'txt/pitch');
	db.prepare(`INSERT INTO digest_drafts (id, round_id, rel_context, prep_checks, generated_at) VALUES ('d1', ?, '', '', '2026-11-04T00:00:00Z')`).run(roundId);
	db.prepare(`INSERT INTO digest_sections (id, draft_id, kind, position, state, content_json) VALUES ('d1-podium', 'd1', 'podium', 0, 'default', ?)`)
		.run(JSON.stringify({ title: 'Podium', items: [{ rank: 1, title: 'Linoleum', artist: 'NOFX', coverUrl: SPOT }] }));
});
afterEach(() => vi.unstubAllGlobals());

const CAP1 = { capUsd: 1.0 };

describe('runSlot', () => {
	it('person cover: submitter replaces the main subject, keeper set, private GIF on the draft, slot done', async () => {
		const id = addSlot();
		const out = await runSlot(db, roundId, id, CAP1, { fetchImpl: fakeFetch({ breakdown: PERSON }) });
		expect(out).toBe('done');
		expect(paid().map((c) => c.kind)).toEqual(['read', 'identity', 'generate']);
		const s = slotRow(id);
		expect(s.status).toBe('done');
		const p = getProject(db, s.project_id!)!;
		const [v] = listVersions(db, p.id);
		expect(p.keeper_version_id).toBe(v.id);
		expect(JSON.parse(p.treatments_json!)).toEqual([
			expect.objectContaining({ label: 'A', mode: 'player', playerSlug: 'shane' }),
			expect.objectContaining({ label: 'B', mode: 'keep' }),
		]);
		expect(s.gif_rel).toMatch(new RegExp(`^exports/${v.id}-[0-9a-f]{6}\\.gif$`));
		expect(existsSync(coverFile(s.gif_rel!))).toBe(true);
		expect(podium().items[0].coverUrl).toBe(`/api/cover-factory/media/${s.gif_rel}`);
		expect(s.note).toMatch(/try 1/);
		expect(roundSpend(db, roundId)).toBeCloseTo(0.01 + 0.002 + 0.07, 6);
	});

	it('no-person cover: pitches for the submitter, applies the first concept, then generates', async () => {
		const id = addSlot();
		expect(await runSlot(db, roundId, id, CAP1, { fetchImpl: fakeFetch({ breakdown: OBJECT }) })).toBe('done');
		expect(paid().map((c) => c.kind)).toEqual(['read', 'pitch', 'identity', 'generate']);
		const p = getProject(db, slotRow(id).project_id!)!;
		expect(JSON.parse(p.treatments_json!)).toEqual([expect.objectContaining({ label: 'A', mode: 'player', playerSlug: 'shane', notes: 'the cube becomes his face' })]);
	});

	it('three failed versions then fal: done with the fal version as keeper', async () => {
		process.env.FAL_KEY = 'test-fal';
		const id = addSlot();
		expect(await runSlot(db, roundId, id, CAP1, { fetchImpl: fakeFetch({ gen: ['fail', 'fail', 'fail'], fal: 'ok' }) })).toBe('done');
		const p = getProject(db, slotRow(id).project_id!)!;
		const vs = listVersions(db, p.id);
		expect(vs.map((v) => `${v.provider}:${v.status}`)).toEqual(['openrouter:failed', 'openrouter:failed', 'openrouter:failed', 'fal:ok']);
		expect(p.keeper_version_id).toBe(vs[3].id);
		expect(slotRow(id).note).toMatch(/fal/);
		// read 0.01 + identity 0.002 + 3 failed openrouter 0.01 + fal 0.04
		expect(roundSpend(db, roundId)).toBeCloseTo(0.01 + 0.002 + 0.03 + 0.04, 6);
	});

	it('a retry that succeeds stops the attempts', async () => {
		const id = addSlot();
		expect(await runSlot(db, roundId, id, CAP1, { fetchImpl: fakeFetch({ gen: ['fail', 'ok'] }) })).toBe('done');
		expect(paid().filter((c) => c.kind === 'generate')).toHaveLength(2);
	});

	it('all attempts fail (no FAL_KEY): failed with the last reason, no fal call', async () => {
		const id = addSlot();
		expect(await runSlot(db, roundId, id, CAP1, { fetchImpl: fakeFetch({ gen: ['fail', 'fail', 'fail', 'ok'] }) })).toBe('failed');
		expect(paid().filter((c) => c.kind === 'generate')).toHaveLength(3);
		expect(paid().some((c) => c.kind === 'fal')).toBe(false);
		const s = slotRow(id);
		expect(s.status).toBe('failed');
		expect(s.note).toMatch(/no_image/);
		expect(getProject(db, s.project_id!)!.keeper_version_id).toBeNull();
		expect(podium().items[0].coverUrl).toBe(SPOT);
	});

	it('all attempts fail including fal: failed', async () => {
		process.env.FAL_KEY = 'test-fal';
		const id = addSlot();
		expect(await runSlot(db, roundId, id, CAP1, { fetchImpl: fakeFetch({ gen: ['fail', 'fail', 'fail'], fal: 'fail' }) })).toBe('failed');
		expect(paid().filter((c) => c.kind === 'fal')).toHaveLength(1);
		expect(slotRow(id).note).toMatch(/fal/i);
	});

	it('no headshot for the submitter: failed note, no paid call', async () => {
		const id = addSlot({ submission: 2, title: 'Headless' });
		expect(await runSlot(db, roundId, id, CAP1, { fetchImpl: fakeFetch({}) })).toBe('failed');
		expect(paid()).toEqual([]);
		expect(slotRow(id).note).toBe('no headshot for No Head');
	});

	it('estimate over $1.00: needs_approval, slot back to pending, no paid call', async () => {
		seedSpend(0.99);
		const id = addSlot();
		expect(await runSlot(db, roundId, id, CAP1, { fetchImpl: fakeFetch({}) })).toBe('needs_approval');
		expect(paid()).toEqual([]);
		expect(slotRow(id).status).toBe('pending');
		expect(slotRow(id).note).toMatch(/approval/);
	});

	it('approved resume ($2 cap) reuses the slot project and finishes', async () => {
		seedSpend(0.99);
		const id = addSlot();
		await runSlot(db, roundId, id, CAP1, { fetchImpl: fakeFetch({}) });
		const pid = slotRow(id).project_id;
		expect(pid).not.toBeNull();
		calls = [];
		expect(await runSlot(db, roundId, id, { capUsd: 2.0 }, { fetchImpl: fakeFetch({}) })).toBe('done');
		expect(slotRow(id).project_id).toBe(pid);
		expect(calls.filter((c) => c.kind === 'art')).toEqual([]); // cover not downloaded again
	});

	it('estimate over $2.00: failed "budget cap reached", no paid call', async () => {
		seedSpend(1.99);
		const id = addSlot();
		expect(await runSlot(db, roundId, id, { capUsd: 2.0 }, { fetchImpl: fakeFetch({}) })).toBe('failed');
		expect(paid()).toEqual([]);
		expect(slotRow(id).note).toBe('budget cap reached');
	});

	it('budget is checked before every generate attempt', async () => {
		seedSpend(0.885);
		const id = addSlot();
		// 0.885 + read 0.01 + identity 0.002 = 0.897: generate 1 fits (0.997); its failed cost 0.01 -> 0.907 + 0.10 > $1.00
		const out = await runSlot(db, roundId, id, CAP1, { fetchImpl: fakeFetch({ gen: ['fail', 'fail', 'fail'] }) });
		expect(out).toBe('needs_approval');
		expect(paid().filter((c) => c.kind === 'generate')).toHaveLength(1);
	});

	it('over-cap gate fires at the pitch step', async () => {
		seedSpend(0.93); // read 0.95 fits; after read 0.94 + pitch 0.07 > $1.00 (0.05 would still fit)
		const id = addSlot();
		expect(await runSlot(db, roundId, id, CAP1, { fetchImpl: fakeFetch({ breakdown: OBJECT }) })).toBe('needs_approval');
		expect(paid().map((c) => c.kind)).toEqual(['read']);
	});

	it('over-cap gate fires at the identity step', async () => {
		seedSpend(0.975); // read 0.995 fits; after read (0.02) 0.995 + identity 0.01 > $1.00
		const id = addSlot();
		expect(await runSlot(db, roundId, id, CAP1, { fetchImpl: fakeFetch({ breakdown: PERSON, readCost: 0.02 }) })).toBe('needs_approval');
		expect(paid().map((c) => c.kind)).toEqual(['read']);
	});

	it('a pitch with zero concepts fails the slot', async () => {
		const id = addSlot();
		expect(await runSlot(db, roundId, id, CAP1, { fetchImpl: fakeFetch({ breakdown: OBJECT, concepts: { concepts: [] } }) })).toBe('failed');
		expect(slotRow(id).note).toBe('pitch returned no concepts');
		expect(paid().some((c) => c.kind === 'generate')).toBe(false);
	});

	it('a slot stuck running for 20 min is reclaimed and runs; one touched 1 min ago is left alone', async () => {
		const stale = addSlot({ status: 'running' });
		const live = addSlot({ rank: 2, title: 'Headless', submission: 2, status: 'running' });
		const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
		db.prepare('UPDATE cover_podium_slots SET updated_at = ? WHERE id = ?').run(ago(20), stale);
		db.prepare('UPDATE cover_podium_slots SET updated_at = ? WHERE id = ?').run(ago(1), live);
		expect(await runSlot(db, roundId, live, CAP1, { fetchImpl: fakeFetch({}) })).toBe('running');
		expect(slotRow(live).status).toBe('running');
		// That call already reclaimed the stale slot of the same round.
		expect(slotRow(stale)).toMatchObject({ status: 'pending', note: 'reclaimed after interrupted run' });
		expect(await runSlot(db, roundId, stale, CAP1, { fetchImpl: fakeFetch({}) })).toBe('done');
		expect(reclaimStaleSlots(db, roundId)).toBe(0);
	});

	it('heartbeats updated_at at each paid step', async () => {
		const id = addSlot();
		let t = Date.parse('2026-11-04T10:00:00Z');
		const stamps: string[] = [];
		const f = fakeFetch({});
		const spy = (async (u: string | URL, i?: RequestInit) => { stamps.push(slotRow(id).updated_at); return f(u, i); }) as FetchLike;
		await runSlot(db, roundId, id, CAP1, { fetchImpl: spy, now: () => (t += 60_000) });
		const paidStamps = stamps.slice(1); // first fetch is the album art
		expect(new Set(paidStamps).size).toBe(paidStamps.length);
	});

	it('pause gate: slot stays pending, outcome paused, no calls', async () => {
		process.env.AVATAR_FACTORY_GEN_PAUSED = '1';
		const id = addSlot();
		expect(await runSlot(db, roundId, id, CAP1, { fetchImpl: fakeFetch({}) })).toBe('paused');
		expect(calls).toEqual([]);
		expect(slotRow(id).status).toBe('pending');
	});

	it('a pause switched on mid-run stops before the next paid call and leaves the slot pending', async () => {
		const id = addSlot();
		const f = fakeFetch({});
		const pausing = (async (u: string | URL, i?: RequestInit) => {
			const r = await f(u, i);
			if (calls.at(-1)?.kind === 'read') process.env.AVATAR_FACTORY_GEN_PAUSED = '1';
			return r;
		}) as FetchLike;
		expect(await runSlot(db, roundId, id, CAP1, { fetchImpl: pausing })).toBe('paused');
		expect(paid().map((c) => c.kind)).toEqual(['read']);
		expect(slotRow(id)).toMatchObject({ status: 'pending', note: 'generation paused: will retry' });
		expect(slotRow(id).project_id).not.toBeNull();
	});

	it('refuses a non-pending slot (hand-made cover pre-marked skipped) without touching it', async () => {
		const id = addSlot({ status: 'skipped' });
		db.prepare(`UPDATE cover_podium_slots SET note = 'hand-made cover kept' WHERE id = ?`).run(id);
		expect(await runSlot(db, roundId, id, CAP1, { fetchImpl: fakeFetch({}) })).toBe('skipped');
		expect(calls).toEqual([]);
		expect(slotRow(id)).toMatchObject({ status: 'skipped', note: 'hand-made cover kept', project_id: null });
		const done = addSlot({ rank: 2, title: 'X', status: 'done' });
		expect(await runSlot(db, roundId, done, CAP1, { fetchImpl: fakeFetch({}) })).toBe('done');
		expect(calls).toEqual([]);
	});

	it('marks the slot running while it works', async () => {
		const id = addSlot();
		let seen = '';
		const f = fakeFetch({});
		await runSlot(db, roundId, id, CAP1, { fetchImpl: (async (u: string | URL, i?: RequestInit) => { seen ||= slotRow(id).status; return f(u, i); }) as FetchLike });
		expect(seen).toBe('running');
	});
});
