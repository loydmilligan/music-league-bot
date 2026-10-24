import { bytesFromImageRef, pollIntervalMs, redact, sleep } from './fetchUtil.js';
import type { GenerateImageOpts, ImageGenResult } from './openrouter.js';
import { FAL_PRICING_BASIS } from './providers.js';

const FAL_QUEUE = 'https://queue.fal.run/fal-ai/nano-banana/edit';
const MAX_POLLS = 40;

function getKey(): string {
	const key = process.env.FAL_KEY;
	if (!key) throw new Error('fal.ai needs key');
	return key;
}

function falHeaders(apiKey: string): Record<string, string> {
	return {
		Authorization: `Key ${apiKey}`,
		'Content-Type': 'application/json',
	};
}

function imageUrlFrom(json: {
	images?: { url?: string }[] | string[];
	image?: { url?: string } | string;
}): string | undefined {
	const first = json.images?.[0];
	if (typeof first === 'string') return first;
	if (first && typeof first === 'object' && first.url) return first.url;
	if (typeof json.image === 'string') return json.image;
	if (json.image && typeof json.image === 'object') return json.image.url;
	return undefined;
}

function reportedCost(json: Record<string, unknown>): number | undefined {
	const direct = json.cost;
	if (typeof direct === 'number') return direct;
	const nested = (json.usage as { cost?: number } | undefined)?.cost;
	if (typeof nested === 'number') return nested;
	return undefined;
}

/**
 * fal.ai nano-banana/edit via the queue API. Never logs FAL_KEY. Tests inject fetchImpl.
 */
export async function generateFalImage(opts: GenerateImageOpts): Promise<ImageGenResult> {
	const apiKey = opts.apiKey ?? (opts.fetchImpl ? process.env.FAL_KEY || 'mock' : getKey());
	const fetchImpl: FetchLike = opts.fetchImpl ?? fetch;
	const interval = pollIntervalMs(opts.fetchImpl);
	const aspect = opts.aspectRatio === '16:9' ? '16:9' : '1:1';

	const startMs = Date.now();
	const created = await fetchImpl(FAL_QUEUE, {
		method: 'POST',
		headers: falHeaders(apiKey),
		body: JSON.stringify({
			prompt: opts.prompt,
			image_urls: opts.imageDataUrls ?? [],
			num_images: 1,
			aspect_ratio: aspect,
			output_format: 'png',
		}),
	});
	if (!created.ok) {
		const text = redact(await created.text().catch(() => ''), apiKey).slice(0, 500);
		throw new Error(`fal.ai image ${created.status}: ${text}`);
	}
	const createdJson = (await created.json()) as Record<string, unknown> & {
		request_id?: string;
		status_url?: string;
		response_url?: string;
		status?: string;
		images?: { url?: string }[];
	};

	let payload: Record<string, unknown> = createdJson;
	let imageUrl = imageUrlFrom(createdJson);
	if (!imageUrl) {
		const requestId = createdJson.request_id;
		const statusUrl =
			createdJson.status_url ||
			(requestId ? `https://queue.fal.run/fal-ai/nano-banana/edit/requests/${requestId}/status` : '');
		const responseUrl =
			createdJson.response_url ||
			(requestId ? `https://queue.fal.run/fal-ai/nano-banana/edit/requests/${requestId}` : '');
		if (!statusUrl || !responseUrl) throw new Error('fal.ai returned no image');

		let status = String(createdJson.status ?? '');
		for (let i = 0; i < MAX_POLLS; i++) {
			if (status === 'COMPLETED') break;
			await sleep(interval);
			const st = await fetchImpl(statusUrl, { headers: { Authorization: `Key ${apiKey}` } });
			if (!st.ok) {
				const text = redact(await st.text().catch(() => ''), apiKey).slice(0, 500);
				throw new Error(`fal.ai poll ${st.status}: ${text}`);
			}
			const sj = (await st.json()) as { status?: string };
			status = String(sj.status ?? '');
			if (status === 'FAILED') throw new Error('fal.ai task failed');
		}
		if (status !== 'COMPLETED') throw new Error('fal.ai task did not complete');
		const done = await fetchImpl(responseUrl, { headers: { Authorization: `Key ${apiKey}` } });
		if (!done.ok) {
			const text = redact(await done.text().catch(() => ''), apiKey).slice(0, 500);
			throw new Error(`fal.ai result ${done.status}: ${text}`);
		}
		payload = (await done.json()) as Record<string, unknown>;
		imageUrl = imageUrlFrom(payload as { images?: { url?: string }[] });
	}

	if (!imageUrl) throw new Error('fal.ai returned no image');
	const actual = reportedCost(payload);
	const bytes = await bytesFromImageRef(imageUrl, fetchImpl);
	return {
		bytes,
		costUsd: actual ?? 0,
		costEstimated: actual == null,
		pricingBasis: FAL_PRICING_BASIS,
		promptTokens: 0,
		completionTokens: 0,
		totalTokens: 0,
		latencyMs: Date.now() - startMs,
	};
}
