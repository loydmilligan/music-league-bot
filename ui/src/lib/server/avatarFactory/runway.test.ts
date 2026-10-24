import { describe, expect, it, vi } from 'vitest';
import { generateRunwayImage } from './runway.js';

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('Runway client (mocked)', () => {
	it('posts gen4_image, polls the task, and never hits the network', async () => {
		const fetchImpl = vi.fn(async (input: string | URL) => {
			const url = String(input);
			if (url.endsWith('/text_to_image')) {
				return new Response(JSON.stringify({ id: 'task_abc' }), { status: 200 });
			}
			if (url.endsWith('/tasks/task_abc')) {
				return new Response(
					JSON.stringify({ status: 'SUCCEEDED', output: [`data:image/png;base64,${PNG_B64}`] }),
					{ status: 200 },
				);
			}
			throw new Error(url);
		});
		const result = await generateRunwayImage({
			prompt: 'Use @subject as the person.\ndraw a cartoon',
			imageDataUrls: ['data:image/png;base64,AAA'],
			apiKey: 'test-key-not-real',
			fetchImpl,
		});
		expect(fetchImpl).toHaveBeenCalledTimes(2);
		expect(String(fetchImpl.mock.calls[0][0])).toBe('https://api.dev.runwayml.com/v1/text_to_image');
		const body = JSON.parse(String((fetchImpl.mock.calls[0][1] as RequestInit).body));
		expect(body.model).toBe('gen4_image');
		expect(body.ratio).toBe('1024:1024');
		expect(body.referenceImages[0].tag).toBe('subject');
		expect(result.costEstimated).toBe(true);
		expect(result.bytes.byteLength).toBeGreaterThan(10);
	});

	it('redacts the key from error bodies', async () => {
		const fetchImpl = vi.fn(async () => new Response('bad test-key-not-real leaked', { status: 401 }));
		await expect(
			generateRunwayImage({ prompt: 'x', apiKey: 'test-key-not-real', fetchImpl }),
		).rejects.toThrow(/\[redacted\]/);
	});
});
