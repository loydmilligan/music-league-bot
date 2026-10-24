import { appBaseUrl } from '$lib/config/urls.js';

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
	const res = await fetchImpl(OPENROUTER_URL, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${apiKey}`,
			'Content-Type': 'application/json',
			'HTTP-Referer': appBaseUrl(),
			'X-Title': 'Music League Bot - Avatar Factory',
		},
		body: JSON.stringify(body),
	});
	const latencyMs = Date.now() - startMs;

	if (!res.ok) {
		const text = redact(await res.text().catch(() => ''), apiKey).slice(0, 500);
		throw new Error(`OpenRouter image ${res.status}: ${text}`);
	}

	const json = (await res.json()) as {
		choices?: {
			message?: {
				images?: { image_url: { url: string } | string }[];
				content?: string;
			};
		}[];
		usage?: { cost?: number; prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
	};

	const images = json.choices?.[0]?.message?.images;
	if (!images || images.length === 0) {
		throw new Error('OpenRouter returned no image');
	}

	const imageEntry = images[0];
	const raw =
		typeof imageEntry === 'string'
			? imageEntry
			: typeof imageEntry.image_url === 'string'
				? imageEntry.image_url
				: imageEntry.image_url?.url;

	if (!raw) throw new Error('OpenRouter returned no image');

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
