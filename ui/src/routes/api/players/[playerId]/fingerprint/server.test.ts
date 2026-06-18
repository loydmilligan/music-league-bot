import { it, expect, vi, beforeEach, describe } from 'vitest';
import { openLeagueDb } from '$lib/db/client.js';
import type Database from 'better-sqlite3';

const db = openLeagueDb(':memory:');

vi.mock('$lib/db/client.js', async (orig) => {
	const actual = await orig<typeof import('$lib/db/client.js')>();
	return { ...actual, getDb: () => db };
});

vi.mock('$lib/digest/llm.js', () => ({
	callOpenRouter: vi.fn(),
}));

import { callOpenRouter } from '$lib/digest/llm.js';
const mockCallOpenRouter = vi.mocked(callOpenRouter);

let POST: typeof import('./+server.js').POST;

beforeEach(async () => {
	db.prepare('DELETE FROM prediction_runs').run();
	db.prepare('DELETE FROM player_profiles').run();
	db.prepare('DELETE FROM players').run();
	vi.clearAllMocks();
	({ POST } = await import('./+server.js'));
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function mkPlayer(name = 'Alice'): number {
	db.prepare('INSERT INTO players (name) VALUES (?)').run(name);
	return (db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id;
}

function postEvt(playerId: number | string) {
	return { params: { playerId: String(playerId) } } as unknown as Parameters<typeof POST>[0];
}

const FIXTURE_FINGERPRINT = {
	signature_artists: ['The Cure', 'Massive Attack'],
	genres: ['post-punk', 'trip-hop'],
	eras: ['80s', '90s'],
	rewards: ['atmospheric production'],
	punishes: ['mainstream pop'],
	summary: 'Drawn to dark, atmospheric sounds.',
	confidence: 'medium' as const,
};

// ── POST /api/players/:playerId/fingerprint ───────────────────────────────────

describe('POST /api/players/:playerId/fingerprint', () => {
	it('returns 200 with the fingerprint and provenance', async () => {
		const id = mkPlayer();
		mockCallOpenRouter.mockResolvedValueOnce({
			content: JSON.stringify(FIXTURE_FINGERPRINT),
			costUsd: 0.006,
			promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0,
		});

		const res = await POST(postEvt(id));
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.fingerprint).toEqual(FIXTURE_FINGERPRINT);
		expect(typeof body.model).toBe('string');
		expect(typeof body.cost_usd).toBe('number');
		expect(body.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
	});

	it('persists fingerprint to player_profiles', async () => {
		const id = mkPlayer();
		mockCallOpenRouter.mockResolvedValueOnce({
			content: JSON.stringify(FIXTURE_FINGERPRINT),
			costUsd: 0,
			promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0,
		});

		await POST(postEvt(id));

		const row = db
			.prepare('SELECT taste_fingerprint FROM player_profiles WHERE player_id = ?')
			.get(id) as { taste_fingerprint: string };
		expect(JSON.parse(row.taste_fingerprint)).toEqual(FIXTURE_FINGERPRINT);
	});

	it('also writes one prediction_runs row', async () => {
		const id = mkPlayer();
		mockCallOpenRouter.mockResolvedValueOnce({
			content: JSON.stringify(FIXTURE_FINGERPRINT),
			costUsd: 0,
			promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0,
		});

		await POST(postEvt(id));

		const count = (db.prepare('SELECT COUNT(*) as n FROM prediction_runs').get() as { n: number }).n;
		expect(count).toBe(1);
		const run = db.prepare('SELECT task_id, player_id FROM prediction_runs').get() as {
			task_id: string;
			player_id: number;
		};
		expect(run.task_id).toBe('taste-fingerprint');
		expect(run.player_id).toBe(id);
	});

	it('returns 404 for unknown player', async () => {
		await expect(POST(postEvt(99999))).rejects.toMatchObject({ status: 404 });
	});

	it('returns 400 for invalid playerId', async () => {
		await expect(POST(postEvt('abc'))).rejects.toMatchObject({ status: 400 });
	});
});
