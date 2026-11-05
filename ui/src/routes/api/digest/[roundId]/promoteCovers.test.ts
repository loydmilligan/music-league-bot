// Cover Factory piece 5: podium auto covers are promoted to public URLs before the finalize export and
// before the d2 share capture (so the leak gate passes). Export / capture are mocked; temp dirs only.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import type Database from 'better-sqlite3';
import { openLeagueDb } from '$lib/db/client.js';
import { seedLeagues, upsertSeason } from '$lib/db/leagues.js';
import { upsertRound } from '$lib/db/rounds.js';
import { coverFile } from '$lib/server/coverFactory/paths.js';
import { createProject, insertVersion, updateProject } from '$lib/server/coverFactory/repo.js';

let db: Database.Database;
const exportSeen: string[] = [];
vi.mock('$lib/db/client.js', async (orig) => ({ ...(await orig<typeof import('$lib/db/client.js')>()), getDb: () => db }));
vi.mock('$lib/digest/export.js', async (orig) => ({
	...(await orig<typeof import('$lib/digest/export.js')>()),
	// Records the podium coverUrl the export would have rendered.
	runDigestExport: vi.fn(async (roundId: number) => {
		exportSeen.push(JSON.parse(podium(roundId)).items[0].coverUrl);
		return [];
	}),
}));
vi.mock('$lib/digest/relContext.js', async (orig) => ({
	...(await orig<typeof import('$lib/digest/relContext.js')>()),
	proposeRelContextUpdate: vi.fn(async () => 'ctx'),
}));

const DIGESTS = mkdtempSync(join(tmpdir(), 'cf-promote-routes-dig-'));
vi.stubEnv('DIGESTS_DIR', DIGESTS);
const { POST: FINALIZE } = await import('./finalize/+server.js');
const { publishDigest2 } = await import('$lib/digest2/publish.js');

const PRIVATE = '/api/cover-factory/media/exports/1-ab.gif';
const SPOT = 'https://i.scdn.co/image/abc';
const PODIUM = JSON.stringify({
	title: 'Podium',
	items: [
		{ rank: 1, title: 'Chaise Longue', artist: 'Wet Leg', coverUrl: PRIVATE },
		{ rank: 2, title: 'Two', artist: 'X', coverUrl: SPOT },
	],
});

let prevData: string | undefined;
let on: number;
let off: number;
let pid: number;

function podium(r: number): string {
	return (db.prepare(`SELECT s.content_json FROM digest_sections s JOIN digest_drafts d ON d.id = s.draft_id
		WHERE d.round_id = ? AND s.kind = 'podium'`).get(r) as { content_json: string }).content_json;
}
async function png(bg: string) {
	return sharp({ create: { width: 32, height: 32, channels: 3, background: bg } }).png().toBuffer();
}
function put(rel: string, b: Buffer) {
	const abs = coverFile(rel);
	mkdirSync(join(abs, '..'), { recursive: true });
	writeFileSync(abs, b);
}
function round(slug: string, ml: string): number {
	const leagueId = (db.prepare('SELECT id FROM leagues WHERE slug = ?').get(slug) as { id: number }).id;
	const r = upsertRound(db, upsertSeason(db, leagueId, 1, 'active'), { mlRoundId: ml, name: 'R', description: '', spotifyPlaylistUrl: '', createdAt: '2026-01-01T00:00:00Z' });
	db.prepare(`INSERT INTO digest_drafts (id, round_id, rel_context, prep_checks, stats_content_json, generated_at) VALUES (?, ?, '', '', '{}', '2026-11-04T00:00:00Z')`).run(`d-${r}`, r);
	db.prepare(`INSERT INTO digest_sections (id, draft_id, kind, position, state, content_json) VALUES (?, ?, 'podium', 0, 'default', ?)`).run(`d-${r}-p`, `d-${r}`, PODIUM);
	return r;
}
const finalize = (r: number) =>
	FINALIZE({ params: { roundId: String(r) }, request: new Request('http://x', { method: 'POST', body: JSON.stringify({ format: 'pdf' }) }) } as never) as Promise<Response>;
const coverDirs = () => (existsSync(join(DIGESTS, '_media/covers')) ? readdirSync(join(DIGESTS, '_media/covers')) : []);
const slotUrl = () => (db.prepare('SELECT public_url FROM cover_podium_slots').get() as { public_url: string | null }).public_url;
// Capture stub: renders the podium cover as an <img>, like the real page would.
const capture = async (r: number) => ({
	rawHtml: `<html><head></head><body><img src="${JSON.parse(podium(r)).items[0].coverUrl}"><script src="../_app/a.js"></script></body></html>`,
	assets: new Map([['/_app/a.js', Buffer.from('1')]]),
});
const noFonts = async () => null;

beforeAll(async () => {
	prevData = process.env.DATA_DIR;
	process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'cf-promote-routes-data-'));
	put('covers/o.png', await png('#444'));
	put('versions/a.png', await png('#a33'));
});
afterAll(() => {
	if (prevData === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = prevData;
});
beforeEach(() => {
	exportSeen.length = 0;
	rmSync(join(DIGESTS, '_media'), { recursive: true, force: true });
	rmSync(join(DIGESTS, 'd2'), { recursive: true, force: true });
	db = openLeagueDb(':memory:');
	seedLeagues(db);
	on = round('boarz-ii-men', 'on');
	off = round('sssc', 'off');
	pid = createProject(db, { title: 'T', source: 'round', round_id: on, spotify_uri: null, league_slug: 'boarz-ii-men', cover_rel: 'covers/o.png', cover_url: null }).id;
	const v = insertVersion(db, { project_id: pid, model_id: 'm', provider: 'openrouter', prompt: 'p', image_rel: 'versions/a.png', status: 'ok', error_reason: null }).id;
	updateProject(db, pid, { keeper_version_id: v });
	db.prepare(`INSERT INTO cover_podium_slots (round_id, rank, title, project_id, status, gif_rel, updated_at)
		VALUES (?, 1, 'Chaise Longue', ?, 'done', 'exports/1-ab.gif', 'then')`).run(on, pid);
});

describe('finalize', () => {
	it('promotes the done slot before the export runs', async () => {
		const res = await finalize(on);
		expect(res.status).toBe(200);
		const url = slotUrl();
		expect(url).toMatch(/\/_media\/covers\/[0-9a-f]{24}\/wipe\.gif$/);
		expect(exportSeen).toEqual([url]); // export saw the public URL, not the private one
		expect((await res.json()).warnings).toEqual([]);
	});
	it('a round with no slots: podium unchanged, no files, no warnings', async () => {
		const res = await finalize(off);
		expect(res.status).toBe(200);
		expect(podium(off)).toBe(PODIUM);
		expect(exportSeen).toEqual([PRIVATE]);
		expect(coverDirs()).toEqual([]);
		expect((await res.json()).warnings).toEqual([]);
	});
	it('a promotion failure is a warning, not a failed finalize', async () => {
		updateProject(db, pid, { keeper_version_id: null });
		const res = await finalize(on);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.warnings).toEqual([expect.stringMatching(/^podium cover promotion failed.*keeper/)]);
		expect(exportSeen).toEqual([PRIVATE]);
		expect(body.finalizedAt).toBeTruthy();
	});
});

describe('d2 publish', () => {
	it('promotes before capture, so the leak gate passes; a repeat publish reuses the same cover dir', async () => {
		const r1 = await publishDigest2(on, { capture, localizeFonts: noFonts });
		const url = slotUrl()!;
		expect(url).toMatch(/\/_media\/covers\/[0-9a-f]{24}\/wipe\.gif$/);
		const { readFile } = await import('node:fs/promises');
		expect(await readFile(join(DIGESTS, 'd2', r1.slug, 'index.html'), 'utf8')).toContain(`src="${url}"`);
		const dirs = coverDirs();
		expect(dirs).toHaveLength(1);
		expect(r1).not.toHaveProperty('coverWarning');

		const r2 = await publishDigest2(on, { capture, localizeFonts: noFonts });
		expect(r2.slug).toBe(r1.slug);
		expect(coverDirs()).toEqual(dirs);
		expect(slotUrl()).toBe(url);
	});
	it('promotion failed and the cover is still app-relative → leak gate blocks and says why', async () => {
		updateProject(db, pid, { keeper_version_id: null });
		await expect(publishDigest2(on, { capture, localizeFonts: noFonts })).rejects.toMatchObject({
			status: 422,
			message: expect.stringMatching(/root-relative[\s\S]*podium cover promotion failed.*keeper/),
		});
		expect(existsSync(join(DIGESTS, 'd2'))).toBe(false);
	});
});
