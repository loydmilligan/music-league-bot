import type Database from 'better-sqlite3';
import { randomUUID, createHash } from 'node:crypto';
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
	opts?: {
		playerId?: number;
		roundId?: number;
		/** sprint-39: 'archive' for bside/narrative/profile/season tasks; defaults to 'predict'. */
		category?: 'archive' | 'predict';
	},
): Promise<{ output: TOut; meta: PredictionMeta }> {
	task.inputSchema.parse(input);

	const model = typeof task.model === 'function' ? task.model(db) : task.model;
	const messages = task.buildMessages(input);
	const startMs = Date.now();

	const firstCall = await callOpenRouter(messages, { model, jsonMode: true });
	const { content } = firstCall;

	const parsed = extractJson(content);
	if (parsed === null) {
		throw new Error(`runPrediction: LLM returned non-JSON: ${content.slice(0, 200)}`);
	}

	let output: TOut;
	let totalCostUsd = firstCall.costUsd;
	let totalPromptTokens = firstCall.promptTokens;
	let totalCompletionTokens = firstCall.completionTokens;
	let totalTokens = firstCall.totalTokens;
	let retryCount = 0;
	let outcome: string | null = null;
	let finalContent = content;

	const firstResult = task.outputSchema.safeParse(parsed);
	if (firstResult.success) {
		output = firstResult.data;
	} else {
		// One retry on schema miss
		retryCount = 1;
		const retryMessages: LLMMessage[] = [
			...messages,
			{ role: 'assistant', content },
			{
				role: 'user',
				content: `Your previous response did not match the required schema. Issues: ${firstResult.error.message}. Respond with valid JSON only.`,
			},
		];
		const retryCall = await callOpenRouter(retryMessages, { model, jsonMode: true });
		totalCostUsd += retryCall.costUsd;
		totalPromptTokens += retryCall.promptTokens;
		totalCompletionTokens += retryCall.completionTokens;
		totalTokens += retryCall.totalTokens;
		finalContent = retryCall.content;

		const retryParsed = extractJson(retryCall.content);
		if (retryParsed === null) {
			throw new Error(`runPrediction: retry returned non-JSON: ${retryCall.content.slice(0, 200)}`);
		}

		let schemaError: Error | null = null;
		try {
			output = task.outputSchema.parse(retryParsed);
		} catch (e) {
			// Schema miss on retry — mark unusable (technical outcome); write row then re-throw
			outcome = 'unusable';
			schemaError = e instanceof Error ? e : new Error(String(e));
		}

		if (schemaError) {
			// Write an unusable row before re-throwing so the cost is ledgered
			const latencyMsOnFail = Date.now() - startMs;
			const failHash = createHash('sha256').update(finalContent).digest('hex');
			const failCategory = opts?.category ?? 'predict';
			const failLabel = `${failCategory}:${task.id}`;
			const failRowId = randomUUID();
			const failNow = new Date().toISOString();
			const failParams: Record<string, unknown> = { response_format: { type: 'json_object' } };
			if (task.params) Object.assign(failParams, task.params);
			try {
				db.prepare(
					`INSERT INTO prediction_runs (
						id, task_id, player_id, round_id, input_json, output_json,
						model, cost_usd, latency_ms, created_at,
						prompt_tokens, completion_tokens, total_tokens, category, label,
						run_id, artifact_type, artifact_id, output_hash, outcome, retry_count,
						params, params_schema_version
					) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				).run(
					failRowId, task.id, opts?.playerId ?? null, opts?.roundId ?? null,
					JSON.stringify(input), null,
					model, totalCostUsd, latencyMsOnFail, failNow,
					totalPromptTokens, totalCompletionTokens, totalTokens, failCategory, failLabel,
					randomUUID(), failCategory === 'archive' ? 'bside_section' : 'prediction_run', failRowId,
					failHash, 'unusable', retryCount, JSON.stringify(failParams), 1,
				);
			} catch { /* fire-and-forget ledger write */ }
			throw new Error(`runPrediction: retry schema mismatch`);
		}
	}

	const latencyMs = Date.now() - startMs;
	const meta: PredictionMeta = { model, costUsd: totalCostUsd, latencyMs };

	// sprint-39: passive capture fields
	const outputHash = createHash('sha256').update(finalContent).digest('hex');
	const category = opts?.category ?? 'predict';
	const label = `${category}:${task.id}`;
	const runRowId = randomUUID();
	const now = new Date().toISOString();

	// Build params blob from task.params (temperature, etc.) + response_format from jsonMode
	const params: Record<string, unknown> = { response_format: { type: 'json_object' } };
	if (task.params) Object.assign(params, task.params);

	db.prepare(
		`INSERT INTO prediction_runs (
			id, task_id, player_id, round_id, input_json, output_json,
			model, cost_usd, latency_ms, created_at,
			prompt_tokens, completion_tokens, total_tokens, category, label,
			run_id, artifact_type, artifact_id, output_hash, outcome, retry_count,
			params, params_schema_version
		) VALUES (
			?, ?, ?, ?, ?, ?,
			?, ?, ?, ?,
			?, ?, ?, ?, ?,
			?, ?, ?, ?, ?, ?,
			?, ?
		)`,
	).run(
		runRowId,
		task.id,
		opts?.playerId ?? null,
		opts?.roundId ?? null,
		JSON.stringify(input),
		JSON.stringify(output!),
		model,
		meta.costUsd,
		meta.latencyMs,
		now,
		// sprint-39 cost-attribution columns
		totalPromptTokens,
		totalCompletionTokens,
		totalTokens,
		category,
		label,
		// sprint-39 passive capture columns
		randomUUID(),                                                  // run_id (per-run uuid)
		category === 'archive' ? 'bside_section' : 'prediction_run',  // artifact_type
		runRowId,                                                      // artifact_id = self-row id
		outputHash,
		outcome,
		retryCount,
		JSON.stringify(params),
		1,  // params_schema_version
	);

	return { output: output!, meta };
}
