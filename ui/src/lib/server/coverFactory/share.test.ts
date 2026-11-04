import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { openLeagueDb } from '$lib/db/client.js';
import { coverFile } from './paths.js';
import { createProject, insertVersion, updateProject } from './repo.js';
import { shareKeeper } from './share.js';

const db = openLeagueDb(':memory:');
let digests = '';
let prev: string | undefined;
let pid = 0;
let v1 = 0;
let v2 = 0;

async function png(bg: string) {
	return sharp({ create: { width: 32, height: 32, channels: 3, background: bg } }).png().toBuffer();
}
function put(rel: string, b: Buffer) {
	const abs = coverFile(rel);
	mkdirSync(join(abs, '..'), { recursive: true });
	writeFileSync(abs, b);
}

beforeAll(() => {
	prev = process.env.DATA_DIR;
	process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'cf-share-data-'));
	digests = mkdtempSync(join(tmpdir(), 'cf-share-dig-'));
});
afterAll(() => {
	if (prev === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = prev;
});
beforeEach(async () => {
	db.exec('DELETE FROM cover_requests; DELETE FROM cover_versions; DELETE FROM cover_projects;');
	pid = createProject(db, { title: 'T', source: 'upload', round_id: null, spotify_uri: null, league_slug: null, cover_rel: 'covers/o.png', cover_url: null }).id;
	put('covers/o.png', await png('#444'));
	put('versions/a.png', await png('#a33'));
	put('versions/b.png', await png('#3a3'));
	const base = { project_id: pid, model_id: 'm', provider: 'openrouter', prompt: 'p', status: 'ok' as const, error_reason: null };
	v1 = insertVersion(db, { ...base, image_rel: 'versions/a.png' }).id;
	v2 = insertVersion(db, { ...base, image_rel: 'versions/b.png' }).id;
});

describe('shareKeeper', () => {
	it('throws without a keeper', async () => {
		await expect(shareKeeper(db, pid, digests)).rejects.toThrow(/keeper/);
	});
	it('writes files under an unguessable dir and reuses it while keeper is unchanged', async () => {
		updateProject(db, pid, { keeper_version_id: v1 });
		const a = await shareKeeper(db, pid, digests);
		const b = await shareKeeper(db, pid, digests);
		expect(b).toEqual(a);
		expect(a.stillUrl).toMatch(/\/_media\/covers\/[0-9a-f]{24}\/cover\.jpg$/);
		expect(a.gifUrl).toMatch(/\/_media\/covers\/[0-9a-f]{24}\/wipe\.gif$/);
		const dir = /covers\/([0-9a-f]{24})\//.exec(a.stillUrl)![1];
		expect(existsSync(join(digests, '_media/covers', dir, 'cover.jpg'))).toBe(true);
		expect(existsSync(join(digests, '_media/covers', dir, 'wipe.gif'))).toBe(true);
	});
	it('uses a new directory when the keeper changes', async () => {
		updateProject(db, pid, { keeper_version_id: v1 });
		const a = await shareKeeper(db, pid, digests);
		updateProject(db, pid, { keeper_version_id: v2 });
		const b = await shareKeeper(db, pid, digests);
		expect(b.stillUrl).not.toBe(a.stillUrl);
	});
});
