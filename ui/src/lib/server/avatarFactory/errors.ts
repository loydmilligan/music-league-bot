export type ProviderErrorReason =
	| 'safety_refusal'
	| 'out_of_credits'
	| 'bad_input'
	| 'rate_limited'
	| 'no_image'
	| 'timeout'
	| 'provider_http';

export interface ImageRefMeta {
	filename: string;
	width: number;
	height: number;
	bytes: number;
}

export interface LastError {
	at: string;
	provider: string;
	model: string;
	status: number | null;
	reason: ProviderErrorReason;
	message: string;
}

const USER_REASON: Record<ProviderErrorReason, string> = {
	safety_refusal: 'Safety/likeness refusal by the model',
	out_of_credits: 'Out of credits (402)',
	bad_input: 'Bad input image',
	rate_limited: 'Rate limited',
	no_image: 'Safety/likeness refusal by the model',
	timeout: 'Request timed out',
	provider_http: 'Provider error',
};

export class ProviderError extends Error {
	readonly provider: string;
	readonly model: string;
	readonly status: number | null;
	readonly reason: ProviderErrorReason;
	readonly snippet?: string;
	readonly generationId?: string;
	readonly finishReason?: string;
	readonly nativeFinishReason?: string;
	readonly providerCode?: string;
	readonly failedCostUsd?: number;
	readonly payloadBytes?: number;
	readonly refs?: ImageRefMeta[];

	constructor(opts: {
		provider: string;
		model: string;
		status: number | null;
		reason: ProviderErrorReason;
		message?: string;
		snippet?: string;
		generationId?: string;
		finishReason?: string;
		nativeFinishReason?: string;
		providerCode?: string;
		failedCostUsd?: number;
		payloadBytes?: number;
		refs?: ImageRefMeta[];
	}) {
		const snippet = opts.snippet ? stripSecrets(opts.snippet).slice(0, 200) : undefined;
		const user = snippet ? `${USER_REASON[opts.reason]}: ${snippet}` : USER_REASON[opts.reason];
		super(opts.message ?? user);
		this.name = 'ProviderError';
		this.provider = opts.provider;
		this.model = opts.model;
		this.status = opts.status;
		this.reason = opts.reason;
		this.snippet = snippet;
		this.generationId = opts.generationId;
		this.finishReason = opts.finishReason;
		this.nativeFinishReason = opts.nativeFinishReason;
		this.providerCode = opts.providerCode;
		this.failedCostUsd = opts.failedCostUsd;
		this.payloadBytes = opts.payloadBytes;
		this.refs = opts.refs;
	}

	get userMessage(): string {
		return this.message;
	}

	get httpStatus(): number {
		if (this.reason === 'out_of_credits') return 402;
		if (this.reason === 'rate_limited') return 429;
		if (this.reason === 'bad_input') return 400;
		if (this.reason === 'safety_refusal' || this.reason === 'no_image') return 422;
		if (this.reason === 'timeout') return 504;
		return 502;
	}

	toLastError(): LastError {
		return {
			at: new Date().toISOString(),
			provider: this.provider,
			model: this.model,
			status: this.status,
			reason: this.reason,
			message: this.userMessage,
		};
	}
}

export function isAbortError(e: unknown): boolean {
	return e instanceof Error && (e.name === 'AbortError' || /aborted|timed out/i.test(e.message));
}

export function reasonFromHttpStatus(status: number): ProviderErrorReason {
	if (status === 402) return 'out_of_credits';
	if (status === 429) return 'rate_limited';
	if (status === 400) return 'bad_input';
	return 'provider_http';
}

export function stripSecrets(text: string): string {
	return text
		.replace(/data:[^;]+;base64,[A-Za-z0-9+/=]+/gi, '[data-uri]')
		.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
		.replace(/Key\s+\S+/gi, 'Key [redacted]');
}

export function snippetFromUnknown(value: unknown): string | undefined {
	if (typeof value === 'string' && value.trim()) return stripSecrets(value).slice(0, 200);
	return undefined;
}

/** One JSON line. Never keys or base64. */
export function logProviderError(err: ProviderError, log = console.error): void {
	log(
		JSON.stringify({
			avatarFactoryProviderError: true,
			provider: err.provider,
			model: err.model,
			httpStatus: err.status,
			providerErrorCode: err.providerCode ?? null,
			providerErrorMessage: err.snippet ?? err.message,
			finish_reason: err.finishReason ?? null,
			native_finish_reason: err.nativeFinishReason ?? null,
			textSnippet: err.snippet ?? null,
			generationId: err.generationId ?? null,
			payloadBytes: err.payloadBytes ?? null,
			refs: (err.refs ?? []).map((r) => ({
				filename: r.filename,
				width: r.width,
				height: r.height,
				bytes: r.bytes,
			})),
			reason: err.reason,
		}),
	);
}

export function parseJsonObject(text: string): Record<string, unknown> | null {
	try {
		const v = JSON.parse(text) as unknown;
		return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

export function openRouterErrorFields(json: Record<string, unknown> | null): {
	code?: string;
	message?: string;
	finishReason?: string;
	nativeFinishReason?: string;
	generationId?: string;
	content?: string;
	failedCostUsd?: number;
} {
	if (!json) return {};
	const err = json.error as { code?: string | number; message?: string } | undefined;
	const choices = json.choices as
		| {
				finish_reason?: string;
				native_finish_reason?: string;
				message?: { content?: string };
		  }[]
		| undefined;
	const choice = choices?.[0];
	const usage = json.usage as { cost?: number } | undefined;
	const content = typeof choice?.message?.content === 'string' ? choice.message.content : undefined;
	return {
		code: err?.code != null ? String(err.code) : undefined,
		message: typeof err?.message === 'string' ? err.message : undefined,
		finishReason: choice?.finish_reason,
		nativeFinishReason: choice?.native_finish_reason,
		generationId: typeof json.id === 'string' ? json.id : undefined,
		content,
		failedCostUsd: typeof usage?.cost === 'number' ? usage.cost : undefined,
	};
}
