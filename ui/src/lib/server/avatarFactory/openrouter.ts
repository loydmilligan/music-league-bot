import { appBaseUrl } from '$lib/config/urls.js';
import {
	isAbortError,
	openRouterErrorFields,
	parseJsonObject,
	ProviderError,
	reasonFromHttpStatus,
	type ImageRefMeta,
} from './errors.js';

export const DEFAULT_FACTORY_MODEL = 'google/gemini-2.5-flash-image';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

export interface ImageGenResult {
	bytes: Uint8Array;
	costUsd: number;
	costEstimated?: boolean;
	pricingBasis?: string;
	promptTokens: number;
	completionTokens: number;
	totalTokens: number;
	latencyMs: number;
}

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

function redact(text: string, key: string): string {
	if (!key) return text;
	return text.split(key).join('[redacted]');
}

function getKey(): string {
	const key = process.env.OPENROUTER_API_KEY;
	if (!key) throw new Error('OPENROUTER_API_KEY is not set');
	return key;
}

export interface GenerateImageOpts {
	prompt: string;
	imageDataUrls?: string[];
	model?: string;
	aspectRatio?: string;
	fetchImpl?: FetchLike;
	apiKey?: string;
	imageMeta?: ImageRefMeta[];
	timeoutMs?: number;
}

/**
 * OpenRouter chat/completions image generation (same shape as make_avatars.py).
 * Never logs the API key. Tests inject fetchImpl and never hit the network.
 */
export async function generateOpenRouterImage(opts: GenerateImageOpts): Promise<ImageGenResult> {
	const apiKey = opts.apiKey ?? (opts.fetchImpl ? (process.env.OPENROUTER_API_KEY || 'mock') : getKey());
	const model = opts.model ?? DEFAULT_FACTORY_MODEL;
	const fetchImpl = opts.fetchImpl ?? fetch;

	const content: Array<Record<string, unknown>> = [{ type: 'text', text: opts.prompt }];
	for (const url of opts.imageDataUrls ?? []) {
		content.push({ type: 'image_url', image_url: { url } });
	}

	const body = {
		model,
		messages: [{ role: 'user', content }],
		modalities: ['image', 'text'],
		image_config: { aspect_ratio: opts.aspectRatio ?? '1:1' },
		usage: { include: true },
	};

	const startMs = Date.now();
	const payloadBytes = Buffer.byteLength(JSON.stringify(body), 'utf8');
	const refs = opts.imageMeta;
	const controller = opts.timeoutMs && opts.timeoutMs > 0 ? new AbortController() : null;
	const timer = controller ? setTimeout(() => controller.abort(), opts.timeoutMs) : undefined;
	let res: Response;
	try {
		res = await fetchImpl(OPENROUTER_URL, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${apiKey}`,
				'Content-Type': 'application/json',
				'HTTP-Referer': appBaseUrl(),
				'X-Title': 'Music League Bot - Avatar Factory',
			},
			body: JSON.stringify(body),
			signal: controller?.signal,
		});
	} catch (e) {
		if (isAbortError(e)) {
			throw new ProviderError({
				provider: 'openrouter',
				model,
				status: null,
				reason: 'timeout',
				snippet: `timed out after ${opts.timeoutMs}ms`,
				payloadBytes,
				refs,
			});
		}
		throw e;
	} finally {
		if (timer) clearTimeout(timer);
	}
	const latencyMs = Date.now() - startMs;

	if (!res.ok) {
		const text = redact(await res.text().catch(() => ''), apiKey).slice(0, 500);
		const parsed = parseJsonObject(text);
		const fields = openRouterErrorFields(parsed);
		throw new ProviderError({
			provider: 'openrouter',
			model,
			status: res.status,
			reason: reasonFromHttpStatus(res.status),
			snippet: fields.message ?? text,
			providerCode: fields.code,
			generationId: fields.generationId,
			finishReason: fields.finishReason,
			nativeFinishReason: fields.nativeFinishReason,
			failedCostUsd: fields.failedCostUsd,
			payloadBytes,
			refs,
		});
	}

	const json = (await res.json()) as {
		id?: string;
		choices?: {
			finish_reason?: string;
			native_finish_reason?: string;
			message?: {
				images?: { image_url: { url: string } | string }[];
				content?: string;
			};
		}[];
		usage?: { cost?: number; prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
	};

	const images = json.choices?.[0]?.message?.images;
	if (!images || images.length === 0) {
		const fields = openRouterErrorFields(json as Record<string, unknown>);
		throw new ProviderError({
			provider: 'openrouter',
			model,
			status: 200,
			reason: 'no_image',
			snippet: fields.content ?? fields.message ?? 'OpenRouter returned no image',
			providerCode: fields.code,
			generationId: fields.generationId ?? json.id,
			finishReason: fields.finishReason ?? json.choices?.[0]?.finish_reason,
			nativeFinishReason: fields.nativeFinishReason ?? json.choices?.[0]?.native_finish_reason,
			failedCostUsd: fields.failedCostUsd,
			payloadBytes,
			refs,
		});
	}

	const imageEntry = images[0];
	const raw =
		typeof imageEntry === 'string'
			? imageEntry
			: typeof imageEntry.image_url === 'string'
				? imageEntry.image_url
				: imageEntry.image_url?.url;

	if (!raw) {
		throw new ProviderError({
			provider: 'openrouter',
			model,
			status: 200,
			reason: 'no_image',
			snippet: 'OpenRouter returned no image',
			payloadBytes,
			refs,
		});
	}

	const hasCost = typeof json.usage?.cost === 'number';
	const cost = {
		costUsd: hasCost ? json.usage!.cost! : 0,
		costEstimated: !hasCost,
		pricingBasis: 'OpenRouter usage.cost when present; else ~$0.04/image estimate',
		promptTokens: typeof json.usage?.prompt_tokens === 'number' ? json.usage.prompt_tokens : 0,
		completionTokens: typeof json.usage?.completion_tokens === 'number' ? json.usage.completion_tokens : 0,
		totalTokens: typeof json.usage?.total_tokens === 'number' ? json.usage.total_tokens : 0,
		latencyMs,
	};

	if (raw.startsWith('data:')) {
		const b64Match = raw.match(/^data:[^;]+;base64,(.+)$/);
		if (!b64Match) throw new Error('OpenRouter returned malformed data URI');
		return { bytes: new Uint8Array(Buffer.from(b64Match[1], 'base64')), ...cost };
	}

	const imgRes = await fetchImpl(raw);
	if (!imgRes.ok) throw new Error(`Failed to fetch image from URL: ${imgRes.status}`);
	return { bytes: new Uint8Array(await imgRes.arrayBuffer()), ...cost };
}

export function toDataUrl(bytes: Uint8Array, mime = 'image/png'): string {
	return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
}

export function fileToDataUrl(buf: Buffer, mime: string): string {
	return `data:${mime};base64,${buf.toString('base64')}`;
}
