import { describe, it, expect, vi } from 'vitest';
vi.mock('$app/state', () => ({ page: { url: new URL('http://x/digest2/1') } }));
import { render } from 'svelte/server';
const { default: PlayerCards } = await import('./PlayerCards.svelte');

const base = { name: 'Shane', hero: 'Stan', rank: 7, points: 43, poster: 'https://cdn.example/p.jpg' };

describe('PlayerCards', () => {
	it('card without a clip: poster image, no video, no root-relative or empty links', () => {
		const { body } = render(PlayerCards, {
			props: { cards: [{ ...base, slug: 'shane', src: '', shareImage: '' }] }
		});
		expect(body).toContain('src="https://cdn.example/p.jpg"');
		expect(body).not.toContain('<video');
		expect(body).not.toMatch(/href="\/share\//);
		expect(body).not.toMatch(/href=""/);
	});
	it('card with a clip keeps the video and both links (1.0 behavior unchanged)', () => {
		const { body } = render(PlayerCards, {
			props: { cards: [{ ...base, slug: 'shane', src: 'https://cdn.example/c/shane.mp4?v2', shareImage: 'https://cdn.example/c/share/shane.jpg' }] }
		});
		expect(body).toContain('<video');
		expect(body).toContain('href="https://cdn.example/c/share/shane.jpg"');
		expect(body).toContain('href="https://cdn.example/c/shane.mp4"');
	});
});
