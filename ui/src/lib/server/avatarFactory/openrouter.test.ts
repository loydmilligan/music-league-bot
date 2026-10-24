import { describe, expect, it, vi } from 'vitest';
import { generateOpenRouterImage } from './openrouter.js';

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('OpenRouter client (mocked)', () => {
	it('posts to OpenRouter with a Bearer header and never hits the network', async () => {
		const fetchImpl = vi.fn(async () => {
			return new Response(
				JSON.stringify({
					choices: [
						{
							message: {
								images: [{ image_url: { url: `data:image/png;base64,${PNG_B64}` } }],
							},
						},
					],
					usage: { cost: 0.04, prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
				}),
				{ status: 200, headers: { 'Content-Type': 'application/json' } },
			);
		});

		const result = await generateOpenRouterImage({
			prompt: 'draw a cartoon',
			imageDataUrls: ['data:image/png;base64,AAA'],
			apiKey: 'test-key-not-real',
			fetchImpl,
		});

		expect(fetchImpl).toHaveBeenCalledTimes(1);
		const [url, init] = fetchImpl.mock.calls[0];
		expect(String(url)).toBe('https://openrouter.ai/api/v1/chat/completions');
		const headers = init?.headers as Record<string, string>;
		expect(headers.Authorization).toBe('Bearer test-key-not-real');
		const body = JSON.parse(String(init?.body));
		expect(body.model).toBe('google/gemini-2.5-flash-image');
		expect(body.modalities).toEqual(['image', 'text']);
		expect(result.costUsd).toBe(0.04);
		expect(result.costEstimated).toBe(false);
		expect(result.bytes.byteLength).toBeGreaterThan(10);
	});

	it('flags costEstimated when usage.cost is missing', async () => {
		const fetchImpl = vi.fn(async () => {
			return new Response(
				JSON.stringify({
					choices: [{ message: { images: [{ image_url: { url: `data:image/png;base64,${PNG_B64}` } }] } }],
					usage: { prompt_tokens: 10 },
				}),
				{ status: 200, headers: { 'Content-Type': 'application/json' } },
			);
		});
		const result = await generateOpenRouterImage({
			prompt: 'draw a cartoon',
			apiKey: 'test-key-not-real',
			fetchImpl,
		});
		expect(result.costEstimated).toBe(true);
		expect(result.costUsd).toBe(0);
	});

	it('redacts the key from error bodies', async () => {
		const fetchImpl = vi.fn(async () => new Response('bad test-key-not-real leaked', { status: 402 }));
		await expect(
			generateOpenRouterImage({
				prompt: 'x',
				apiKey: 'test-key-not-real',
				fetchImpl,
			}),
		).rejects.toThrow(/\[redacted\]/);
	});

	it('treats HTTP 402 as typed out-of-credits', async () => {
		const { ProviderError } = await import('./errors.js');
		const fetchImpl = vi.fn(async () =>
			new Response(JSON.stringify({ error: { code: 402, message: 'Payment required' } }), { status: 402 }),
		);
		try {
			await generateOpenRouterImage({ prompt: 'x', apiKey: 'k', fetchImpl });
			throw new Error('expected throw');
		} catch (e) {
			expect(e).toBeInstanceOf(ProviderError);
			const pe = e as InstanceType<typeof ProviderError>;
			expect(pe.reason).toBe('out_of_credits');
			expect(pe.status).toBe(402);
			expect(pe.httpStatus).toBe(402);
			expect(pe.userMessage).toMatch(/Out of credits \(402\)/);
			expect(pe.userMessage).toMatch(/Payment required/);
		}
	});

	it('treats 200 with no images as a typed safety/likeness refusal', async () => {
		const { ProviderError } = await import('./errors.js');
		const fetchImpl = vi.fn(async () =>
			new Response(
				JSON.stringify({
					id: 'gen_refuse',
					choices: [
						{
							finish_reason: 'stop',
							native_finish_reason: 'STOP',
							message: { content: 'I cannot generate images of this person.' },
						},
					],
					usage: { cost: 0.012 },
				}),
				{ status: 200, headers: { 'Content-Type': 'application/json' } },
			),
		);
		try {
			await generateOpenRouterImage({
				prompt: 'simpsons',
				apiKey: 'k',
				fetchImpl,
				imageMeta: [{ filename: '1792809638774.png', width: 245, height: 700, bytes: 12 }],
			});
			throw new Error('expected throw');
		} catch (e) {
			expect(e).toBeInstanceOf(ProviderError);
			const pe = e as InstanceType<typeof ProviderError>;
			expect(pe.reason).toBe('no_image');
			expect(pe.status).toBe(200);
			expect(pe.httpStatus).toBe(422);
			expect(pe.generationId).toBe('gen_refuse');
			expect(pe.finishReason).toBe('stop');
			expect(pe.failedCostUsd).toBe(0.012);
			expect(pe.refs?.[0]?.filename).toBe('1792809638774.png');
			expect(pe.userMessage).toMatch(/Safety\/likeness refusal by the model/);
			expect(pe.userMessage).toMatch(/I cannot generate images of this person/);
		}
	});

	it('surfaces a typed timeout when AbortController fires', async () => {
		const { ProviderError } = await import('./errors.js');
		const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
			await new Promise<never>((_, reject) => {
				const sig = init?.signal;
				const fail = () => {
					const err = new Error('The operation was aborted');
					err.name = 'AbortError';
					reject(err);
				};
				if (sig?.aborted) fail();
				else sig?.addEventListener('abort', fail, { once: true });
			});
			return new Response('unreachable');
		});
		try {
			await generateOpenRouterImage({ prompt: 'group', apiKey: 'k', fetchImpl, timeoutMs: 20 });
			throw new Error('expected throw');
		} catch (e) {
			expect(e).toBeInstanceOf(ProviderError);
			const pe = e as InstanceType<typeof ProviderError>;
			expect(pe.reason).toBe('timeout');
			expect(pe.httpStatus).toBe(504);
			expect(pe.userMessage).toMatch(/Request timed out/);
		}
	});
});

