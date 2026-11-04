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
		listPlayers: vi.fn(() => [{ slug: 'jon', name: 'Jon', leagueSlug: 'boarz-ii-men', headshotRel: 'x', lowRes: false, missing: false }]),
		loadHeadshot: vi.fn(async () => png),
	};
});

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
		expect([403, 404]).toContain(bad.status);
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
});
