import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { openLeagueDb } from '$lib/db/client.js';
import { insertModel } from '$lib/db/aiModels.js';

const db = openLeagueDb(':memory:');
let png: Buffer;

vi.mock('$lib/db/client.js', async (orig) => {
	const actual = await orig<typeof import('$lib/db/client.js')>();
	return { ...actual, getDb: () => db };
});
vi.mock('$lib/server/coverFactory/inputs.js', async (orig) => {
	const actual = await orig<typeof import('$lib/server/coverFactory/inputs.js')>();
	return {
		...actual,
		resolveSpotifyCover: vi.fn(async () => ({ title: 'Song', artists: 'Artist', artUrl: 'https://i.example/a.jpg', spotifyUri: 'spotify:track:abc' })),
		fetchCoverBytes: vi.fn(async () => png),
		saveCoverUpload: vi.fn(actual.saveCoverUpload),
		listPlayers: vi.fn(() => [{ slug: 'jon', name: 'Jon', leagueSlug: 'boarz-ii-men', headshotRel: 'x', lowRes: false, missing: false }]),
		loadHeadshot: vi.fn(async () => png),
	};
});

import * as inputs from '$lib/server/coverFactory/inputs.js';
import { slugify } from '$lib/server/avatarFactory/filenames.js';
import { GET, POST } from './+server.js';
import { GET as MEDIA } from './media/[...path]/+server.js';

const BREAKDOWN = JSON.stringify({
	style: 's', composition: 'c', palette_lighting: 'p',
	subjects: [{ label: 'A', kind: 'person', role: 'main', position: 'center' }],
});
const IMG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
let chatCalls = 0;
const fakeFetch = vi.fn(async (_u: unknown, init?: { body?: string }) => {
	const body = JSON.parse(String(init?.body ?? '{}'));
	if (body.model === 'img/nogen') {
		return new Response(JSON.stringify({ choices: [{ message: { content: 'cannot' } }] }), { status: 200 });
	}
	if (String(body.model).startsWith('img/')) {
		return new Response(JSON.stringify({ choices: [{ message: { images: [{ image_url: { url: `data:image/png;base64,${IMG}` } }] } }], usage: { cost: 0.07 } }), { status: 200 });
	}
	chatCalls++;
	return new Response(JSON.stringify({ choices: [{ message: { content: BREAKDOWN } }], usage: { cost: 0.001 } }), { status: 200 });
});

let prevData: string | undefined, prevDig: string | undefined, prevKey: string | undefined;
beforeAll(async () => {
	prevData = process.env.DATA_DIR; prevDig = process.env.DIGESTS_DIR; prevKey = process.env.OPENROUTER_API_KEY;
	process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'cf-api-data-'));
	process.env.DIGESTS_DIR = mkdtempSync(join(tmpdir(), 'cf-api-dig-'));
	process.env.OPENROUTER_API_KEY = 'k';
	png = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#789' } }).png().toBuffer();
	vi.stubGlobal('fetch', fakeFetch);
});
afterAll(() => {
	vi.unstubAllGlobals();
	if (prevData === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = prevData;
	if (prevDig === undefined) delete process.env.DIGESTS_DIR; else process.env.DIGESTS_DIR = prevDig;
	if (prevKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = prevKey;
});
beforeEach(() => {
	chatCalls = 0;
	fakeFetch.mockClear();
	delete process.env.AVATAR_FACTORY_GEN_PAUSED;
	db.exec('DELETE FROM cover_requests; DELETE FROM cover_versions; DELETE FROM cover_projects; DELETE FROM ai_models;');
	db.prepare("DELETE FROM settings WHERE key LIKE 'cover_factory_%'").run();
	const base = { nickname: null, description: null, model_type: null, context_len: null, price_in: null, price_out: null, is_free: 0, cost_override: null, cap_reason: 0, cap_stream: 1, cap_vision: 0, cap_tools: 0, cap_json: 1, favorite: 0, sort_order: 0 };
	insertModel(db, { ...base, model_id: 'vis/reader', kinds: '["vision","text"]', cap_vision: 1 });
	insertModel(db, { ...base, model_id: 'img/gen', kinds: '["image"]' });
});

const post = async (body: unknown) => {
	const res = await POST({ request: new Request('http://x/api/cover-factory', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) } as never);
	return { status: res.status, json: (await res.json()) as any };
};
const get = async (qs: string) => {
	const res = await GET({ url: new URL(`http://x/api/cover-factory${qs}`) } as never);
	return { status: res.status, json: (await res.json()) as any };
};
const seed = async () => {
	const { project } = (await post({ action: 'create', source: 'spotify', url: 'https://open.spotify.com/track/abc' })).json;
	return project.id as number;
};

describe('cover-factory API', () => {
	it('list returns resolved models', async () => {
		const r = await get('');
		expect(r.json.models).toEqual({ reader: 'vis/reader', generator: 'img/gen' });
	});

	it('create(spotify) makes a project; read saves breakdown + default treatments', async () => {
		const id = await seed();
		const r = await post({ action: 'read', projectId: id });
		expect(r.status).toBe(200);
		expect(r.json.breakdown.subjects[0].label).toBe('A');
		expect(r.json.treatments[0]).toMatchObject({ label: 'A', mode: 'player' });
		const s = await get(`?project=${id}`);
		expect(s.json.project.title).toBe('Song — Artist');
		expect(s.json.breakdown.style).toBe('s');
	});

	it('generate makes a version and caches the identity once', async () => {
		const id = await seed();
		await post({ action: 'read', projectId: id });
		const t = [{ label: 'A', mode: 'player', playerSlug: 'jon', playerName: 'Jon' }];
		chatCalls = 0;
		const g1 = await post({ action: 'generate', projectId: id, treatments: t, modelId: 'img/gen' });
		expect(g1.status).toBe(200);
		expect(g1.json.version.status).toBe('ok');
		expect(chatCalls).toBe(1);
		await post({ action: 'generate', projectId: id, treatments: t, modelId: 'img/gen' });
		expect(chatCalls).toBe(1);
		const proj = (await get(`?project=${id}`)).json.project;
		expect(JSON.parse(proj.identities_json).jon).toBeTruthy();
	});

	it('project state gives each version its own generate cost + latency, and the submitter', async () => {
		const id = await seed();
		await post({ action: 'read', projectId: id });
		const ok = (await post({ action: 'generate', projectId: id, treatments: [], modelId: 'img/gen' })).json.version.id;
		const bad = (await post({ action: 'generate', projectId: id, treatments: [], modelId: 'img/nogen' })).json.version.id;
		const s = (await get(`?project=${id}`)).json;
		const v = (vid: number) => s.versions.find((x: { id: number }) => x.id === vid);
		expect(v(ok).cost_usd).toBeCloseTo(0.07);
		expect(typeof v(ok).latency_ms).toBe('number');
		expect(v(bad).status).toBe('failed');
		expect(v(bad).cost_usd).not.toBeCloseTo(0.07);
		expect(s.submitter).toBeNull();
	});

	it('rate out of range is 400', async () => {
		const id = await seed();
		await post({ action: 'read', projectId: id });
		const g = await post({ action: 'generate', projectId: id, treatments: [], modelId: 'img/gen' });
		const r = await post({ action: 'rate', versionId: g.json.version.id, ratings: { likeness: 9 } });
		expect(r.status).toBe(400);
		const ok = await post({ action: 'rate', versionId: g.json.version.id, ratings: { likeness: 5, gag: null } });
		expect(ok.status).toBe(200);
	});

	it('keeper then share is stable; new keeper changes URLs; share without keeper is 400', async () => {
		const id = await seed();
		await post({ action: 'read', projectId: id });
		expect((await post({ action: 'share', projectId: id })).status).toBe(400);
		const a = (await post({ action: 'generate', projectId: id, treatments: [], modelId: 'img/gen' })).json.version.id;
		const b = (await post({ action: 'generate', projectId: id, treatments: [], modelId: 'img/gen' })).json.version.id;
		await post({ action: 'keeper', projectId: id, versionId: a });
		const s1 = (await post({ action: 'share', projectId: id })).json;
		const s2 = (await post({ action: 'share', projectId: id })).json;
		expect(s2).toEqual(s1);
		await post({ action: 'keeper', projectId: id, versionId: b });
		const s3 = (await post({ action: 'share', projectId: id })).json;
		expect(s3.stillUrl).not.toBe(s1.stillUrl);
	});

	it('unknown action and bad input are 400', async () => {
		expect((await post({ action: 'nope' })).status).toBe(400);
		expect((await post({ action: 'create', source: 'spotify' })).status).toBe(400);
	});

	it('media serves files, sets cache headers, and rejects traversal', async () => {
		const id = await seed();
		const rel = (await get(`?project=${id}`)).json.project.cover_rel as string;
		const ok = await MEDIA({ params: { path: rel }, url: new URL('http://x/m?download=1') } as never);
		expect(ok.status).toBe(200);
		expect(ok.headers.get('cache-control')).toBe('private, max-age=60');
		expect(ok.headers.get('content-type')).toBe('image/jpeg');
		expect(ok.headers.get('content-disposition')).toMatch(/attachment/);
		const bad = await MEDIA({ params: { path: '../../etc/passwd' }, url: new URL('http://x/m') } as never);
		expect(bad.status).toBe(403);
		for (const p of ['/etc/passwd', '..\\..\\etc\\passwd']) {
			expect((await MEDIA({ params: { path: p }, url: new URL('http://x/m') } as never)).status).toBe(403);
		}
		const missing = await MEDIA({ params: { path: 'covers/nope.jpg' }, url: new URL('http://x/m') } as never);
		expect(missing.status).toBe(404);
	});

	it('media export builds a gif on the fly', async () => {
		const id = await seed();
		await post({ action: 'read', projectId: id });
		const v = (await post({ action: 'generate', projectId: id, treatments: [], modelId: 'img/gen' })).json.version.id;
		const res = await MEDIA({ params: { path: `export/${v}.gif` }, url: new URL('http://x/m') } as never);
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('image/gif');
	});

	it('generate while paused is 409 and makes no provider calls', async () => {
		const id = await seed();
		await post({ action: 'read', projectId: id });
		fakeFetch.mockClear();
		process.env.AVATAR_FACTORY_GEN_PAUSED = '1';
		const t = [{ label: 'A', mode: 'player', playerSlug: 'jon', playerName: 'Jon' }];
		const r = await post({ action: 'generate', projectId: id, treatments: t, modelId: 'img/gen' });
		expect(r.status).toBe(409);
		expect(fakeFetch).not.toHaveBeenCalled();
	});

	it('a no-image generation is 200 with a failed version and reason', async () => {
		const id = await seed();
		await post({ action: 'read', projectId: id });
		const r = await post({ action: 'generate', projectId: id, treatments: [], modelId: 'img/nogen' });
		expect(r.status).toBe(200);
		expect(r.json.version.status).toBe('failed');
		expect(r.json.version.error_reason).toBeTruthy();
	});

	it('create(round) takes league from rounds->seasons->leagues and defaults to the submitter', async () => {
		db.exec(`DELETE FROM ml_submissions; DELETE FROM rounds; DELETE FROM seasons; DELETE FROM leagues; DELETE FROM competitors;
			INSERT INTO leagues (id, slug, name) VALUES (7, 'second-best', 'Second Best');
			INSERT INTO seasons (id, league_id, season_number, status) VALUES (3, 7, 1, 'active');
			INSERT INTO rounds (id, season_id, ml_round_id, name, created_at) VALUES (11, 3, 'mlr', 'R', '2026-01-01');
			INSERT INTO competitors (id, ml_competitor_id, name) VALUES (5, 'c5', 'Jon Doe');
			INSERT INTO ml_submissions (id, round_id, competitor_id, spotify_uri, title, artists, created_at, album_art_url)
			  VALUES (21, 11, 5, 'spotify:track:zzz', 'Tune', 'Band', '2026-01-01', 'https://i.example/z.jpg');`);
		db.exec(`INSERT INTO rounds (id, season_id, ml_round_id, name, created_at) VALUES (12, 3, 'mlr2', 'Empty', '2026-01-02');`);
		const lr = (await get('?league=second-best')).json.rounds;
		expect(lr).toEqual([
			{ id: 12, name: 'Empty', number: 12, songCount: 0 },
			{ id: 11, name: 'R', number: 11, songCount: 1 },
		]);
		const c = await post({ action: 'create', source: 'round', roundId: 11, submissionId: 21 });
		expect(c.status).toBe(200);
		expect(c.json.project).toMatchObject({ league_slug: 'second-best', round_id: 11, title: 'Tune — Band' });
		const rd = await post({ action: 'read', projectId: c.json.project.id });
		expect(rd.json.treatments[0]).toMatchObject({ mode: 'player', playerSlug: slugify('Jon Doe'), playerName: 'Jon Doe' });
	});

	const upload = async (name: string, bytes: Buffer) => {
		const f = new FormData();
		f.set('action', 'upload-cover');
		f.set('file', new File([new Uint8Array(bytes)], name));
		const res = await POST({ request: new Request('http://x/api/cover-factory', { method: 'POST', body: f }) } as never);
		return { status: res.status, json: (await res.json()) as any };
	};

	it('upload: non-image is 400, disk failure is 5xx, valid image works', async () => {
		const bad = await upload('x.txt', Buffer.from('not an image'));
		expect(bad.status).toBe(400);
		expect(bad.json.error).toBe('not a valid image');
		vi.mocked(inputs.saveCoverUpload).mockRejectedValueOnce(new Error('ENOSPC: no space left'));
		const disk = await upload('c.png', png);
		expect(disk.status).toBe(500);
		expect(disk.json.error).toMatch(/ENOSPC/);
		const ok = await upload('c.png', png);
		expect(ok.status).toBe(200);
		expect(ok.json.project.source).toBe('upload');
	});
});
