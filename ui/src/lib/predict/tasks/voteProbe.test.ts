import { it, expect, describe, vi, beforeEach } from 'vitest';
import { openLeagueDb } from '../../db/client.js';
import { runVoteProbe, VoteProbeOutputSchema, voteProbeTask } from './voteProbe.js';
import { HARDCODED_MODEL } from '../../digest/modelFor.js';
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
		mockCallOpenRouter.mockResolvedValueOnce({ content: FIXTURE_JSON, costUsd: 0.007, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 });

		const { output, meta } = await runVoteProbe(db, playerId, { song: FIXTURE_SONG, theme: FIXTURE_THEME });

		expect(output).toEqual(FIXTURE_OUTPUT);
		expect(meta.model).toBe(HARDCODED_MODEL); // task.model is now a fn; resolved = hardcoded (no DB pin in test)
		expect(meta.costUsd).toBe(0.007);
		expect(meta.latencyMs).toBeGreaterThanOrEqual(0);
	});

	it('reasoning is non-empty', async () => {
		const playerId = seedPlayer(db);
		mockCallOpenRouter.mockResolvedValueOnce({ content: FIXTURE_JSON, costUsd: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 });

		const { output } = await runVoteProbe(db, playerId, { song: FIXTURE_SONG, theme: FIXTURE_THEME });

		expect(output.reasoning.length).toBeGreaterThan(0);
	});

	it('writes one prediction_runs row with task_id = vote-probe', async () => {
		const playerId = seedPlayer(db);
		mockCallOpenRouter.mockResolvedValueOnce({ content: FIXTURE_JSON, costUsd: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 });

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
		mockCallOpenRouter.mockResolvedValueOnce({ content: FIXTURE_JSON, costUsd: 0.009, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 });

		await runVoteProbe(db, playerId, { song: FIXTURE_SONG, theme: FIXTURE_THEME });

		const run = db.prepare('SELECT model, cost_usd, latency_ms FROM prediction_runs').get() as {
			model: string;
			cost_usd: number;
			latency_ms: number;
		};
		expect(run.model).toBe(HARDCODED_MODEL); // task.model is now a fn; resolved = hardcoded (no DB pin in test)
		expect(run.cost_usd).toBeCloseTo(0.009);
		expect(run.latency_ms).toBeGreaterThanOrEqual(0);
	});

	it('passes roundId to prediction_runs when provided', async () => {
		const playerId = seedPlayer(db);
		mockCallOpenRouter.mockResolvedValueOnce({ content: FIXTURE_JSON, costUsd: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 });

		await runVoteProbe(db, playerId, { song: FIXTURE_SONG, theme: FIXTURE_THEME, roundId: 42 });

		const run = db.prepare('SELECT round_id FROM prediction_runs').get() as { round_id: number | null };
		expect(run.round_id).toBe(42);
	});

	it('round_id is NULL when not provided', async () => {
		const playerId = seedPlayer(db);
		mockCallOpenRouter.mockResolvedValueOnce({ content: FIXTURE_JSON, costUsd: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 });

		await runVoteProbe(db, playerId, { song: FIXTURE_SONG, theme: FIXTURE_THEME });

		const run = db.prepare('SELECT round_id FROM prediction_runs').get() as { round_id: number | null };
		expect(run.round_id).toBeNull();
	});

	it('works for a player with no submission or voting history', async () => {
		const playerId = seedPlayer(db, 'EmptyPlayer');
		const lowConfidence = { ...FIXTURE_OUTPUT, confidence: 'low' as const, upvote_likelihood: 45 };
		mockCallOpenRouter.mockResolvedValueOnce({ content: JSON.stringify(lowConfidence), costUsd: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 });

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

// ── a4-migrate: DB routing proof ───────────────────────────────────────────────

describe('voteProbeTask — DB-first model routing (a4-migrate)', () => {
	it('task.model is a function (DB-first resolver, not a static env string)', () => {
		expect(typeof voteProbeTask.model).toBe('function');
	});

	it('task.model(db) returns bucket predict_model when set in DB', () => {
		db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('predict_model', 'openai/gpt-4o-mini')").run();
		const resolved = (voteProbeTask.model as (db: import('better-sqlite3').Database) => string)(db);
		expect(resolved).toBe('openai/gpt-4o-mini');
		db.prepare("DELETE FROM settings WHERE key = 'predict_model'").run();
	});

	it('task.model(db) returns section pin over bucket predict_model', () => {
		db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('predict_model', 'openai/gpt-4o-mini')").run();
		db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('digest_model_vote-probe', 'meta-llama/llama-3.1-405b')").run();
		const resolved = (voteProbeTask.model as (db: import('better-sqlite3').Database) => string)(db);
		expect(resolved).toBe('meta-llama/llama-3.1-405b');
		db.prepare("DELETE FROM settings WHERE key IN ('predict_model', 'digest_model_vote-probe')").run();
	});

	it('task.model(db) falls back to HARDCODED_MODEL when neither pin nor bucket is set', () => {
		const origPredict = process.env.OPENROUTER_PREDICT_MODEL;
		delete process.env.OPENROUTER_PREDICT_MODEL;
		const resolved = (voteProbeTask.model as (db: import('better-sqlite3').Database) => string)(db);
		expect(resolved).toBe(HARDCODED_MODEL);
		if (origPredict !== undefined) process.env.OPENROUTER_PREDICT_MODEL = origPredict;
	});
});
