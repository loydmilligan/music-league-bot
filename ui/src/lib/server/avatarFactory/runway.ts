import { bytesFromImageRef, pollIntervalMs, redact, sleep } from './fetchUtil.js';
import type { FetchLike, GenerateImageOpts, ImageGenResult } from './openrouter.js';
import { RUNWAY_PRICING_BASIS } from './providers.js';

const RUNWAY_BASE = 'https://api.dev.runwayml.com/v1';
const RUNWAY_VERSION = '2024-11-06';
export const RUNWAY_PROMPT_LIMIT = 1000;
const MAX_POLLS = 40;
const MAX_REFS = 3;

function getKey(): string {
	const key = process.env.RUNWAY_API_SECRET || process.env.RUNWAYML_API_SECRET;
	if (!key) throw new Error('Runway needs key');
	return key;
}

function runwayHeaders(apiKey: string): Record<string, string> {
	return {
		Authorization: `Bearer ${apiKey}`,
		'X-Runway-Version': RUNWAY_VERSION,
		'Content-Type': 'application/json',
	};
}

function ratioFor(aspect?: string): string {
	if (aspect === '16:9') return '1360:768';
	return '1024:1024';
}

/**
 * Runway gen4_image. Never logs the API key. Tests inject fetchImpl.
 * Do not call grok_imagine_image_2.
 */
export async function generateRunwayImage(opts: GenerateImageOpts): Promise<ImageGenResult> {
	const apiKey = opts.apiKey ?? (opts.fetchImpl ? process.env.RUNWAY_API_SECRET || process.env.RUNWAYML_API_SECRET || 'mock' : getKey());
	const model = opts.model ?? 'gen4_image';
	const fetchImpl: FetchLike = opts.fetchImpl ?? fetch;
	const interval = pollIntervalMs(opts.fetchImpl);
	const promptText = opts.prompt.length > RUNWAY_PROMPT_LIMIT ? opts.prompt.slice(0, RUNWAY_PROMPT_LIMIT) : opts.prompt;

	const refs = (opts.imageDataUrls ?? []).slice(0, MAX_REFS).map((uri, i) => ({
		uri,
		tag: i === 0 ? 'subject' : `ref${i}`,
	}));

	const body: Record<string, unknown> = {
		model,
		promptText,
		ratio: ratioFor(opts.aspectRatio),
	};
	if (refs.length) body.referenceImages = refs;

	const startMs = Date.now();
	const created = await fetchImpl(`${RUNWAY_BASE}/text_to_image`, {
		method: 'POST',
		headers: runwayHeaders(apiKey),
		body: JSON.stringify(body),
	});
	if (!created.ok) {
		const text = redact(await created.text().catch(() => ''), apiKey).slice(0, 500);
		throw new Error(`Runway image ${created.status}: ${text}`);
	}
	const createdJson = (await created.json()) as { id?: string; status?: string; output?: string[] };
	let taskId = createdJson.id;
	let status = createdJson.status;
	let output = createdJson.output;

	if (status !== 'SUCCEEDED' || !output?.[0]) {
		if (!taskId) throw new Error('Runway returned no task id');
		for (let i = 0; i < MAX_POLLS; i++) {
			await sleep(interval);
			const polled = await fetchImpl(`${RUNWAY_BASE}/tasks/${taskId}`, {
				headers: { Authorization: `Bearer ${apiKey}`, 'X-Runway-Version': RUNWAY_VERSION },
			});
			if (!polled.ok) {
				const text = redact(await polled.text().catch(() => ''), apiKey).slice(0, 500);
				throw new Error(`Runway poll ${polled.status}: ${text}`);
			}
			const task = (await polled.json()) as {
				status?: string;
				failure?: string;
				output?: string[];
			};
			status = task.status;
			output = task.output;
			if (status === 'SUCCEEDED') break;
			if (status === 'FAILED') throw new Error(`Runway task failed: ${redact(task.failure ?? '', apiKey)}`);
		}
		if (status !== 'SUCCEEDED' || !output?.[0]) throw new Error('Runway task did not succeed');
	}

	const bytes = await bytesFromImageRef(output[0], fetchImpl);
	return {
		bytes,
		costUsd: 0,
		costEstimated: true,
		pricingBasis: RUNWAY_PRICING_BASIS,
		promptTokens: 0,
		completionTokens: 0,
		totalTokens: 0,
		latencyMs: Date.now() - startMs,
	};
}
