import { it, expect, describe, vi, beforeEach } from 'vitest';
import { openLeagueDb } from '../../db/client.js';
import { runVoteProbe, VoteProbeOutputSchema, voteProbeTask } from './voteProbe.js';
import type Database from 'better-sqlite3';

vi.mock('../../digest/llm.js', () => ({
	callOpenRouter: vi.fn(),
}));

import { callOpenRouter } from '../../digest/llm.js';
const mockCallOpenRouter = vi.mocked(callOpenRouter);

const FIXTURE_OUTPUT = {
	upvote_likelihood: 72,
	expected_points: 4,
	confidence: 'medium' as const,
	reasoning: 'Player gave 5 pts to similar synth-pop in round 3 and consistently rewards atmospheric production.',
	signals: ['synth-pop affinity', 'atmospheric production', 'electronic 80s'],
};
const FIXTURE_JSON = JSON.stringify(FIXTURE_OUTPUT);

const FIXTURE_SONG = { title: 'Blue Monday', artist: 'New Order' };
const FIXTURE_THEME = { name: '80s Bangers', description: 'Songs that defined the 1980s' };

function seedPlayer(db: Database.Database, name = 'TestPlayer'): number {
	db.prepare('INSERT INTO players (name) VALUES (?)').run(name);
	return (db.prepare('SELECT last_insert_rowid() as id').get() as { id: number }).id;
}

let db: Database.Database;
beforeEach(() => {
	db = openLeagueDb(':memory:');
	vi.clearAllMocks();
});

// ── Happy path ─────────────────────────────────────────────────────────────────

describe('runVoteProbe — happy path', () => {
	it('returns the parsed SAS output and meta', async () => {
		const playerId = seedPlayer(db);
		mockCallOpenRouter.mockResolvedValueOnce({ content: FIXTURE_JSON, costUsd: 0.007 });

		const { output, meta } = await runVoteProbe(db, playerId, { song: FIXTURE_SONG, theme: FIXTURE_THEME });

		expect(output).toEqual(FIXTURE_OUTPUT);
		expect(meta.model).toBe(voteProbeTask.model);
		expect(meta.costUsd).toBe(0.007);
		expect(meta.latencyMs).toBeGreaterThanOrEqual(0);
	});

	it('reasoning is non-empty', async () => {
		const playerId = seedPlayer(db);
		mockCallOpenRouter.mockResolvedValueOnce({ content: FIXTURE_JSON, costUsd: 0 });

		const { output } = await runVoteProbe(db, playerId, { song: FIXTURE_SONG, theme: FIXTURE_THEME });

		expect(output.reasoning.length).toBeGreaterThan(0);
	});

	it('writes one prediction_runs row with task_id = vote-probe', async () => {
		const playerId = seedPlayer(db);
		mockCallOpenRouter.mockResolvedValueOnce({ content: FIXTURE_JSON, costUsd: 0 });

		await runVoteProbe(db, playerId, { song: FIXTURE_SONG, theme: FIXTURE_THEME });

		const count = (db.prepare('SELECT COUNT(*) as n FROM prediction_runs').get() as { n: number }).n;
		expect(count).toBe(1);

		const run = db.prepare('SELECT task_id, player_id FROM prediction_runs').get() as {
			task_id: string;
			player_id: number;
		};
		expect(run.task_id).toBe('vote-probe');
		expect(run.player_id).toBe(playerId);
	});

	it('prediction_runs row carries model + cost + latency', async () => {
		const playerId = seedPlayer(db);
		mockCallOpenRouter.mockResolvedValueOnce({ content: FIXTURE_JSON, costUsd: 0.009 });

		await runVoteProbe(db, playerId, { song: FIXTURE_SONG, theme: FIXTURE_THEME });

		const run = db.prepare('SELECT model, cost_usd, latency_ms FROM prediction_runs').get() as {
			model: string;
			cost_usd: number;
			latency_ms: number;
		};
		expect(run.model).toBe(voteProbeTask.model);
		expect(run.cost_usd).toBeCloseTo(0.009);
		expect(run.latency_ms).toBeGreaterThanOrEqual(0);
	});

	it('passes roundId to prediction_runs when provided', async () => {
		const playerId = seedPlayer(db);
		mockCallOpenRouter.mockResolvedValueOnce({ content: FIXTURE_JSON, costUsd: 0 });

		await runVoteProbe(db, playerId, { song: FIXTURE_SONG, theme: FIXTURE_THEME, roundId: 42 });

		const run = db.prepare('SELECT round_id FROM prediction_runs').get() as { round_id: number | null };
		expect(run.round_id).toBe(42);
	});

	it('round_id is NULL when not provided', async () => {
		const playerId = seedPlayer(db);
		mockCallOpenRouter.mockResolvedValueOnce({ content: FIXTURE_JSON, costUsd: 0 });

		await runVoteProbe(db, playerId, { song: FIXTURE_SONG, theme: FIXTURE_THEME });

		const run = db.prepare('SELECT round_id FROM prediction_runs').get() as { round_id: number | null };
		expect(run.round_id).toBeNull();
	});

	it('works for a player with no submission or voting history', async () => {
		const playerId = seedPlayer(db, 'EmptyPlayer');
		const lowConfidence = { ...FIXTURE_OUTPUT, confidence: 'low' as const, upvote_likelihood: 45 };
		mockCallOpenRouter.mockResolvedValueOnce({ content: JSON.stringify(lowConfidence), costUsd: 0 });

		const { output } = await runVoteProbe(db, playerId, { song: FIXTURE_SONG, theme: FIXTURE_THEME });
		expect(output.confidence).toBe('low');
	});
});

// ── Output schema validation ───────────────────────────────────────────────────

describe('VoteProbeOutputSchema — validation', () => {
	it('accepts a valid SAS output shape', () => {
		expect(() => VoteProbeOutputSchema.parse(FIXTURE_OUTPUT)).not.toThrow();
	});

	it('rejects upvote_likelihood below 0', () => {
		const bad = { ...FIXTURE_OUTPUT, upvote_likelihood: -1 };
		expect(() => VoteProbeOutputSchema.parse(bad)).toThrow();
	});

	it('rejects upvote_likelihood above 100', () => {
		const bad = { ...FIXTURE_OUTPUT, upvote_likelihood: 101 };
		expect(() => VoteProbeOutputSchema.parse(bad)).toThrow();
	});

	it('accepts upvote_likelihood at boundary values 0 and 100', () => {
		expect(() => VoteProbeOutputSchema.parse({ ...FIXTURE_OUTPUT, upvote_likelihood: 0 })).not.toThrow();
		expect(() => VoteProbeOutputSchema.parse({ ...FIXTURE_OUTPUT, upvote_likelihood: 100 })).not.toThrow();
	});

	it('rejects empty reasoning string', () => {
		const bad = { ...FIXTURE_OUTPUT, reasoning: '' };
		expect(() => VoteProbeOutputSchema.parse(bad)).toThrow();
	});

	it('rejects invalid confidence value', () => {
		const bad = { ...FIXTURE_OUTPUT, confidence: 'very-high' };
		expect(() => VoteProbeOutputSchema.parse(bad)).toThrow();
	});

	it('rejects missing required fields', () => {
		const bad = { upvote_likelihood: 50, confidence: 'medium' };
		expect(() => VoteProbeOutputSchema.parse(bad)).toThrow();
	});

	it('signals must be an array', () => {
		const bad = { ...FIXTURE_OUTPUT, signals: 'not-an-array' };
		expect(() => VoteProbeOutputSchema.parse(bad)).toThrow();
	});
});
