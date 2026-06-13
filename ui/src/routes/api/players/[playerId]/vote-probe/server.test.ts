import { it, expect, vi, beforeEach, describe } from 'vitest';
import { openLeagueDb } from '$lib/db/client.js';

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

function postEvt(playerId: number | string, body: unknown) {
	return {
		params: { playerId: String(playerId) },
		request: { json: async () => body } as unknown as Request,
	} as unknown as Parameters<typeof POST>[0];
}

const FIXTURE_OUTPUT = {
	upvote_likelihood: 72,
	expected_points: 4,
	confidence: 'medium' as const,
	reasoning: 'Player gave 5 pts to similar synth-pop in round 3.',
	signals: ['synth-pop affinity', 'atmospheric production'],
};

const VALID_BODY = {
	song: { title: 'Blue Monday', artist: 'New Order' },
	theme: { name: '80s Bangers', description: 'Songs that defined the 1980s' },
};

// ── POST /api/players/:playerId/vote-probe ────────────────────────────────────

describe('POST /api/players/:playerId/vote-probe', () => {
	it('returns 200 with the SAS output', async () => {
		const id = mkPlayer();
		mockCallOpenRouter.mockResolvedValueOnce({ content: JSON.stringify(FIXTURE_OUTPUT), costUsd: 0.007 });

		const res = await POST(postEvt(id, VALID_BODY));
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.upvote_likelihood).toBe(72);
		expect(body.expected_points).toBe(4);
		expect(body.confidence).toBe('medium');
		expect(body.reasoning.length).toBeGreaterThan(0);
		expect(Array.isArray(body.signals)).toBe(true);
	});

	it('writes one prediction_runs row with task_id = vote-probe', async () => {
		const id = mkPlayer();
		mockCallOpenRouter.mockResolvedValueOnce({ content: JSON.stringify(FIXTURE_OUTPUT), costUsd: 0 });

		await POST(postEvt(id, VALID_BODY));

		const count = (db.prepare('SELECT COUNT(*) as n FROM prediction_runs').get() as { n: number }).n;
		expect(count).toBe(1);
		const run = db.prepare('SELECT task_id, player_id FROM prediction_runs').get() as {
			task_id: string;
			player_id: number;
		};
		expect(run.task_id).toBe('vote-probe');
		expect(run.player_id).toBe(id);
	});

	it('includes model and cost_usd in response', async () => {
		const id = mkPlayer();
		mockCallOpenRouter.mockResolvedValueOnce({ content: JSON.stringify(FIXTURE_OUTPUT), costUsd: 0.009 });

		const res = await POST(postEvt(id, VALID_BODY));
		const body = await res.json();
		expect(typeof body.model).toBe('string');
		expect(typeof body.cost_usd).toBe('number');
		expect(typeof body.latency_ms).toBe('number');
	});

	it('passes spotify_url when provided', async () => {
		const id = mkPlayer();
		mockCallOpenRouter.mockResolvedValueOnce({ content: JSON.stringify(FIXTURE_OUTPUT), costUsd: 0 });

		const bodyWithUrl = {
			song: { title: 'Blue Monday', artist: 'New Order', spotify_url: 'https://open.spotify.com/track/abc' },
			theme: { name: '80s', description: 'Eighties hits' },
		};
		const res = await POST(postEvt(id, bodyWithUrl));
		expect(res.status).toBe(200);
	});

	it('returns 404 for unknown player', async () => {
		await expect(POST(postEvt(99999, VALID_BODY))).rejects.toMatchObject({ status: 404 });
	});

	it('returns 400 for invalid playerId', async () => {
		await expect(POST(postEvt('abc', VALID_BODY))).rejects.toMatchObject({ status: 400 });
	});

	it('returns 400 when body is missing song', async () => {
		const id = mkPlayer();
		await expect(
			POST(postEvt(id, { theme: VALID_BODY.theme })),
		).rejects.toMatchObject({ status: 400 });
	});

	it('returns 400 when body is missing theme', async () => {
		const id = mkPlayer();
		await expect(
			POST(postEvt(id, { song: VALID_BODY.song })),
		).rejects.toMatchObject({ status: 400 });
	});

	it('returns 400 when song.title is missing', async () => {
		const id = mkPlayer();
		await expect(
			POST(postEvt(id, { song: { artist: 'New Order' }, theme: VALID_BODY.theme })),
		).rejects.toMatchObject({ status: 400 });
	});

	it('returns 400 when song.artist is missing', async () => {
		const id = mkPlayer();
		await expect(
			POST(postEvt(id, { song: { title: 'Blue Monday' }, theme: VALID_BODY.theme })),
		).rejects.toMatchObject({ status: 400 });
	});

	it('returns 400 when theme.name is missing', async () => {
		const id = mkPlayer();
		await expect(
			POST(postEvt(id, { song: VALID_BODY.song, theme: { description: 'ok' } })),
		).rejects.toMatchObject({ status: 400 });
	});

	it('returns 400 when body is not valid JSON', async () => {
		const id = mkPlayer();
		const badEvt = {
			params: { playerId: String(id) },
			request: { json: async () => { throw new SyntaxError('bad json'); } } as unknown as Request,
		} as unknown as Parameters<typeof POST>[0];
		await expect(POST(badEvt)).rejects.toMatchObject({ status: 400 });
	});
});
