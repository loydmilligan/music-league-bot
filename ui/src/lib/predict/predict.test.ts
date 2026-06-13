import { it, expect, describe, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { openLeagueDb } from '../db/client.js';
import { runPrediction } from './predict.js';
import type { PredictionTask } from './predict.js';
import type Database from 'better-sqlite3';

// Stub callOpenRouter — no real API spend
vi.mock('../digest/llm.js', () => ({
	callOpenRouter: vi.fn(),
}));

import { callOpenRouter } from '../digest/llm.js';
const mockCallOpenRouter = vi.mocked(callOpenRouter);

// Minimal schemas for tests
const InputSchema = z.object({ playerId: z.number(), note: z.string() });
const OutputSchema = z.object({ label: z.string(), score: z.number() });

type TestIn = z.infer<typeof InputSchema>;
type TestOut = z.infer<typeof OutputSchema>;

const FIXTURE_OUTPUT: TestOut = { label: 'indie', score: 87 };
const FIXTURE_JSON = JSON.stringify(FIXTURE_OUTPUT);

const task: PredictionTask<TestIn, TestOut> = {
	id: 'test-task',
	inputSchema: InputSchema,
	buildMessages: (input) => [
		{ role: 'system', content: 'You are a music classifier.' },
		{ role: 'user', content: `Classify player ${input.playerId}: ${input.note}` },
	],
	model: 'anthropic/claude-haiku-4-5-20251001',
	outputSchema: OutputSchema,
};

let db: Database.Database;
beforeEach(() => {
	db = openLeagueDb(':memory:');
	vi.clearAllMocks();
});

describe('runPrediction — happy path', () => {
	it('validates input schema and returns structured output', async () => {
		mockCallOpenRouter.mockResolvedValueOnce({ content: FIXTURE_JSON, costUsd: 0.001 });

		const { output, meta } = await runPrediction(db, task, { playerId: 1, note: 'loves shoegaze' });

		expect(output).toEqual(FIXTURE_OUTPUT);
		expect(meta.model).toBe(task.model);
		expect(meta.costUsd).toBe(0.001);
		expect(meta.latencyMs).toBeGreaterThanOrEqual(0);
	});

	it('inserts one prediction_runs row with model + cost + latency', async () => {
		mockCallOpenRouter.mockResolvedValueOnce({ content: FIXTURE_JSON, costUsd: 0.002 });

		await runPrediction(db, task, { playerId: 2, note: 'loves jazz' }, { playerId: 2 });

		const rows = db.prepare('SELECT * FROM prediction_runs').all() as {
			task_id: string; model: string; cost_usd: number; latency_ms: number;
			player_id: number; input_json: string; output_json: string;
		}[];
		expect(rows).toHaveLength(1);
		expect(rows[0].task_id).toBe('test-task');
		expect(rows[0].model).toBe(task.model);
		expect(rows[0].cost_usd).toBe(0.002);
		expect(rows[0].latency_ms).toBeGreaterThanOrEqual(0);
		expect(rows[0].player_id).toBe(2);
		expect(JSON.parse(rows[0].input_json)).toEqual({ playerId: 2, note: 'loves jazz' });
		expect(JSON.parse(rows[0].output_json)).toEqual(FIXTURE_OUTPUT);
	});

	it('row id is a UUID string', async () => {
		mockCallOpenRouter.mockResolvedValueOnce({ content: FIXTURE_JSON, costUsd: 0 });

		await runPrediction(db, task, { playerId: 3, note: 'test' });

		const row = db.prepare('SELECT id FROM prediction_runs').get() as { id: string };
		expect(row.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
	});

	it('player_id and round_id are null when opts omitted', async () => {
		mockCallOpenRouter.mockResolvedValueOnce({ content: FIXTURE_JSON, costUsd: 0 });

		await runPrediction(db, task, { playerId: 1, note: 'test' });

		const row = db.prepare('SELECT player_id, round_id FROM prediction_runs').get() as {
			player_id: unknown; round_id: unknown;
		};
		expect(row.player_id).toBeNull();
		expect(row.round_id).toBeNull();
	});
});

describe('runPrediction — input validation', () => {
	it('throws on invalid input before calling LLM', async () => {
		await expect(
			// @ts-expect-error intentionally invalid input
			runPrediction(db, task, { playerId: 'not-a-number', note: 'test' }),
		).rejects.toThrow();

		expect(mockCallOpenRouter).not.toHaveBeenCalled();
	});
});

describe('runPrediction — retry path', () => {
	it('retries once on schema-invalid first response and succeeds', async () => {
		const badJson = JSON.stringify({ wrong: 'shape' });
		mockCallOpenRouter
			.mockResolvedValueOnce({ content: badJson, costUsd: 0.001 })
			.mockResolvedValueOnce({ content: FIXTURE_JSON, costUsd: 0.001 });

		const { output, meta } = await runPrediction(db, task, { playerId: 1, note: 'retry test' });

		expect(output).toEqual(FIXTURE_OUTPUT);
		expect(mockCallOpenRouter).toHaveBeenCalledTimes(2);
		expect(meta.costUsd).toBeCloseTo(0.002);
	});

	it('retry row accumulates cost from both calls', async () => {
		mockCallOpenRouter
			.mockResolvedValueOnce({ content: JSON.stringify({ wrong: true }), costUsd: 0.003 })
			.mockResolvedValueOnce({ content: FIXTURE_JSON, costUsd: 0.002 });

		await runPrediction(db, task, { playerId: 1, note: 'cost accumulation' });

		const row = db.prepare('SELECT cost_usd FROM prediction_runs').get() as { cost_usd: number };
		expect(row.cost_usd).toBeCloseTo(0.005);
	});

	it('throws if retry also produces schema-invalid output', async () => {
		mockCallOpenRouter
			.mockResolvedValueOnce({ content: JSON.stringify({ bad: 1 }), costUsd: 0 })
			.mockResolvedValueOnce({ content: JSON.stringify({ also_bad: true }), costUsd: 0 });

		await expect(runPrediction(db, task, { playerId: 1, note: 'double fail' })).rejects.toThrow();
	});

	it('throws on non-JSON LLM response', async () => {
		mockCallOpenRouter.mockResolvedValueOnce({ content: 'not json at all', costUsd: 0 });

		await expect(runPrediction(db, task, { playerId: 1, note: 'non-json' })).rejects.toThrow(
			/non-JSON/,
		);
	});

	it('only one row is written even after a successful retry', async () => {
		mockCallOpenRouter
			.mockResolvedValueOnce({ content: JSON.stringify({ wrong: true }), costUsd: 0 })
			.mockResolvedValueOnce({ content: FIXTURE_JSON, costUsd: 0 });

		await runPrediction(db, task, { playerId: 1, note: 'one row' });

		const count = (db.prepare('SELECT COUNT(*) as n FROM prediction_runs').get() as { n: number }).n;
		expect(count).toBe(1);
	});
});
