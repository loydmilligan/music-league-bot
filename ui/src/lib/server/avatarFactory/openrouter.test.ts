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
		expect(result.bytes.byteLength).toBeGreaterThan(10);
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
});
