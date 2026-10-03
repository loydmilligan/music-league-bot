import { describe, it, expect, beforeEach, vi } from 'vitest';
import { existsSync } from 'node:fs';
import type Database from 'better-sqlite3';
import { openLeagueDb } from '$lib/db/client.js';
import { appBaseUrl } from '$lib/config/urls.js';
import { mkdtemp, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
let db: Database.Database;
vi.mock('$lib/db/client.js', async (orig) => ({ ...(await orig<typeof import('$lib/db/client.js')>()), getDb: () => db }));
const DIGESTS = await mkdtemp(join(tmpdir(), 'd2dig-'));
vi.stubEnv('DIGESTS_DIR', DIGESTS);
const { swapDirAtomically, publishDigest2 } = await import('./publish.js');

describe('swapDirAtomically', () => {
	it('replaces the previous published copy with the new one', async () => {
		const root = await mkdtemp(join(tmpdir(), 'd2-'));
		const final = join(root, 'slug'); const tmp = join(root, '.slug.tmp');
		await mkdir(final); await writeFile(join(final, 'index.html'), 'OLD');
		await mkdir(tmp); await writeFile(join(tmp, 'index.html'), 'NEW');
		await swapDirAtomically(tmp, final);
		expect(await readFile(join(final, 'index.html'), 'utf8')).toBe('NEW');
		expect((await readdir(root)).sort()).toEqual(['slug']); // no tmp / backup left behind
	});
	it('first publish (no previous copy) works', async () => {
		const root = await mkdtemp(join(tmpdir(), 'd2-'));
		const tmp = join(root, '.s.tmp'); await mkdir(tmp); await writeFile(join(tmp, 'index.html'), 'NEW');
		await swapDirAtomically(tmp, join(root, 's'));
		expect(await readFile(join(root, 's', 'index.html'), 'utf8')).toBe('NEW');
	});
	it('if the new copy is missing, the old copy is left untouched', async () => {
		const root = await mkdtemp(join(tmpdir(), 'd2-'));
		const final = join(root, 'slug'); await mkdir(final); await writeFile(join(final, 'index.html'), 'OLD');
		await expect(swapDirAtomically(join(root, '.missing.tmp'), final)).rejects.toThrow();
		expect(await readFile(join(final, 'index.html'), 'utf8')).toBe('OLD');
	});
});

describe('publishDigest2', () => {
	const shell = (body: string) => `<html><head></head><body>${body}</body></html>`;
	const okAssets = () => new Map([['/_app/immutable/a.js', Buffer.from('console.log(1)')]]);
	const cap = (html: string, assets = okAssets()) => async () => ({ rawHtml: html, assets });
	const rows = () => db.prepare('SELECT * FROM digest2_shares').all();
	const d2 = join(DIGESTS, 'd2');

	beforeEach(async () => {
		db = openLeagueDb(':memory:');
		db.exec(`INSERT INTO leagues (id, slug, name) VALUES (1, 'bz', 'Boarz');
			INSERT INTO seasons (id, league_id, season_number, status) VALUES (1, 1, 1, 'active');
			INSERT INTO rounds (id, season_id, ml_round_id, name, created_at) VALUES (152, 1, 'ml-152', 'R', '2026-09-01T00:00:00Z');
			INSERT INTO digest_drafts (id, round_id, rel_context, prep_checks, stats_content_json) VALUES ('d', 152, '{}', '{}', '{}');`);
		const { rm } = await import('node:fs/promises');
		await rm(d2, { recursive: true, force: true });
	});

	it('a. leak -> 422, no share row, no directory', async () => {
		const host = new URL(appBaseUrl()).host;
		await expect(publishDigest2(152, { capture: cap(shell(`<p>${host}</p>`)) })).rejects.toMatchObject({ status: 422 });
		expect(rows()).toEqual([]);
		expect(existsSync(d2)).toBe(false);
	});
	it('a2. internal-origin host leak -> 422, no share row, no directory', async () => {
		const internal = new URL(process.env.DIGEST_EXPORT_INTERNAL_URL || `http://localhost:${process.env.PORT || 3002}`).host;
		await expect(publishDigest2(152, { capture: cap(shell(`<p>${internal}</p>`)) })).rejects.toMatchObject({ status: 422 });
		expect(rows()).toEqual([]);
		expect(existsSync(d2)).toBe(false);
	});
	it('a3. localized fonts css is leak-scanned -> 422, nothing written', async () => {
		const host = new URL(appBaseUrl()).host;
		const localizeFonts = async () => `@font-face{src:url(https://${host}/f.woff2)}`;
		await expect(publishDigest2(152, { capture: cap(shell('<p>ok</p>')), localizeFonts })).rejects.toMatchObject({ status: 422 });
		expect(rows()).toEqual([]);
		expect(existsSync(d2)).toBe(false);
	});
	it('b. missing referenced asset -> 500, no share row, no directory', async () => {
		const html = shell('<script type="module" src="../_app/missing.js"></script>');
		await expect(publishDigest2(152, { capture: cap(html) })).rejects.toMatchObject({
			status: 500, message: expect.stringContaining('missing assets')
		});
		expect(rows()).toEqual([]);
		expect(existsSync(d2)).toBe(false);
	});
	it('c. clean publish writes files, row, and digest-host url', async () => {
		const html = shell('<script type="module" src="../_app/immutable/a.js"></script>');
		const r = await publishDigest2(152, { capture: cap(html) });
		expect(rows()).toHaveLength(1);
		expect(r.url.endsWith(`/d2/${r.slug}`)).toBe(true);
		expect(existsSync(join(d2, r.slug, 'index.html'))).toBe(true);
		expect(existsSync(join(d2, r.slug, '_app/immutable/a.js'))).toBe(true);
	});
	it('d. republish keeps the slug and replaces index.html', async () => {
		const mk = (t: string) => shell(`<p>${t}</p><script src="../_app/immutable/a.js"></script>`);
		const r1 = await publishDigest2(152, { capture: cap(mk('ONE')) });
		const r2 = await publishDigest2(152, { capture: cap(mk('TWO')) });
		expect(r2.slug).toBe(r1.slug);
		expect(await readFile(join(d2, r1.slug, 'index.html'), 'utf8')).toContain('TWO');
		expect((await readdir(d2)).sort()).toEqual([r1.slug]);
	});
});
