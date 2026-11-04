import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { openLeagueDb } from '$lib/db/client.js';
import { createProject, getProject, listVersions } from './repo.js';
import { coverFile } from './paths.js';
import { generateVersion } from './generate.js';

const db = openLeagueDb(':memory:');
const PNG_1x1 =
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
let png: Buffer;
let prevData: string | undefined;
let prevKey: string | undefined;

beforeAll(async () => {
	prevData = process.env.DATA_DIR;
	prevKey = process.env.OPENROUTER_API_KEY;
	process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'cf-gen-'));
	process.env.OPENROUTER_API_KEY = 'test-key';
	png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#888' } }).png().toBuffer();
});
afterAll(() => {
	if (prevData === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = prevData;
	if (prevKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = prevKey;
});

const okFetch = async () =>
	new Response(
		JSON.stringify({
			choices: [{ message: { images: [{ image_url: { url: `data:image/png;base64,${PNG_1x1}` } }] } }],
			usage: { cost: 0.07 },
		}),
		{ status: 200 }
	);
const noImageFetch = async () =>
	new Response(JSON.stringify({ choices: [{ message: { content: 'I cannot do that' } }] }), { status: 200 });

let projectId = 0;
beforeEach(async () => {
	db.exec('DELETE FROM cover_requests; DELETE FROM cover_versions; DELETE FROM cover_projects;');
	const p = createProject(db, {
		title: 'T', source: 'upload', round_id: null, spotify_uri: null, league_slug: null,
		cover_rel: 'covers/orig.png', cover_url: null
	});
	projectId = p.id;
	const { mkdirSync, writeFileSync } = await import('node:fs');
	const { dirname } = await import('node:path');
	mkdirSync(dirname(coverFile('covers/orig.png')), { recursive: true });
	writeFileSync(coverFile('covers/orig.png'), png);
});

const input = (extra: Record<string, unknown> = {}) => ({
	projectId,
	treatments: [],
	identities: [],
	headshots: {},
	modelId: 'google/gemini-test',
	fetchImpl: okFetch,
	...extra
});

describe('generateVersion', () => {
	it('stores an ok version, file, and request row', async () => {
		const v = await generateVersion(db, input());
		expect(v).toMatchObject({ status: 'ok', try_no: 1, model_id: 'google/gemini-test', provider: 'openrouter' });
		expect(v.image_rel).toMatch(/^versions\/\d+\/1-[0-9a-f]{6}\.png$/);
		expect(existsSync(coverFile(v.image_rel!))).toBe(true);
		const r = db.prepare('SELECT * FROM cover_requests WHERE version_id = ?').get(v.id) as any;
		expect(r).toMatchObject({ outcome: 'ok', cost_usd: 0.07, step: 'generate', project_id: projectId });
		expect(getProject(db, projectId)!.treatments_json).toBe('[]');
	});

	it('no image -> failed version, no_image request', async () => {
		const v = await generateVersion(db, input({ fetchImpl: noImageFetch }));
		expect(v).toMatchObject({ status: 'failed', error_reason: 'no_image', image_rel: null });
		const r = db.prepare('SELECT * FROM cover_requests WHERE version_id = ?').get(v.id) as any;
		expect(r.outcome).toBe('no_image');
	});

	it('concurrent calls get distinct try_no and files', async () => {
		const [a, b] = await Promise.all([generateVersion(db, input()), generateVersion(db, input())]);
		expect([a.try_no, b.try_no].sort()).toEqual([1, 2]);
		expect(a.image_rel).not.toBe(b.image_rel);
		expect(listVersions(db, projectId)).toHaveLength(2);
		expect(readFileSync(coverFile(a.image_rel!)).length).toBeGreaterThan(0);
	});

	it('promptOverride is the stored prompt', async () => {
		const v = await generateVersion(db, input({ promptOverride: 'custom prompt' }));
		expect(v.prompt).toBe('custom prompt');
	});

	it('throws when no model resolves', async () => {
		await expect(generateVersion(db, input({ modelId: undefined }))).rejects.toThrow(/model/i);
	});
});
