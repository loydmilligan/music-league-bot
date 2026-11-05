import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openLeagueDb } from '$lib/db/client.js';
import { seedLeagues, upsertSeason } from '$lib/db/leagues.js';
import { upsertRound } from '$lib/db/rounds.js';

const state = vi.hoisted(() => ({ db: null as unknown as Database.Database }));
vi.mock('$lib/db/client.js', async (orig) => {
	const actual = await orig<typeof import('$lib/db/client.js')>();
	return { ...actual, getDb: () => state.db };
});

import { createProject, logRequest } from './repo.js';
import { getState } from './service.js';
import { GET, POST } from '../../../routes/api/cover-factory/+server.js';

let db: Database.Database;
let roundId: number;

function round(slug: string, ml: string): number {
	const leagueId = (db.prepare('SELECT id FROM leagues WHERE slug = ?').get(slug) as { id: number }).id;
	return upsertRound(db, upsertSeason(db, leagueId, 1, 'active'), { mlRoundId: ml, name: 'Covers Round', description: '', spotifyPlaylistUrl: '', createdAt: '2026-01-01T00:00:00Z' });
}
const proj = (title: string) =>
	createProject(db, { title, source: 'round', round_id: roundId, spotify_uri: null, league_slug: 'second-best', cover_rel: 'uploads/x.jpg', cover_url: null } as never);
const get = async (qs: string) => {
	const r = await GET({ url: new URL(`http://x/api/cover-factory${qs}`) } as never);
	return { status: r.status, body: await r.json() };
};
const post = async (body: unknown) => {
	const r = await POST({ request: new Request('http://x/api/cover-factory', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) } as never);
	return { status: r.status, body: await r.json() };
};

beforeEach(() => {
	db = openLeagueDb(':memory:');
	state.db = db;
	seedLeagues(db);
	roundId = round('second-best', 'r-sb');
});

describe('auto-leagues', () => {
	it('GET lists every league with its toggle (defaults on for the three auto leagues)', async () => {
		const { status, body } = await get('?autoLeagues=1');
		expect(status).toBe(200);
		const by = Object.fromEntries((body.leagues as { slug: string; on: boolean }[]).map((l) => [l.slug, l.on]));
		expect(by['second-best']).toBe(true);
		expect(by['boarz-ii-men']).toBe(true);
		expect(by['sssc']).toBe(false);
		expect(Array.isArray(body.jobs)).toBe(true);
	});

	it('POST {action:auto-leagues, slug, on} persists and returns the new map', async () => {
		const off = await post({ action: 'auto-leagues', slug: 'second-best', on: false });
		expect(off.status).toBe(200);
		expect(off.body.leagues.find((l: { slug: string }) => l.slug === 'second-best').on).toBe(false);
		const again = await get('?autoLeagues=1');
		expect(again.body.leagues.find((l: { slug: string }) => l.slug === 'second-best').on).toBe(false);
		const stored = JSON.parse((db.prepare(`SELECT value FROM settings WHERE key = 'cover_factory_auto_leagues'`).get() as { value: string }).value);
		expect(stored['second-best']).toBe(false);
		await post({ action: 'auto-leagues', slug: 'sssc', on: true });
		expect((await get('?autoLeagues=1')).body.leagues.find((l: { slug: string }) => l.slug === 'sssc').on).toBe(true);
	});

	it('POST rejects an unknown league or a non-boolean', async () => {
		expect((await post({ action: 'auto-leagues', slug: 'nope', on: true })).status).toBe(400);
		expect((await post({ action: 'auto-leagues', slug: 'sssc', on: 'yes' })).status).toBe(400);
		expect(db.prepare(`SELECT 1 FROM settings WHERE key = 'cover_factory_auto_leagues'`).get()).toBeUndefined();
	});
});

describe('round slot panel', () => {
	it('GET ?autoRound=<id> → round, job, slots (with project title) and round spend', async () => {
		const p = proj('Linoleum — NOFX');
		logRequest(db, { project_id: p.id, version_id: null, step: 'read', model_id: 'm', provider: 'openrouter', cost_usd: 0.031, cost_estimated: 0, latency_ms: 1, outcome: 'ok', error_reason: null } as never);
		db.prepare(`INSERT INTO cover_podium_slots (round_id, rank, title, project_id, status, note, updated_at) VALUES (?, 1, 'Linoleum', ?, 'done', 'swapped submitter', '2026-11-04T00:00:00Z')`).run(roundId, p.id);
		db.prepare(`INSERT INTO cover_podium_slots (round_id, rank, title, status, note, updated_at) VALUES (?, 2, 'Handy', 'skipped', 'hand-made cover kept', '2026-11-04T00:00:00Z')`).run(roundId);
		db.prepare(`INSERT INTO cover_auto_jobs (round_id, status, cap_usd, created_at, updated_at) VALUES (?, 'done', 1, 'a', 'b')`).run(roundId);

		const { status, body } = await get(`?autoRound=${roundId}`);
		expect(status).toBe(200);
		expect(body.round).toMatchObject({ id: roundId, leagueSlug: 'second-best', autoOn: true });
		expect(body.job.status).toBe('done');
		expect(body.spendUsd).toBeCloseTo(0.031);
		expect(body.slots.map((s: { title: string; status: string }) => `${s.title}:${s.status}`)).toEqual(['Linoleum:done', 'Handy:skipped']);
		expect(body.slots[0].project_title).toBe('Linoleum — NOFX');

		const list = await get('?autoLeagues=1');
		expect(list.body.jobs).toEqual([expect.objectContaining({ round_id: roundId, status: 'done', leagueSlug: 'second-best' })]);
	});

	it('GET ?autoRound for a round with nothing queued → job null, no slots; unknown round → 404', async () => {
		const { body } = await get(`?autoRound=${roundId}`);
		expect(body).toMatchObject({ job: null, slots: [], spendUsd: 0 });
		expect((await get('?autoRound=99999')).status).toBe(404);
		expect((await get('?autoRound=abc')).status).toBe(400);
	});
});

describe('project podium link', () => {
	it('project state carries the podium slot it fills (null when unlinked)', async () => {
		const p = proj('t');
		const q = new URLSearchParams({ project: String(p.id) });
		expect(((await getState(db, q)) as { podiumSlot: unknown }).podiumSlot).toBeNull();
		db.prepare(`INSERT INTO cover_podium_slots (round_id, rank, title, project_id, status, updated_at) VALUES (?, 2, 'T', ?, 'done', 'x')`).run(roundId, p.id);
		expect(((await getState(db, q)) as { podiumSlot: unknown }).podiumSlot).toEqual({ round_id: roundId, rank: 2, status: 'done' });
	});
});
