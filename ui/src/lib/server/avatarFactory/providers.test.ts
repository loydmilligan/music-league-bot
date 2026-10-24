import { describe, expect, it, vi } from 'vitest';
import { generateOptions } from './actions.js';
import { DISABLED_PENDING, DEFAULT_PROVIDER, listProviders, resolveProvider } from './providers.js';

describe('provider picker', () => {
	it('defaults to OpenRouter paused; others need key or stay disabled even with a key', () => {
		const none = listProviders({});
		expect(DEFAULT_PROVIDER).toBe('openrouter');
		expect(none.find((p) => p.isDefault)?.id).toBe('openrouter');
		expect(none.find((p) => p.id === 'openrouter')?.disabledReason).toBe('paused');
		expect(none.find((p) => p.id === 'openrouter')?.available).toBe(false);
		expect(none.find((p) => p.id === 'grok')?.disabledReason).toBe('needs key');
		expect(none.filter((p) => p.enabled).map((p) => p.id)).toEqual(['openrouter']);
		expect(none.filter((p) => p.available)).toEqual([]);

		const keyed = listProviders({
			OPENROUTER_API_KEY: 'x',
			XAI_API_KEY: 'x',
			RUNWAYML_API_SECRET: 'x',
			FAL_KEY: 'x',
		});
		expect(keyed.find((p) => p.id === 'openrouter')?.available).toBe(false);
		expect(keyed.find((p) => p.id === 'openrouter')?.disabledReason).toBe('paused');
		expect(keyed.find((p) => p.id === 'grok')?.needsKey).toBe(false);
		expect(keyed.find((p) => p.id === 'grok')?.enabled).toBe(false);
		expect(keyed.find((p) => p.id === 'grok')?.disabledReason).toBe(DISABLED_PENDING);
		expect(keyed.find((p) => p.id === 'runway')?.disabledReason).toBe(DISABLED_PENDING);
		expect(keyed.find((p) => p.id === 'fal')?.disabledReason).toBe(DISABLED_PENDING);

		const unpaused = listProviders({
			OPENROUTER_API_KEY: 'x',
			XAI_API_KEY: 'x',
			AVATAR_FACTORY_OPENROUTER_PAUSED: '0',
		});
		expect(unpaused.find((p) => p.id === 'openrouter')?.available).toBe(true);
		expect(unpaused.find((p) => p.id === 'grok')?.available).toBe(false);
		expect(unpaused.find((p) => p.id === 'grok')?.disabledReason).toBe(DISABLED_PENDING);
	});

	it('resolveProvider never auto-picks Grok, Runway, or fal', () => {
		expect(resolveProvider(undefined).id).toBe('openrouter');
		expect(resolveProvider('openrouter').id).toBe('openrouter');
		expect(() => resolveProvider('grok', {})).toThrow(/needs key/);
		expect(() => resolveProvider('grok', { XAI_API_KEY: 'x' })).toThrow(DISABLED_PENDING);
		expect(() => resolveProvider('runway', { RUNWAYML_API_SECRET: 'x' })).toThrow(DISABLED_PENDING);
		expect(() => resolveProvider('fal', { FAL_KEY: 'x' })).toThrow(DISABLED_PENDING);
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
