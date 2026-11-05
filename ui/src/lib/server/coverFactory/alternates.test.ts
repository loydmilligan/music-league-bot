import { describe, it, expect, beforeEach } from 'vitest';
import sharp from 'sharp';
import { openLeagueDb } from '$lib/db/client.js';
import { findAlternateCovers, averageHash, _resetMusicBrainzClock } from './alternates.js';

const db = openLeagueDb(':memory:');

async function img(kind: 'a' | 'b'): Promise<Buffer> {
	const w = 64;
	const raw = Buffer.alloc(w * w * 3);
	for (let y = 0; y < w; y++)
		for (let x = 0; x < w; x++) {
			const v = kind === 'a' ? (x < 32 ? 255 : 0) : (y < 32 ? 255 : 0);
			const i = (y * w + x) * 3;
			raw[i] = raw[i + 1] = raw[i + 2] = v;
		}
	return sharp(raw, { raw: { width: w, height: w, channels: 3 } }).png().toBuffer();
}

const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });

interface Harness { calls: string[]; mbTimes: number[]; fetchImpl: (u: string | URL) => Promise<Response>; clock: { t: number }; now: () => number; sleep: (ms: number) => Promise<void> }
async function harness(opts: { mbStatus?: number; noGroups?: boolean } = {}): Promise<Harness> {
	const a = await img('a'), b = await img('b');
	const clock = { t: 1_000_000 };
	const calls: string[] = [];
	const mbTimes: number[] = [];
	const rels = Array.from({ length: 8 }, (_, i) => ({
		id: `rel-${i}`, date: `${1994 + i}-01-01`, country: 'US', 'cover-art-archive': { front: true },
	}));
	const fetchImpl = async (u: string | URL) => {
		const url = String(u);
		calls.push(url);
		if (url.startsWith('https://musicbrainz.org/')) {
			mbTimes.push(clock.t);
			if (opts.mbStatus) return json({ error: 'busy' }, opts.mbStatus);
			if (url.includes('/release-group?query=')) {
				return json({ 'release-groups': opts.noGroups ? [] : [{ id: 'rg1', title: 'Punk in Drublic', 'primary-type': 'Album', score: 100 }] });
			}
			if (url.includes('/recording?query=')) return json({ recordings: [] });
			if (url.includes('/release?release-group=')) return json({ releases: rels });
		}
		if (url.startsWith('https://coverartarchive.org/release/')) {
			const n = Number(/rel-(\d)/.exec(url)![1]);
			return new Response(new Uint8Array(n % 2 === 0 ? a : b), { status: 200, headers: { 'content-type': 'image/png' } });
		}
		return new Response('nope', { status: 404 });
	};
	return { calls, mbTimes, fetchImpl, clock, now: () => clock.t, sleep: async (ms) => { clock.t += ms; } };
}
const o = (h: Harness) => ({ fetchImpl: h.fetchImpl, now: h.now, sleep: h.sleep });

beforeEach(() => { db.exec('DELETE FROM cover_alt_cache'); _resetMusicBrainzClock(); });

describe('averageHash', () => {
	it('is 16 hex chars and differs for different images', async () => {
		const ha = await averageHash(await img('a'));
		expect(ha).toMatch(/^[0-9a-f]{16}$/);
		expect(await averageHash(await img('b'))).not.toBe(ha);
	});
});

describe('findAlternateCovers', () => {
	it('dedupes 8 releases with 2 distinct images, keeping the earliest, with https urls', async () => {
		const h = await harness();
		const r = await findAlternateCovers(db, { title: 'Linoleum', artist: 'NOFX', album: 'Punk in Drublic' }, o(h));
		expect(r.alternates.map((x) => x.releaseMbid)).toEqual(['rel-0', 'rel-1']);
		expect(r.alternates[0]).toMatchObject({ id: 'rel-0', releaseGroupMbid: 'rg1', title: 'Punk in Drublic', kind: 'Album', date: '1994-01-01', country: 'US' });
		expect(r.alternates[0].thumbUrl).toBe('https://coverartarchive.org/release/rel-0/front-250');
		expect(r.alternates[0].fullUrl).toBe('https://coverartarchive.org/release/rel-0/front-500');
		expect(r.message).toBeNull();
	});

	it('MusicBrainz 503 gives a busy message and caches nothing', async () => {
		const h = await harness({ mbStatus: 503 });
		const r = await findAlternateCovers(db, { title: 'x', artist: 'y', album: 'z' }, o(h));
		expect(r.alternates).toEqual([]);
		expect(r.message).toMatch(/busy|try again/i);
		expect((db.prepare('SELECT COUNT(*) c FROM cover_alt_cache').get() as { c: number }).c).toBe(0);
	});

	it('no matches gives an empty list and a message', async () => {
		const h = await harness({ noGroups: true });
		const r = await findAlternateCovers(db, { title: 'x', artist: 'y', album: 'z' }, o(h));
		expect(r.alternates).toEqual([]);
		expect(r.message).toBeTruthy();
	});

	it('serves a second call from cache without fetching', async () => {
		const h = await harness();
		const q = { title: 'Linoleum', artist: 'NOFX', album: 'Punk in Drublic' };
		await findAlternateCovers(db, q, o(h));
		const n = h.calls.length;
		const r = await findAlternateCovers(db, { ...q, artist: 'nofx' }, o(h));
		expect(h.calls.length).toBe(n);
		expect(r.alternates).toHaveLength(2);
	});

	it('refetches after the 7-day TTL', async () => {
		const h = await harness();
		const q = { title: 'Linoleum', artist: 'NOFX', album: 'Punk in Drublic' };
		await findAlternateCovers(db, q, o(h));
		const n = h.calls.length;
		h.clock.t += 8 * 86400_000;
		await findAlternateCovers(db, q, o(h));
		expect(h.calls.length).toBeGreaterThan(n);
	});

	it('spaces MusicBrainz requests at least 1100 ms apart', async () => {
		const h = await harness();
		await findAlternateCovers(db, { title: 'Linoleum', artist: 'NOFX', album: 'Punk in Drublic' }, o(h));
		expect(h.mbTimes.length).toBeGreaterThanOrEqual(2);
		for (let i = 1; i < h.mbTimes.length; i++) expect(h.mbTimes[i] - h.mbTimes[i - 1]).toBeGreaterThanOrEqual(1100);
	});

	it('searches the cleaned title (no remaster suffix)', async () => {
		const h = await harness({ noGroups: true });
		await findAlternateCovers(db, { title: 'Juicy - 2007 Remaster', artist: 'The Notorious B.I.G.' }, o(h));
		const mb = h.calls.find((c) => c.includes('/recording?query='))!;
		const q = decodeURIComponent(mb);
		expect(q).toContain('recording:"Juicy"');
		expect(q).not.toMatch(/Remaster/i);
		expect(q).toContain('status:official');
	});
});

async function bits(k: number): Promise<Buffer> {
	const raw = Buffer.alloc(64 * 3);
	for (let i = 0; i < k; i++) raw.fill(255, i * 3, i * 3 + 3);
	return sharp(raw, { raw: { width: 8, height: 8, channels: 3 } }).png().toBuffer();
}

function custom(o: {
	albumGroups?: any[]; recordings?: any[]; releases: Record<string, any[]>;
	thumb: (mbid: string) => Promise<Buffer | null>;
}) {
	const clock = { t: 5_000_000 };
	const calls: string[] = [];
	const fetchImpl = async (u: string | URL) => {
		const url = String(u);
		calls.push(url);
		if (url.includes('/release-group?query=')) return json({ 'release-groups': o.albumGroups ?? [] });
		if (url.includes('/recording?query=')) return json({ recordings: o.recordings ?? [] });
		const m = /release\?release-group=([^&]+)/.exec(url);
		if (m) return json({ releases: o.releases[m[1]] ?? [] });
		const t = /release\/([^/]+)\/front-250/.exec(url);
		if (t) {
			const b = await o.thumb(t[1]);
			return b ? new Response(new Uint8Array(b), { status: 200, headers: { 'content-type': 'image/png' } }) : new Response('x', { status: 404 });
		}
		return new Response('nope', { status: 404 });
	};
	return { calls, opts: { fetchImpl, now: () => clock.t, sleep: async (ms: number) => { clock.t += ms; } } };
}
const rel = (id: string, date: string) => ({ id, date, country: 'US', 'cover-art-archive': { front: true } });

describe('findAlternateCovers edge cases', () => {
	it('a CAA thumbnail 404 skips only that candidate', async () => {
		const [a, b] = [await bits(5), await bits(40)];
		const h = custom({
			albumGroups: [{ id: 'g', title: 'Alb', 'primary-type': 'Album', score: 100 }],
			releases: { g: [rel('r1', '2000'), rel('r2', '2001'), rel('r3', '2002')] },
			thumb: async (id) => (id === 'r2' ? null : id === 'r1' ? a : b),
		});
		const r = await findAlternateCovers(db, { title: 't', artist: 'a', album: 'Alb' }, h.opts);
		expect(r.alternates.map((x) => x.releaseMbid)).toEqual(['r1', 'r3']);
	});

	it('Hamming distance 6 is a duplicate, 7 is distinct', async () => {
		const [base, d6, d7] = [await bits(10), await bits(16), await bits(17)];
		const h = custom({
			albumGroups: [{ id: 'g', title: 'Alb', 'primary-type': 'Album', score: 100 }],
			releases: { g: [rel('base', '2000'), rel('d6', '2001'), rel('d7', '2002')] },
			thumb: async (id) => (id === 'base' ? base : id === 'd6' ? d6 : d7),
		});
		const r = await findAlternateCovers(db, { title: 't', artist: 'a', album: 'Alb' }, h.opts);
		expect(r.alternates.map((x) => x.releaseMbid)).toEqual(['base', 'd7']);
	});

	it('a low-score album group is not browsed', async () => {
		const h = custom({
			albumGroups: [
				{ id: 'lo', title: 'Alb', 'primary-type': 'Album', score: 60 },
				{ id: 'other', title: 'Totally Different', 'primary-type': 'Album', score: 100 },
			],
			releases: { lo: [rel('x', '2000')], other: [rel('y', '2000')] },
			thumb: async () => bits(20),
		});
		const r = await findAlternateCovers(db, { title: 't', artist: 'a', album: 'Alb' }, h.opts);
		expect(h.calls.some((c) => c.includes('release-group=lo'))).toBe(false);
		expect(h.calls.some((c) => c.includes('release-group=other'))).toBe(false);
		expect(r.alternates).toEqual([]);
	});

	it('merges the album group first, then a Single group from the recording search', async () => {
		const [a, b] = [await bits(5), await bits(40)];
		const h = custom({
			albumGroups: [{ id: 'alb', title: 'Ready to Die (Deluxe Edition)', 'primary-type': 'Album', score: 100 }],
			recordings: [{ releases: [
				{ title: 'Ready to Die', 'release-group': { id: 'alb', 'primary-type': 'Album' } },
				{ title: 'Juicy', 'release-group': { id: 'sing', title: 'Juicy', 'primary-type': 'Single' } },
				{ title: 'Live', 'release-group': { id: 'live', 'primary-type': 'Album', 'secondary-types': ['Live'] } },
			] }],
			releases: { alb: [rel('ra', '1994')], sing: [rel('rs', '1994-08')], live: [rel('rl', '2000')] },
			thumb: async (id) => (id === 'ra' ? a : b),
		});
		const r = await findAlternateCovers(db, { title: 'Juicy', artist: 'B', album: 'Ready to Die' }, h.opts);
		expect(r.alternates.map((x) => [x.releaseMbid, x.kind])).toEqual([['ra', 'Album'], ['rs', 'Single']]);
		expect(h.calls.some((c) => c.includes('release-group=live'))).toBe(false);
		expect(h.calls.filter((c) => c.includes('musicbrainz.org')).length).toBeLessThanOrEqual(6);
	});
});
