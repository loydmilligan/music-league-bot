// Cover Factory piece 5: promotePodiumCovers — done slots get a public share + podium coverUrl rewrite.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import type Database from 'better-sqlite3';
import { openLeagueDb } from '$lib/db/client.js';
import { seedLeagues, upsertSeason } from '$lib/db/leagues.js';
import { upsertRound } from '$lib/db/rounds.js';
import { digestBaseUrl } from '$lib/config/urls.js';
import { coverFile } from './paths.js';
import { createProject, insertVersion, updateProject } from './repo.js';
import { promotePodiumCovers } from './podium.js';

let db: Database.Database;
let roundId: number;
let offRoundId: number;
let digests = '';
let prevData: string | undefined;

const SPOT = 'https://i.scdn.co/image/abc';
const PODIUM = JSON.stringify({
	title: 'Podium',
	items: [
		{ rank: 1, title: 'Chaise Longue', artist: 'Wet Leg', coverUrl: '/api/cover-factory/media/exports/1-ab.gif' },
		{ rank: 2, title: 'Two', artist: 'X', coverUrl: SPOT },
	],
});

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
	return upsertRound(db, upsertSeason(db, leagueId, 1, 'active'), { mlRoundId: ml, name: 'R', description: '', spotifyPlaylistUrl: '', createdAt: '2026-01-01T00:00:00Z' });
}
function draft(r: number): void {
	db.prepare(`INSERT INTO digest_drafts (id, round_id, rel_context, prep_checks, generated_at) VALUES (?, ?, '', '', '2026-11-04T00:00:00Z')`).run(`d-${r}`, r);
	db.prepare(`INSERT INTO digest_sections (id, draft_id, kind, position, state, content_json) VALUES (?, ?, 'podium', 0, 'default', ?)`).run(`d-${r}-p`, `d-${r}`, PODIUM);
}
async function project(): Promise<{ pid: number; v1: number; v2: number }> {
	const pid = createProject(db, { title: 'T', source: 'round', round_id: roundId, spotify_uri: null, league_slug: 'boarz-ii-men', cover_rel: 'covers/o.png', cover_url: null }).id;
	const base = { project_id: pid, model_id: 'm', provider: 'openrouter', prompt: 'p', status: 'ok' as const, error_reason: null };
	const v1 = insertVersion(db, { ...base, image_rel: 'versions/a.png' }).id;
	const v2 = insertVersion(db, { ...base, image_rel: 'versions/b.png' }).id;
	updateProject(db, pid, { keeper_version_id: v1 });
	return { pid, v1, v2 };
}
function slot(o: { round?: number; rank: number; title: string; project: number | null; status?: string; publicUrl?: string | null }): void {
	db.prepare(`INSERT INTO cover_podium_slots (round_id, rank, title, project_id, status, public_url, gif_rel, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, 'exports/1-ab.gif', 'then')`).run(o.round ?? roundId, o.rank, o.title, o.project, o.status ?? 'done', o.publicUrl ?? null);
}
const podium = (r: number) => (db.prepare(`SELECT content_json FROM digest_sections WHERE id = ?`).get(`d-${r}-p`) as { content_json: string }).content_json;
const coverDirs = () => (existsSync(join(digests, '_media/covers')) ? readdirSync(join(digests, '_media/covers')) : []);
const PUBLIC = new RegExp(`^${digestBaseUrl().replace(/[.]/g, '\\.')}/_media/covers/[0-9a-f]{24}/wipe\\.gif$`);

beforeAll(async () => {
	prevData = process.env.DATA_DIR;
	process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'cf-promote-data-'));
	put('covers/o.png', await png('#444'));
	put('versions/a.png', await png('#a33'));
	put('versions/b.png', await png('#3a3'));
});
afterAll(() => {
	if (prevData === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = prevData;
});
beforeEach(() => {
	digests = mkdtempSync(join(tmpdir(), 'cf-promote-dig-'));
	db = openLeagueDb(':memory:');
	seedLeagues(db);
	roundId = round('boarz-ii-men', 'on');
	offRoundId = round('sssc', 'off');
	draft(roundId);
	draft(offRoundId);
});

describe('promotePodiumCovers', () => {
	it('no slots → 0, no DB writes, no files', async () => {
		const { pid } = await project();
		slot({ rank: 1, title: 'Chaise Longue', project: pid }); // the OTHER round's slot
		const before = JSON.stringify(db.prepare('SELECT * FROM cover_projects').all());
		const changes = db.prepare('SELECT total_changes() AS n').get() as { n: number };
		expect(await promotePodiumCovers(db, offRoundId, digests)).toBe(0);
		expect((db.prepare('SELECT total_changes() AS n').get() as { n: number }).n).toBe(changes.n);
		expect(podium(offRoundId)).toBe(PODIUM);
		expect(JSON.stringify(db.prepare('SELECT * FROM cover_projects').all())).toBe(before);
		expect(coverDirs()).toEqual([]);
	});

	it('shares a done slot, stores public_url and rewrites the podium coverUrl; repeat reuses the dir', async () => {
		const { pid } = await project();
		slot({ rank: 1, title: 'Chaise Longue', project: pid });
		expect(await promotePodiumCovers(db, roundId, digests)).toBe(1);
		const url = (db.prepare('SELECT public_url FROM cover_podium_slots').get() as { public_url: string }).public_url;
		expect(url).toMatch(PUBLIC);
		const items = JSON.parse(podium(roundId)).items;
		expect(items[0].coverUrl).toBe(url);
		expect(items[1].coverUrl).toBe(SPOT);
		expect(coverDirs()).toHaveLength(1);

		expect(await promotePodiumCovers(db, roundId, digests)).toBe(0);
		expect(coverDirs()).toHaveLength(1);
		expect(JSON.parse(podium(roundId)).items[0].coverUrl).toBe(url);
	});

	it('a changed keeper (public_url cleared) gets a new dir', async () => {
		const { pid, v2 } = await project();
		slot({ rank: 1, title: 'Chaise Longue', project: pid });
		await promotePodiumCovers(db, roundId, digests);
		const first = (db.prepare('SELECT public_url FROM cover_podium_slots').get() as { public_url: string }).public_url;
		updateProject(db, pid, { keeper_version_id: v2 });
		db.prepare('UPDATE cover_podium_slots SET public_url = NULL').run();
		expect(await promotePodiumCovers(db, roundId, digests)).toBe(1);
		const second = (db.prepare('SELECT public_url FROM cover_podium_slots').get() as { public_url: string }).public_url;
		expect(second).toMatch(PUBLIC);
		expect(second).not.toBe(first);
		expect(JSON.parse(podium(roundId)).items[0].coverUrl).toBe(second);
	});

	it('skips non-done slots; a failing slot throws after the others are promoted', async () => {
		const { pid } = await project();
		const broken = createProject(db, { title: 'B', source: 'round', round_id: roundId, spotify_uri: null, league_slug: 'boarz-ii-men', cover_rel: 'covers/o.png', cover_url: null }).id;
		slot({ rank: 1, title: 'Chaise Longue', project: pid });
		slot({ rank: 2, title: 'Two', project: broken }); // done but no keeper
		slot({ rank: 3, title: 'Three', project: pid, status: 'failed' });
		await expect(promotePodiumCovers(db, roundId, digests)).rejects.toThrow(/rank 2 "Two".*keeper/);
		const rows = db.prepare('SELECT rank, public_url FROM cover_podium_slots ORDER BY rank').all() as { rank: number; public_url: string | null }[];
		expect(rows[0].public_url).toMatch(PUBLIC);
		expect(rows[1].public_url).toBeNull();
		expect(rows[2].public_url).toBeNull();
		expect(JSON.parse(podium(roundId)).items[0].coverUrl).toBe(rows[0].public_url);
	});
});
