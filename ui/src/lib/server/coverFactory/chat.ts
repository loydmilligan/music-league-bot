import { appBaseUrl } from '$lib/config/urls.js';
import type { FetchLike } from '../avatarFactory/openrouter.js';
import {
	isAbortError,
	openRouterErrorFields,
	parseJsonObject,
	ProviderError,
	reasonFromHttpStatus,
	stripSecrets,
} from '../avatarFactory/errors.js';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

export interface ChatResult {
	text: string;
	costUsd: number | null;
	latencyMs: number;
}

export async function chatWithImages(o: {
	model: string;
	prompt: string;
	imageDataUrls: string[];
	fetchImpl?: FetchLike;
	apiKey?: string;
	timeoutMs?: number;
}): Promise<ChatResult> {
	const envKey = process.env.OPENROUTER_API_KEY;
	if (!o.apiKey && !o.fetchImpl && !envKey) throw new Error('OPENROUTER_API_KEY is not set');
	const apiKey = o.apiKey ?? (envKey || 'mock');
	const fetchImpl = o.fetchImpl ?? fetch;
	const content: Array<Record<string, unknown>> = [{ type: 'text', text: o.prompt }];
	for (const url of o.imageDataUrls) content.push({ type: 'image_url', image_url: { url } });
	const body = { model: o.model, messages: [{ role: 'user', content }], usage: { include: true } };
	const payload = JSON.stringify(body);
	const payloadBytes = Buffer.byteLength(payload, 'utf8');
	const controller = o.timeoutMs && o.timeoutMs > 0 ? new AbortController() : null;
	const timer = controller ? setTimeout(() => controller.abort(), o.timeoutMs) : undefined;
	const start = Date.now();
	let res: Response;
	try {
		res = await fetchImpl(OPENROUTER_URL, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${apiKey}`,
				'Content-Type': 'application/json',
				'HTTP-Referer': appBaseUrl(),
				'X-Title': 'Music League Bot - Cover Factory',
			},
			body: payload,
			signal: controller?.signal,
		});
	} catch (e) {
		if (isAbortError(e)) {
			throw new ProviderError({
				provider: 'openrouter', model: o.model, status: null, reason: 'timeout',
				snippet: `timed out after ${o.timeoutMs}ms`, payloadBytes,
			});
		}
		throw e;
	} finally {
		if (timer) clearTimeout(timer);
	}
	const latencyMs = Date.now() - start;
	if (!res.ok) {
		const text = stripSecrets((await res.text().catch(() => '')).split(apiKey).join('[redacted]')).slice(0, 500);
		const fields = openRouterErrorFields(parseJsonObject(text));
		throw new ProviderError({
			provider: 'openrouter', model: o.model, status: res.status, reason: reasonFromHttpStatus(res.status),
			snippet: fields.message ?? text, providerCode: fields.code, generationId: fields.generationId,
			failedCostUsd: fields.failedCostUsd, payloadBytes,
		});
	}
	const json = (await res.json()) as {
		choices?: { message?: { content?: string | Array<{ text?: string }> } }[];
		usage?: { cost?: number };
	};
	const c = json.choices?.[0]?.message?.content;
	const text = typeof c === 'string' ? c : Array.isArray(c) ? c.map((p) => p.text ?? '').join('') : '';
	const cost = json.usage?.cost;
	return { text, costUsd: typeof cost === 'number' ? cost : null, latencyMs };
}
