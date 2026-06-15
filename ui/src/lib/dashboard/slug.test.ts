import { describe, it, expect } from 'vitest';
import { mintSlug } from './slug.js';

describe('mintSlug', () => {
	it('returns a URL-safe string with no padding or special chars', () => {
		const slug = mintSlug();
		expect(slug).toMatch(/^[A-Za-z0-9_-]+$/);
	});

	it('yields at least 80 bits of entropy (≥14 base64url chars = 84 bits)', () => {
		// 16 raw bytes → 22 base64url chars (128 bits); minimum meaningful check is length
		const slug = mintSlug();
		expect(slug.length).toBeGreaterThanOrEqual(14);
	});

	it('produces unique slugs on each call', () => {
		const a = mintSlug();
		const b = mintSlug();
		expect(a).not.toBe(b);
	});
});
