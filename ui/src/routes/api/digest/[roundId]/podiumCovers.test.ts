// Cover Factory piece 5: keeper re-apply hooks on the podium write paths. OFF-league (no slot rows)
// drafts must come out byte-identical; a round with a done slot gets the keeper cover re-applied.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openLeagueDb } from '$lib/db/client.js';
import { seedLeagues, upsertSeason } from '$lib/db/leagues.js';
import { upsertRound } from '$lib/db/rounds.js';

let db: Database.Database;
const LLM_PODIUM = {
	title: 'Podium',
	body: 'b',
	items: [
		{ rank: 1, title: 'Chaise Longue', artist: 'Wet Leg', submitter: 'Jon', points: 9 },
		{ rank: 2, title: 'Teenage Dirtbag', artist: 'Wheatus', submitter: 'Ann', points: 7 },
	],
};

vi.mock('$lib/db/client.js', async (orig) => {
	const actual = await orig<typeof import('$lib/db/client.js')>();
	return { ...actual, getDb: () => db };
});
vi.mock('$lib/digest/albumArt.js', () => ({ ensureAlbumArt: vi.fn(async () => {}) }));
vi.mock('$lib/lastfm.js', () => ({ recomputePopularityProxies: vi.fn(async () => {}) }));
vi.mock('$lib/digest/llm.js', async (orig) => {
	const actual = await orig<typeof import('$lib/digest/llm.js')>();
	return {
		...actual,
		generateDraft: vi.fn(async () => ({ sections: { podium: structuredClone(LLM_PODIUM) }, costUsd: 0 })),
		regenerateOneSection: vi.fn(async (_d: unknown, kind: string, prior: unknown) =>
			({ section: kind === 'podium' ? structuredClone(LLM_PODIUM) : prior, costUsd: 0 })),
	};
});

import { POST as DRAFT } from './draft/+server.js';
import { POST as REGEN } from './regenerate/+server.js';
import { POST as REGEN_ONE } from './sections/[id]/regenerate/+server.js';

const ART1 = 'https://i.scdn.co/image/one';
const ART2 = 'https://i.scdn.co/image/two';
const GIF = '/api/cover-factory/media/exports/5-ab.gif';

function setupRound(slug: string, ml: string): number {
	const leagueId = (db.prepare('SELECT id FROM leagues WHERE slug = ?').get(slug) as { id: number }).id;
	const seasonId = upsertSeason(db, leagueId, 1, 'active');
	const r = upsertRound(db, seasonId, { mlRoundId: ml, name: 'R', description: '', spotifyPlaylistUrl: '', createdAt: '2026-01-01T00:00:00Z' });
	db.prepare(`INSERT OR IGNORE INTO competitors (id, ml_competitor_id, name) VALUES (1, 'c1', 'Jon'), (2, 'c2', 'Ann')`).run();
	db.prepare(`INSERT INTO ml_submissions (round_id, competitor_id, spotify_uri, title, artists, created_at, album_art_url) VALUES
		(?, 1, ?, 'Chaise Longue', 'Wet Leg', 'x', ?), (?, 2, ?, 'Teenage Dirtbag', 'Wheatus', 'x', ?)`)
		.run(r, `${ml}-1`, ART1, r, `${ml}-2`, ART2);
	return r;
}
const call = (h: (e: never) => unknown, params: Record<string, string>, body: unknown = {}) =>
	h({ params, request: new Request('http://x', { method: 'POST', body: JSON.stringify(body) }) } as never) as Promise<Response>;
const podium = (roundId: number): string =>
	(db.prepare(`SELECT s.content_json FROM digest_sections s JOIN digest_drafts d ON d.id = s.draft_id
		WHERE d.round_id = ? AND s.kind = 'podium' ORDER BY d.generated_at DESC LIMIT 1`).get(roundId) as { content_json: string }).content_json;
const doneSlot = (roundId: number) =>
	db.prepare(`INSERT INTO cover_podium_slots (round_id, rank, title, status, note, gif_rel, updated_at)
		VALUES (?, 1, 'Chaise Longue', 'done', 'main replaced', 'exports/5-ab.gif', 'now')`).run(roundId);

// What the pre-hook code paths store for an OFF league: the LLM podium + Spotify art via enrichPodiumArt.
const ENRICHED = JSON.stringify({ ...LLM_PODIUM, items: [{ ...LLM_PODIUM.items[0], coverUrl: ART1 }, { ...LLM_PODIUM.items[1], coverUrl: ART2 }] });

let on: number;
let off: number;
beforeEach(() => {
	db = openLeagueDb(':memory:');
	seedLeagues(db);
	on = setupRound('boarz-ii-men', 'on');
	off = setupRound('sssc', 'off');
	doneSlot(on); // slots exist for the ON round only — the OFF round must not be touched
});

describe('draft route', () => {
	it('fresh draft: OFF round podium is byte-identical to the enriched LLM output', async () => {
		const res = await call(DRAFT, { roundId: String(off) }, { force: true });
		expect(res.status).toBe(200);
		expect(podium(off)).toBe(ENRICHED);
		const body = await res.json();
		expect(body.sections.find((s: { kind: string }) => s.kind === 'podium').content_json).toBe(ENRICHED);
	});
	it('fresh draft: a done slot re-applies the keeper cover and is in the response', async () => {
		const res = await call(DRAFT, { roundId: String(on) }, { force: true });
		const stored = JSON.parse(podium(on));
		expect(stored.items[0].coverUrl).toBe(GIF);
		expect(stored.items[1].coverUrl).toBe(ART2);
		expect(stored._coverNotes).toEqual({ '1': 'main replaced' });
		const body = await res.json();
		expect(JSON.parse(body.sections.find((s: { kind: string }) => s.kind === 'podium').content_json).items[0].coverUrl).toBe(GIF);
	});
	it('cached draft: OFF round untouched, ON round backfilled with the keeper', async () => {
		await call(DRAFT, { roundId: String(off) }, { force: true });
		const before = podium(off);
		await call(DRAFT, { roundId: String(off) }, null);
		expect(podium(off)).toBe(before);

		await call(DRAFT, { roundId: String(on) }, { force: true });
		db.prepare(`UPDATE digest_sections SET content_json = ? WHERE kind = 'podium' AND draft_id IN (SELECT id FROM digest_drafts WHERE round_id = ?)`).run(JSON.stringify(LLM_PODIUM), on);
		const res = await call(DRAFT, { roundId: String(on) }, null);
		expect((await res.json()).cached).toBe(true);
		expect(JSON.parse(podium(on)).items[0].coverUrl).toBe(GIF);
	});
});

describe('regenerate routes', () => {
	it('whole regen re-applies the keeper; OFF round gets plain enriched art', async () => {
		await call(DRAFT, { roundId: String(on) }, { force: true });
		await call(DRAFT, { roundId: String(off) }, { force: true });
		await call(REGEN, { roundId: String(on) });
		await call(REGEN, { roundId: String(off) });
		expect(JSON.parse(podium(on)).items[0].coverUrl).toBe(GIF);
		expect(podium(off)).toBe(ENRICHED);
	});
	it('single-section podium regen re-applies the keeper', async () => {
		await call(DRAFT, { roundId: String(on) }, { force: true });
		const id = (db.prepare(`SELECT s.id FROM digest_sections s JOIN digest_drafts d ON d.id = s.draft_id WHERE d.round_id = ? AND s.kind = 'podium'`).get(on) as { id: string }).id;
		const res = await call(REGEN_ONE, { roundId: String(on), id });
		expect(JSON.parse(podium(on)).items[0].coverUrl).toBe(GIF);
		expect(JSON.parse((await res.json()).section.content_json).items[0].coverUrl).toBe(GIF);
	});
});
