import { describe, it, expect, vi, beforeEach } from 'vitest';
const pg = vi.hoisted(() => ({ page: { url: new URL('http://x/digest/180'), data: {} as Record<string, unknown> } }));
vi.mock('$app/state', () => pg);
import { render } from 'svelte/server';
import { coverOpAt, stripCoverOps } from './coverOps.js';
const { default: AlbumPodium } = await import('./AlbumPodium.svelte');

const items = [
	{ rank: 1, title: 'Gold Song', artist: 'A', coverUrl: '/api/cover-factory/media/exports/1.gif' },
	{ rank: 2, title: 'Tie One', artist: 'B' },
	{ rank: 2, title: 'Tie Two', artist: 'C' },
	{ rank: 4, title: 'Rest', artist: 'D' },
];
const content = {
	items,
	_coverNotes: { '1': 'submitter swapped in', 'Tie Two': 'no headshot for Jon' },
	_coverProjects: { '1': 7, 'Tie One': 8 },
};
const props = (c: unknown) => ({ props: { kind: 'podium', content: c, data: undefined, variant: 'visual' } as never });

beforeEach(() => {
	pg.page.url = new URL('http://x/digest/180');
	pg.page.data = {};
});

describe('coverOpFor / stripCoverOps', () => {
	it('keys by rank, or by title when the rank is tied', () => {
		expect(coverOpAt(content, 0)).toEqual({ note: 'submitter swapped in', projectId: 7 });
		expect(coverOpAt(content, 1)).toEqual({ note: null, projectId: 8 });
		expect(coverOpAt(content, 2)).toEqual({ note: 'no headshot for Jon', projectId: null });
		expect(coverOpAt(content, 3)).toBeNull();
		expect(coverOpAt({ items }, 0)).toBeNull();
		expect(coverOpAt({ items, _coverProjects: { '1': 'x' } }, 0)).toBeNull();
	});
	it('ties are counted over the medal slots the server keeps (ranks 1,1,1,1,2,2 → five slots)', () => {
		const t = {
			items: ['a', 'b', 'c', 'd'].map((x) => ({ rank: 1, title: `One ${x}` })).concat([{ rank: 2, title: 'Two a' }, { rank: 2, title: 'Two b' }]),
			// what the server writes: four 1s keyed by title, the single kept 2 keyed by rank
			_coverNotes: { 'One a': 'n1', 'One b': 'n2', 'One c': 'n3', 'One d': 'n4', '2': 'n5', 'Two a': 'WRONG', 'Two b': 'WRONG' },
		};
		expect([0, 1, 2, 3, 4, 5].map((i) => coverOpAt(t, i)?.note ?? null)).toEqual(['n1', 'n2', 'n3', 'n4', 'n5', null]);
	});
	it('reads place like the server: a place-tie is keyed by title even though the display rank differs', () => {
		const placed = {
			items: [{ place: 1, title: 'P1' }, { place: 3, title: 'Third A' }, { place: 3, title: 'Third B' }],
			_coverNotes: { '1': 'gold', 'Third A': 'a', 'Third B': 'b' },
		};
		expect([0, 1, 2].map((i) => coverOpAt(placed, i)?.note)).toEqual(['gold', 'a', 'b']);
		const body = render(AlbumPodium, props(placed)).body;
		for (const n of ['>gold<', '>a<', '>b<']) expect(body).toContain(n);
	});
	it('strips the operator keys; identity when absent', () => {
		expect(stripCoverOps(content)).toEqual({ items });
		const plain = { items };
		expect(stripCoverOps(plain)).toBe(plain);
		expect(stripCoverOps(null)).toBeNull();
	});
});

describe('AlbumPodium operator notes', () => {
	it('in the app: amber note + "Open in Cover Factory" link per slot, both export-hidden', () => {
		const { body } = render(AlbumPodium, props(content));
		expect(body).toContain('submitter swapped in');
		expect(body).toContain('no headshot for Jon');
		expect(body).toMatch(/<a[^>]*href="\/cover-factory\?project=7"/);
		expect(body).toMatch(/<a[^>]*href="\/cover-factory\?project=8"/);
		const ops = [...body.matchAll(/<[a-z]+\b[^>]*class="apod-cf[^"]*"[^>]*>/g)].map((m) => m[0]);
		expect(ops.length).toBe(4); // gold note + link, tie one link, tie two note
		for (const tag of ops) expect(tag).toContain('data-export-hide="1"');
		expect(body.match(/Open in Cover Factory/g)?.length).toBe(2);
	});
	it('never renders in an export (?export=1) or a share render (page.data.share)', () => {
		pg.page.url = new URL('http://x/digest/180?export=1');
		expect(render(AlbumPodium, props(content)).body).not.toMatch(/apod-cf|submitter swapped in|cover-factory\?project/);
		pg.page.url = new URL('http://x/digest2/180?share=1');
		pg.page.data = { share: true };
		expect(render(AlbumPodium, props(content)).body).not.toMatch(/apod-cf|submitter swapped in|cover-factory\?project/);
	});
	it('no operator keys → same markup as before', () => {
		const { body } = render(AlbumPodium, props({ items }));
		expect(body).not.toContain('apod-cf');
	});
});
