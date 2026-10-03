import { describe, it, expect } from 'vitest';
import { digestsFor, type PortalJson } from '../../../../bside/src/lib/portal.ts';

const rm = {
	archive: [
		{ n: 3, season: 2, theme: 'Archive3', winnerSong: 'w', winnerArtist: 'a', submitter: 's', date: 'd', votes: 5, hue: 'h', digestUrl: 'https://x.example/d/1' },
		{ n: 2, season: 1, theme: 'Archive2', winnerSong: 'w', winnerArtist: 'a', submitter: 's', date: 'd', votes: 5, hue: 'h' }
	]
};
const portal = (): PortalJson => ({
	version: 1, generatedAt: 'x', seasonFeedUrl: null, seasonHubUrl: null,
	digests: [{ roundId: 9, n: 3, season: 2, theme: 'Portal3', date: 'd', winnerSong: 'w', winnerArtist: 'a', submitter: 's', votes: 1, hue: 'h', digestUrl: 'https://x.example/d2/z', digestKind: 'v2' }]
});

describe('digestsFor', () => {
	it('prefers portal digests when present', () => {
		const out = digestsFor(rm, portal());
		expect(out).toHaveLength(1);
		expect(out[0].theme).toBe('Portal3');
		expect(out[0].digestUrl).toBe('https://x.example/d2/z');
	});
	it('treats an empty portal digest list as authoritative', () => {
		const p = portal();
		p.digests = [];
		expect(digestsFor(rm, p)).toEqual([]);
	});
	it('falls back to archive with roundId null and digestUrl normalized to null', () => {
		const out = digestsFor(rm, null);
		expect(out.map((d) => d.theme)).toEqual(['Archive3', 'Archive2']);
		expect(out.every((d) => d.roundId === null)).toBe(true);
		expect(out[0].digestUrl).toBe('https://x.example/d/1');
		expect(out[1].digestUrl).toBeNull();
	});
});
