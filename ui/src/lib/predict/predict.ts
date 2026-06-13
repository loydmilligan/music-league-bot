import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { ZodType } from 'zod';
import { callOpenRouter } from '../digest/llm.js';

// Structural alias — matches OpenRouterMessage in llm.ts without importing the private interface.
type LLMMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export type Score = number | { value: number; details?: unknown };

export type PredictionTask<TIn, TOut> = {
	id: string;
	inputSchema: ZodType<TIn>;
	buildMessages: (input: TIn) => LLMMessage[];
	model: string;
	params?: Record<string, unknown>;
	outputSchema: ZodType<TOut>;
	scorer?: (prediction: TOut, actual: unknown) => Score;
};

export type PredictionMeta = {
	model: string;
	costUsd: number;
	latencyMs: number;
};

export async function runPrediction<TIn, TOut>(
	db: Database.Database,
	task: PredictionTask<TIn, TOut>,
	input: TIn,
	opts?: { playerId?: number; roundId?: number },
): Promise<{ output: TOut; meta: PredictionMeta }> {
	task.inputSchema.parse(input);

	const messages = task.buildMessages(input);
	const startMs = Date.now();

	const { content, costUsd } = await callOpenRouter(messages, { model: task.model, jsonMode: true });

	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch {
		throw new Error(`runPrediction: LLM returned non-JSON: ${content.slice(0, 200)}`);
	}

	let output: TOut;
	let totalCostUsd = costUsd;

	const firstResult = task.outputSchema.safeParse(parsed);
	if (firstResult.success) {
		output = firstResult.data;
	} else {
		// One retry on schema miss
		const retryMessages: LLMMessage[] = [
			...messages,
			{ role: 'assistant', content },
			{
				role: 'user',
				content: `Your previous response did not match the required schema. Issues: ${firstResult.error.message}. Respond with valid JSON only.`,
			},
		];
		const { content: retryContent, costUsd: retryCostUsd } = await callOpenRouter(retryMessages, {
			model: task.model,
			jsonMode: true,
		});
		totalCostUsd += retryCostUsd;

		let retryParsed: unknown;
		try {
			retryParsed = JSON.parse(retryContent);
		} catch {
			throw new Error(`runPrediction: retry returned non-JSON: ${retryContent.slice(0, 200)}`);
		}

		output = task.outputSchema.parse(retryParsed);
	}

	const latencyMs = Date.now() - startMs;
	const meta: PredictionMeta = { model: task.model, costUsd: totalCostUsd, latencyMs };

	const runId = randomUUID();
	const now = new Date().toISOString();
	db.prepare(
		`INSERT INTO prediction_runs (id, task_id, player_id, round_id, input_json, output_json, model, cost_usd, latency_ms, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	).run(
		runId,
		task.id,
		opts?.playerId ?? null,
		opts?.roundId ?? null,
		JSON.stringify(input),
		JSON.stringify(output),
		task.model,
		meta.costUsd,
		meta.latencyMs,
		now,
	);

	return { output, meta };
}
