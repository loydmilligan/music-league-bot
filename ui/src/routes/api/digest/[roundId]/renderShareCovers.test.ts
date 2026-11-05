// Cover Factory piece 5: every path that writes the PUBLIC 1.0 html share (export html, manual render,
// the bot's send-claim) promotes podium auto covers first, and the share transform refuses to publish
// a private /api/cover-factory/ URL. Capture is stubbed (no Puppeteer); temp dirs + in-memory DB only.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
vi.mock('$lib/db/client.js', async (orig) => ({ ...(await orig<typeof import('$lib/db/client.js')>()), getDb: () => db }));
// The routes call renderDigestHtml(roundId); route it through the real function with the capture stubbed.
const captured: string[] = [];
vi.mock('$lib/digest/export.js', async (orig) => {
	const actual = await orig<typeof import('$lib/digest/export.js')>();
	return {
		...actual,
		renderDigestHtml: (roundId: number) =>
			actual.renderDigestHtml(roundId, {
				capture: async (r: number) => {
					const cover = JSON.parse(podium(r)).items[0].coverUrl;
					captured.push(cover);
					return {
						rawHtml: `<html><head></head><body><div class="dg-export"><img src="${cover}"></div><script src="../_app/a.js"></script></body></html>`,
						assets: new Map([['/_app/a.js', Buffer.from('1')]]),
					};
				},
				localizeFonts: async () => null,
			}),
	};
});
vi.mock('$lib/digest/schedule.js', async (orig) => ({
	...(await orig<typeof import('$lib/digest/schedule.js')>()),
	resolveScheduledDigest: vi.fn((_db: unknown, _l: number) => ({ action: 'send', roundId: sendRound, reason: 'test' })),
}));

const DIGESTS = mkdtempSync(join(tmpdir(), 'cf-render-share-dig-'));
vi.stubEnv('DIGESTS_DIR', DIGESTS);
const { POST: RENDER } = await import('./render/+server.js');
const { POST: EXPORT } = await import('./export/+server.js');
const { POST: SEND_CLAIM } = await import('./send-claim/+server.js');
const { transformShareHtml } = await import('$lib/digest/export.js');

const PRIVATE = '/api/cover-factory/media/exports/1-ab.gif';
const SPOT = 'https://i.scdn.co/image/abc';
const PODIUM = JSON.stringify({ title: 'Podium', items: [{ rank: 1, title: 'Chaise Longue', artist: 'Wet Leg', coverUrl: PRIVATE }] });
const PLAIN = JSON.stringify({ title: 'Podium', items: [{ rank: 1, title: 'Plain', artist: 'P', coverUrl: SPOT }] });

let prevData: string | undefined;
let on: number;
let off: number;
let pid: number;
let sendRound = 0;

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
function round(slug: string, ml: string, content: string): number {
	const leagueId = (db.prepare('SELECT id FROM leagues WHERE slug = ?').get(slug) as { id: number }).id;
	const r = upsertRound(db, upsertSeason(db, leagueId, 1, 'active'), { mlRoundId: ml, name: 'R', description: '', spotifyPlaylistUrl: '', createdAt: '2026-01-01T00:00:00Z' });
	db.prepare(`INSERT INTO digest_drafts (id, round_id, rel_context, prep_checks, stats_content_json, generated_at) VALUES (?, ?, '', '', '{}', '2026-11-04T00:00:00Z')`).run(`d-${r}`, r);
	db.prepare(`INSERT INTO digest_sections (id, draft_id, kind, position, state, content_json) VALUES (?, ?, 'podium', 0, 'default', ?)`).run(`d-${r}-p`, `d-${r}`, content);
	return r;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const post = (h: (e: any) => unknown, r: number, body?: unknown) =>
	h({ params: { roundId: String(r) }, request: new Request('http://x', { method: 'POST', body: JSON.stringify(body ?? {}) }) } as never) as Promise<Response>;
const shareHtml = (r: number) => {
	const slug = (db.prepare('SELECT slug FROM digest_shares WHERE round_id = ?').get(r) as { slug: string }).slug;
	return readFileSync(join(DIGESTS, 'd', slug, 'index.html'), 'utf8');
};
const shareDirs = () => (existsSync(join(DIGESTS, 'd')) ? readdirSync(join(DIGESTS, 'd')) : []);
const coverDirs = () => (existsSync(join(DIGESTS, '_media/covers')) ? readdirSync(join(DIGESTS, '_media/covers')) : []);
const slotUrl = () => (db.prepare('SELECT public_url FROM cover_podium_slots').get() as { public_url: string | null }).public_url;
const status = async (p: Promise<Response>) => p.then((r) => r.status, (e: { status?: number }) => e.status ?? 500);

beforeAll(async () => {
	prevData = process.env.DATA_DIR;
	process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'cf-render-share-data-'));
	put('covers/o.png', await png('#444'));
	put('versions/a.png', await png('#a33'));
});
afterAll(() => {
	if (prevData === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = prevData;
});
beforeEach(() => {
	captured.length = 0;
	rmSync(join(DIGESTS, '_media'), { recursive: true, force: true });
	rmSync(join(DIGESTS, 'd'), { recursive: true, force: true });
	db = openLeagueDb(':memory:');
	seedLeagues(db);
	on = round('boarz-ii-men', 'on', PODIUM);
	off = round('sssc', 'off', PLAIN);
	pid = createProject(db, { title: 'T', source: 'round', round_id: on, spotify_uri: null, league_slug: 'boarz-ii-men', cover_rel: 'covers/o.png', cover_url: null }).id;
	const v = insertVersion(db, { project_id: pid, model_id: 'm', provider: 'openrouter', prompt: 'p', image_rel: 'versions/a.png', status: 'ok', error_reason: null }).id;
	updateProject(db, pid, { keeper_version_id: v });
	db.prepare(`INSERT INTO cover_podium_slots (round_id, rank, title, project_id, status, gif_rel, updated_at)
		VALUES (?, 1, 'Chaise Longue', ?, 'done', 'exports/1-ab.gif', 'then')`).run(on, pid);
});

describe('public 1.0 html share promotes podium covers first', () => {
	it('render route: the done slot is shared and the written share carries its public URL', async () => {
		const res = await post(RENDER, on);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).not.toHaveProperty('coverWarning');
		const url = slotUrl()!;
		expect(url).toMatch(/\/_media\/covers\/[0-9a-f]{24}\/wipe\.gif$/);
		expect(captured).toEqual([url]); // the capture already saw the public URL
		const html = shareHtml(on);
		expect(html).toContain(`src="${url}"`);
		expect(html).not.toContain('/api/cover-factory/');
	});
	it('html export route: same promotion', async () => {
		const res = await post(EXPORT, on, { format: 'html' });
		expect(res.status).toBe(200);
		expect(shareHtml(on)).toContain(`src="${slotUrl()}"`);
	});
	it('send-claim: promotes, then hands the bot the share URL', async () => {
		sendRound = on;
		const res = await post(SEND_CLAIM, on);
		const body = await res.json();
		expect(body.claimed).toBe(true);
		expect(shareHtml(on)).toContain(`src="${slotUrl()}"`);
	});
	it('promotion fails and a private URL remains → nothing is published; send-claim releases its claim', async () => {
		updateProject(db, pid, { keeper_version_id: null });
		expect(await status(post(RENDER, on))).toBe(502);
		expect(shareDirs()).toEqual([]);
		sendRound = on;
		expect(await status(post(SEND_CLAIM, on))).toBe(502);
		expect(db.prepare('SELECT COUNT(*) AS n FROM digest_sends WHERE round_id = ?').get(on)).toEqual({ n: 0 });
		expect(shareDirs()).toEqual([]);
	});
	it('a round without slots: podium unchanged, no cover files, share = the captured page', async () => {
		const res = await post(RENDER, off);
		expect(res.status).toBe(200);
		expect(podium(off)).toBe(PLAIN);
		expect(coverDirs()).toEqual([]);
		expect(captured).toEqual([SPOT]);
		expect(shareHtml(off)).toContain(`src="${SPOT}"`);
	});
});

describe('transformShareHtml private-URL guard', () => {
	it('throws, naming the URL and the promotion error, when /api/cover-factory/ remains', () => {
		const html = `<html><head></head><body><img src="${PRIVATE}"></body></html>`;
		expect(() => transformShareHtml(html, { hasLocalFonts: false })).toThrow(/share blocked: a private Cover Factory URL.*exports\/1-ab\.gif/);
		expect(() => transformShareHtml(html, { hasLocalFonts: false }, 'boom')).toThrow(/podium cover promotion failed: boom/);
		// in inline load data too
		expect(() => transformShareHtml(`<head></head><script>{"coverUrl":"${PRIVATE}"}</script>`, { hasLocalFonts: false })).toThrow();
	});
	it('passes pages without one', () => {
		expect(transformShareHtml(`<head></head><img src="${SPOT}">`, { hasLocalFonts: false })).toContain(SPOT);
	});
});
