import { describe, it, expect } from 'vitest';
import { PopularityBodySchema } from './schema.js';

describe('PopularityBodySchema', () => {
	it('accepts a 0-100 popularity_proxy', () => {
		expect(PopularityBodySchema.safeParse({ popularity_proxy: 45 }).success).toBe(true);
	});
	it('rejects out-of-range / non-number', () => {
		expect(PopularityBodySchema.safeParse({ popularity_proxy: 150 }).success).toBe(false);
		expect(PopularityBodySchema.safeParse({ popularity_proxy: 'x' }).success).toBe(false);
	});
});
