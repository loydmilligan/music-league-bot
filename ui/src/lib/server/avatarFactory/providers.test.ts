import { describe, expect, it, vi } from 'vitest';
import { generateOptions } from './actions.js';
import { DISABLED_PENDING, DEFAULT_PROVIDER, listProviders, resolveProvider } from './providers.js';

describe('provider picker', () => {
	it('enables OpenRouter, Runway, and fal when keyed; Grok stays disabled', () => {
		const none = listProviders({});
		expect(DEFAULT_PROVIDER).toBe('openrouter');
		expect(none.find((p) => p.isDefault)?.id).toBe('openrouter');
		expect(none.find((p) => p.id === 'openrouter')?.disabledReason).toBe('needs key');
		expect(none.find((p) => p.id === 'openrouter')?.available).toBe(false);
		expect(none.find((p) => p.id === 'grok')?.disabledReason).toBe('needs key');
		expect(none.find((p) => p.id === 'grok')?.enabled).toBe(false);
		expect(none.filter((p) => p.enabled).map((p) => p.id)).toEqual(['openrouter', 'runway', 'fal']);
		expect(none.filter((p) => p.available)).toEqual([]);

		const keyed = listProviders({
			OPENROUTER_API_KEY: 'x',
			XAI_API_KEY: 'x',
			RUNWAY_API_SECRET: 'x',
			FAL_KEY: 'x',
		});
		expect(keyed.find((p) => p.id === 'openrouter')?.available).toBe(true);
		expect(keyed.find((p) => p.id === 'runway')?.available).toBe(true);
		expect(keyed.find((p) => p.id === 'runway')?.model).toBe('gen4_image');
		expect(keyed.find((p) => p.id === 'runway')?.estimatedCostUsd).toBe(0.05);
		expect(keyed.find((p) => p.id === 'fal')?.available).toBe(true);
		expect(keyed.find((p) => p.id === 'fal')?.model).toBe('fal-ai/nano-banana/edit');
		expect(keyed.find((p) => p.id === 'fal')?.estimatedCostUsd).toBe(0.0398);
		expect(keyed.find((p) => p.id === 'grok')?.needsKey).toBe(false);
		expect(keyed.find((p) => p.id === 'grok')?.enabled).toBe(false);
		expect(keyed.find((p) => p.id === 'grok')?.disabledReason).toBe(DISABLED_PENDING);

		const runwayFallback = listProviders({ RUNWAYML_API_SECRET: 'x' });
		expect(runwayFallback.find((p) => p.id === 'runway')?.available).toBe(true);

		const paused = listProviders({
			OPENROUTER_API_KEY: 'x',
			RUNWAY_API_SECRET: 'x',
			FAL_KEY: 'x',
			AVATAR_FACTORY_OPENROUTER_PAUSED: '1',
		});
		expect(paused.find((p) => p.id === 'openrouter')?.available).toBe(false);
		expect(paused.find((p) => p.id === 'runway')?.available).toBe(false);
		expect(paused.find((p) => p.id === 'fal')?.available).toBe(false);
		expect(paused.find((p) => p.id === 'openrouter')?.disabledReason).toBe('paused');
		expect(paused.find((p) => p.id === 'grok')?.disabledReason).toBe('needs key');
	});

	it('resolveProvider allows keyed OpenRouter/Runway/fal and never Grok', () => {
		expect(resolveProvider(undefined, { OPENROUTER_API_KEY: 'x' }).id).toBe('openrouter');
		expect(resolveProvider('openrouter', { OPENROUTER_API_KEY: 'x' }).id).toBe('openrouter');
		expect(resolveProvider('runway', { RUNWAY_API_SECRET: 'x' }).id).toBe('runway');
		expect(resolveProvider('runway', { RUNWAYML_API_SECRET: 'x' }).id).toBe('runway');
		expect(resolveProvider('fal', { FAL_KEY: 'x' }).id).toBe('fal');
		expect(() => resolveProvider('grok', {})).toThrow(/needs key/);
		expect(() => resolveProvider('grok', { XAI_API_KEY: 'x' })).toThrow(DISABLED_PENDING);
		expect(() => resolveProvider('runway', {})).toThrow(/needs key/);
		expect(() => resolveProvider('fal', {})).toThrow(/needs key/);
	});

	it('picking Grok makes no outbound fetch even with a key', async () => {
		const fetchImpl = vi.fn();
		const prev = process.env.AVATAR_FACTORY_OPENROUTER_PAUSED;
		const prevXai = process.env.XAI_API_KEY;
		process.env.AVATAR_FACTORY_OPENROUTER_PAUSED = '0';
		process.env.XAI_API_KEY = 'x';
		try {
			await expect(
				generateOptions(
					{
						leagueSlug: 'boarz-ii-men',
						themeSlug: 'south-park',
						memberSlug: 'matt-mariani',
						provider: 'grok',
						confirmed: true,
					},
					{ fetchImpl },
				),
			).rejects.toThrow(DISABLED_PENDING);
			expect(fetchImpl).not.toHaveBeenCalled();
		} finally {
			if (prev === undefined) delete process.env.AVATAR_FACTORY_OPENROUTER_PAUSED;
			else process.env.AVATAR_FACTORY_OPENROUTER_PAUSED = prev;
			if (prevXai === undefined) delete process.env.XAI_API_KEY;
			else process.env.XAI_API_KEY = prevXai;
		}
	});
});
