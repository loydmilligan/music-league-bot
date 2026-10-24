import { describe, expect, it, vi } from 'vitest';
import { generateFalImage } from './fal.js';

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('fal.ai client (mocked)', () => {
	it('posts nano-banana/edit to the queue and never hits the network', async () => {
		const fetchImpl = vi.fn(async () => {
			return new Response(
				JSON.stringify({ images: [{ url: `data:image/png;base64,${PNG_B64}` }] }),
				{ status: 200 },
			);
		});
		const result = await generateFalImage({
			prompt: 'draw a cartoon',
			imageDataUrls: ['data:image/png;base64,AAA'],
			apiKey: 'test-key-not-real',
			fetchImpl,
		});
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		expect(String(fetchImpl.mock.calls[0][0])).toBe('https://queue.fal.run/fal-ai/nano-banana/edit');
		const headers = (fetchImpl.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
		expect(headers.Authorization).toBe('Key test-key-not-real');
		const body = JSON.parse(String((fetchImpl.mock.calls[0][1] as RequestInit).body));
		expect(body.image_urls).toHaveLength(1);
		expect(body.num_images).toBe(1);
		expect(result.costEstimated).toBe(true);
		expect(result.bytes.byteLength).toBeGreaterThan(10);
	});

	it('polls the queue when the submit response has a request_id', async () => {
		const fetchImpl = vi.fn(async (input: string | URL) => {
			const url = String(input);
			if (url === 'https://queue.fal.run/fal-ai/nano-banana/edit') {
				return new Response(
					JSON.stringify({
						request_id: 'req-1',
						status_url: 'https://queue.fal.run/status',
						response_url: 'https://queue.fal.run/result',
					}),
					{ status: 200 },
				);
			}
			if (url === 'https://queue.fal.run/status') {
				return new Response(JSON.stringify({ status: 'COMPLETED' }), { status: 200 });
			}
			if (url === 'https://queue.fal.run/result') {
				return new Response(
					JSON.stringify({ images: [{ url: `data:image/png;base64,${PNG_B64}` }], cost: 0.0398 }),
					{ status: 200 },
				);
			}
			throw new Error(url);
		});
		const result = await generateFalImage({ prompt: 'x', apiKey: 'k', fetchImpl });
		expect(result.costEstimated).toBe(false);
		expect(result.costUsd).toBe(0.0398);
		expect(fetchImpl).toHaveBeenCalledTimes(3);
	});
});
