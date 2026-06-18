import { it, expect, describe, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { openLeagueDb } from '../db/client.js';
import { runPrediction, extractJson } from './predict.js';
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
		mockCallOpenRouter.mockResolvedValueOnce({ content: FIXTURE_JSON, costUsd: 0.001, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 });

		const { output, meta } = await runPrediction(db, task, { playerId: 1, note: 'loves shoegaze' });

		expect(output).toEqual(FIXTURE_OUTPUT);
		expect(meta.model).toBe(task.model);
		expect(meta.costUsd).toBe(0.001);
		expect(meta.latencyMs).toBeGreaterThanOrEqual(0);
	});

	it('inserts one prediction_runs row with model + cost + latency', async () => {
		mockCallOpenRouter.mockResolvedValueOnce({ content: FIXTURE_JSON, costUsd: 0.002, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 });

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
		mockCallOpenRouter.mockResolvedValueOnce({ content: FIXTURE_JSON, costUsd: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 });

		await runPrediction(db, task, { playerId: 3, note: 'test' });

		const row = db.prepare('SELECT id FROM prediction_runs').get() as { id: string };
		expect(row.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
	});

	it('player_id and round_id are null when opts omitted', async () => {
		mockCallOpenRouter.mockResolvedValueOnce({ content: FIXTURE_JSON, costUsd: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 });

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
			.mockResolvedValueOnce({ content: badJson, costUsd: 0.001, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 })
			.mockResolvedValueOnce({ content: FIXTURE_JSON, costUsd: 0.001, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 });

		const { output, meta } = await runPrediction(db, task, { playerId: 1, note: 'retry test' });

		expect(output).toEqual(FIXTURE_OUTPUT);
		expect(mockCallOpenRouter).toHaveBeenCalledTimes(2);
		expect(meta.costUsd).toBeCloseTo(0.002);
	});

	it('retry row accumulates cost from both calls', async () => {
		mockCallOpenRouter
			.mockResolvedValueOnce({ content: JSON.stringify({ wrong: true }), costUsd: 0.003, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 })
			.mockResolvedValueOnce({ content: FIXTURE_JSON, costUsd: 0.002, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 });

		await runPrediction(db, task, { playerId: 1, note: 'cost accumulation' });

		const row = db.prepare('SELECT cost_usd FROM prediction_runs').get() as { cost_usd: number };
		expect(row.cost_usd).toBeCloseTo(0.005);
	});

	it('throws if retry also produces schema-invalid output', async () => {
		mockCallOpenRouter
			.mockResolvedValueOnce({ content: JSON.stringify({ bad: 1 }), costUsd: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 })
			.mockResolvedValueOnce({ content: JSON.stringify({ also_bad: true }), costUsd: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 });

		await expect(runPrediction(db, task, { playerId: 1, note: 'double fail' })).rejects.toThrow();
	});

	it('throws on non-JSON LLM response', async () => {
		mockCallOpenRouter.mockResolvedValueOnce({ content: 'not json at all', costUsd: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 });

		await expect(runPrediction(db, task, { playerId: 1, note: 'non-json' })).rejects.toThrow(
			/non-JSON/,
		);
	});

	it('only one row is written even after a successful retry', async () => {
		mockCallOpenRouter
			.mockResolvedValueOnce({ content: JSON.stringify({ wrong: true }), costUsd: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 })
			.mockResolvedValueOnce({ content: FIXTURE_JSON, costUsd: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 });

		await runPrediction(db, task, { playerId: 1, note: 'one row' });

		const count = (db.prepare('SELECT COUNT(*) as n FROM prediction_runs').get() as { n: number }).n;
		expect(count).toBe(1);
	});
});

describe('extractJson — robust JSON extraction', () => {
	it('parses clean JSON', () => {
		expect(extractJson('{"label":"indie","score":87}')).toEqual({ label: 'indie', score: 87 });
	});

	it('parses bare {...} (same as clean)', () => {
		expect(extractJson('  {"label":"bare","score":1}  ')).toEqual({ label: 'bare', score: 1 });
	});

	it('parses fenced JSON (```json...```)', () => {
		const fenced = '```json\n{"label":"fenced","score":42}\n```';
		expect(extractJson(fenced)).toEqual({ label: 'fenced', score: 42 });
	});

	it('parses fenced JSON with trailing prose — the gate-finding scenario', () => {
		const fencedWithProse =
			'```json\n{"label":"prose","score":99}\n```\n**Reasoning:** some model explanation here.';
		expect(extractJson(fencedWithProse)).toEqual({ label: 'prose', score: 99 });
	});

	it('returns null for non-JSON content', () => {
		expect(extractJson('not json at all')).toBeNull();
	});

	it('returns null for empty string', () => {
		expect(extractJson('')).toBeNull();
	});
});

describe('runPrediction — fenced/prose-wrapped LLM responses', () => {
	it('parses fenced + trailing-prose initial response correctly', async () => {
		const fencedResponse =
			'```json\n' + FIXTURE_JSON + '\n```\n**Reasoning:** model chose indie because shoegaze fits.';
		mockCallOpenRouter.mockResolvedValueOnce({ content: fencedResponse, costUsd: 0.001, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 });

		const { output } = await runPrediction(db, task, { playerId: 1, note: 'fenced response' });
		expect(output).toEqual(FIXTURE_OUTPUT);
	});

	it('parses fenced + trailing-prose retry response correctly', async () => {
		const badFirst = JSON.stringify({ wrong: 'shape' });
		const fencedRetry =
			'```json\n' + FIXTURE_JSON + '\n```\n**Reasoning:** corrected schema on retry.';
		mockCallOpenRouter
			.mockResolvedValueOnce({ content: badFirst, costUsd: 0.001, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 })
			.mockResolvedValueOnce({ content: fencedRetry, costUsd: 0.001, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 });

		const { output, meta } = await runPrediction(db, task, { playerId: 1, note: 'fenced retry' });
		expect(output).toEqual(FIXTURE_OUTPUT);
		expect(meta.costUsd).toBeCloseTo(0.002);
	});

	it('bare {...} response still parses', async () => {
		mockCallOpenRouter.mockResolvedValueOnce({ content: FIXTURE_JSON, costUsd: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 });
		const { output } = await runPrediction(db, task, { playerId: 1, note: 'bare json' });
		expect(output).toEqual(FIXTURE_OUTPUT);
	});
});

describe('runPrediction — sprint-39 federation columns', () => {
	it('populates category, label, tokens, output_hash, params in prediction_runs', async () => {
		mockCallOpenRouter.mockResolvedValueOnce({
			content: FIXTURE_JSON, costUsd: 0.002,
			promptTokens: 80, completionTokens: 40, totalTokens: 120, latencyMs: 0,
		});

		await runPrediction(db, task, { playerId: 1, note: 'column test' }, { category: 'archive' });

		const row = db.prepare('SELECT * FROM prediction_runs').get() as Record<string, unknown>;
		expect(row.category).toBe('archive');
		expect(row.label).toBe(`archive:${task.id}`);
		expect(row.prompt_tokens).toBe(80);
		expect(row.completion_tokens).toBe(40);
		expect(row.total_tokens).toBe(120);
		expect(typeof row.output_hash).toBe('string');
		expect((row.output_hash as string).length).toBe(64); // sha256 hex
		expect(typeof row.params).toBe('string');
		expect(JSON.parse(row.params as string).response_format).toEqual({ type: 'json_object' });
		expect(row.params_schema_version).toBe(1);
		expect(row.retry_count).toBe(0);
		expect(row.artifact_type).toBe('bside_section');
	});

	it('defaults category to predict when not provided', async () => {
		mockCallOpenRouter.mockResolvedValueOnce({
			content: FIXTURE_JSON, costUsd: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0,
		});

		await runPrediction(db, task, { playerId: 1, note: 'default category' });

		const row = db.prepare('SELECT category, label, artifact_type FROM prediction_runs').get() as Record<string, string>;
		expect(row.category).toBe('predict');
		expect(row.label).toBe(`predict:${task.id}`);
		expect(row.artifact_type).toBe('prediction_run');
	});

	it('writes outcome=unusable on double schema-miss and still throws', async () => {
		mockCallOpenRouter
			.mockResolvedValueOnce({ content: JSON.stringify({ bad: 1 }), costUsd: 0.001, promptTokens: 10, completionTokens: 5, totalTokens: 15, latencyMs: 0 })
			.mockResolvedValueOnce({ content: JSON.stringify({ also_bad: true }), costUsd: 0.001, promptTokens: 10, completionTokens: 5, totalTokens: 15, latencyMs: 0 });

		await expect(runPrediction(db, task, { playerId: 1, note: 'double fail' })).rejects.toThrow();

		const row = db.prepare('SELECT outcome, retry_count FROM prediction_runs').get() as Record<string, unknown>;
		expect(row).toBeTruthy();
		expect(row.outcome).toBe('unusable');
		expect(row.retry_count).toBe(1);
	});
});
