import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { ZodType } from 'zod';
import { callOpenRouter } from '../digest/llm.js';

// Robustly extract the first JSON object from LLM output that may include
// markdown code fences (```json...```) and/or trailing prose after the object.
export function extractJson(content: string): unknown | null {
	let text = content.trim();

	// Strip ```json / ``` code fences if present
	const fenced = text.match(/^```(?:json)?\s*\n([\s\S]*?)\n```/);
	if (fenced) text = fenced[1].trim();

	// Find and parse the first balanced {...} object, ignoring trailing prose
	const start = text.indexOf('{');
	if (start === -1) return null;
	let depth = 0, inString = false, escape = false;
	for (let i = start; i < text.length; i++) {
		const ch = text[i];
		if (escape) { escape = false; continue; }
		if (ch === '\\' && inString) { escape = true; continue; }
		if (ch === '"') { inString = !inString; continue; }
		if (inString) continue;
		if (ch === '{') depth++;
		else if (ch === '}' && --depth === 0) {
			try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; }
		}
	}
	return null;
}

// Structural alias — matches OpenRouterMessage in llm.ts without importing the private interface.
type LLMMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export type Score = number | { value: number; details?: unknown };

export type PredictionTask<TIn, TOut> = {
	id: string;
	inputSchema: ZodType<TIn>;
	buildMessages: (input: TIn) => LLMMessage[];
	/** Static model id string, or a DB-first resolver `(db) => modelFor(bucket, db)`. */
	model: string | ((db: Database.Database) => string);
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

	const model = typeof task.model === 'function' ? task.model(db) : task.model;
	const messages = task.buildMessages(input);
	const startMs = Date.now();

	const { content, costUsd } = await callOpenRouter(messages, { model, jsonMode: true });

	const parsed = extractJson(content);
	if (parsed === null) {
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
			model,
			jsonMode: true,
		});
		totalCostUsd += retryCostUsd;

		const retryParsed = extractJson(retryContent);
		if (retryParsed === null) {
			throw new Error(`runPrediction: retry returned non-JSON: ${retryContent.slice(0, 200)}`);
		}

		output = task.outputSchema.parse(retryParsed);
	}

	const latencyMs = Date.now() - startMs;
	const meta: PredictionMeta = { model, costUsd: totalCostUsd, latencyMs };

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
		model,
		meta.costUsd,
		meta.latencyMs,
		now,
	);

	return { output, meta };
}
