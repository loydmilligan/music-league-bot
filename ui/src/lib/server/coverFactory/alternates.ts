import type Database from 'better-sqlite3';
import sharp from 'sharp';
import type { FetchLike } from '../avatarFactory/openrouter.js';
import { fetchCoverBytes } from './inputs.js';

export interface AltCover {
	id: string;
	releaseMbid: string;
	releaseGroupMbid: string;
	title: string;
	kind: string;
	date: string | null;
	country: string | null;
	thumbUrl: string;
	fullUrl: string;
}

const MB_BASE = 'https://musicbrainz.org/ws/2/';
const CAA_BASE = 'https://coverartarchive.org/release/';
const USER_AGENT = 'music-league-bot/1.0 (https://github.com/loydmilligan/music-league-bot)';
const MB_GAP_MS = 1100;
const MB_MAX_REQUESTS = 6;
const MAX_GROUPS = 4;
const MAX_ALTERNATES = 12;
const MAX_CANDIDATES = 30;
const HAMMING_LIMIT = 6;
const TTL_MS = 7 * 86400_000;
const TIMEOUT_MS = 10_000;
const BUSY_MESSAGE = 'MusicBrainz is busy right now. Try again in a minute.';
const EMPTY_MESSAGE = 'No alternate covers found for this song.';

class MusicBrainzBusy extends Error {}

// Module-level queue: serialises MusicBrainz calls and spaces them >= MB_GAP_MS apart.
let mbChain: Promise<unknown> = Promise.resolve();
let mbLast = -Infinity;
export function _resetMusicBrainzClock(): void {
	mbChain = Promise.resolve();
	mbLast = -Infinity;
}

type Sleep = (ms: number) => Promise<void>;
interface Ctx { fetchImpl: FetchLike; now: () => number; sleep: Sleep; mbCount: number }

async function getJson(ctx: Ctx, url: string): Promise<any> {
	const res = await ctx.fetchImpl(url, {
		headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
		signal: AbortSignal.timeout(TIMEOUT_MS),
		redirect: 'follow',
	});
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	return res.json();
}

function mbGet(ctx: Ctx, path: string, params: Record<string, string>): Promise<any> {
	if (ctx.mbCount >= MB_MAX_REQUESTS) return Promise.reject(new Error('MusicBrainz request budget exhausted'));
	ctx.mbCount++;
	const url = `${MB_BASE}${path}?${new URLSearchParams({ ...params, fmt: 'json' })}`;
	const run = async () => {
		const wait = mbLast + MB_GAP_MS - ctx.now();
		if (wait > 0) await ctx.sleep(wait);
		mbLast = ctx.now();
		try {
			return await getJson(ctx, url);
		} catch {
			throw new MusicBrainzBusy();
		}
	};
	const p = mbChain.then(run, run);
	mbChain = p.catch(() => {});
	return p;
}

/** Drop "- 2007 Remaster", "(feat. X)", "Single Version" style suffixes, then Lucene specials. */
export function cleanTerm(s: string): string {
	return s
		.replace(/\s*[\(\[]\s*(?:feat|ft|featuring)\b[^)\]]*[\)\]]/gi, '')
		.replace(/\s*[\(\[][^)\]]*\b(?:remaster(?:ed)?|single version|radio edit|mono|stereo|deluxe)\b[^)\]]*[\)\]]/gi, '')
		.replace(/\s+[-–—]\s+(?:\d{4}\s+)?(?:remaster(?:ed)?|.*\b(?:version|remaster(?:ed)?|edit|mix)\b).*$/i, '')
		.replace(/["\\+\-!(){}\[\]^~*?:\/&|]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

export async function averageHash(bytes: Buffer): Promise<string> {
	const px = await sharp(bytes).grayscale().resize(8, 8, { fit: 'fill' }).raw().toBuffer();
	let mean = 0;
	for (const v of px) mean += v;
	mean /= px.length;
	let hex = '';
	for (let i = 0; i < 64; i += 4) {
		let nib = 0;
		for (let j = 0; j < 4; j++) nib = (nib << 1) | (px[i + j] > mean ? 1 : 0);
		hex += nib.toString(16);
	}
	return hex;
}

function hamming(a: string, b: string): number {
	let d = 0;
	for (let i = 0; i < a.length; i++) {
		let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
		while (x) { d += x & 1; x >>= 1; }
	}
	return d;
}

interface Group { id: string; title: string; kind: string }

async function groupsFromAlbum(ctx: Ctx, album: string, artist: string): Promise<Group[]> {
	const j = await mbGet(ctx, 'release-group', { query: `releasegroup:"${album}" AND artist:"${artist}"`, limit: '5' });
	return (j['release-groups'] ?? []).map((g: any): Group => ({ id: g.id, title: g.title, kind: g['primary-type'] ?? 'Release' }));
}

async function groupsFromRecording(ctx: Ctx, title: string, artist: string): Promise<Group[]> {
	const j = await mbGet(ctx, 'recording', { query: `recording:"${title}" AND artist:"${artist}" AND status:official`, limit: '25' });
	const tally = new Map<string, { g: Group; n: number; live: boolean; preferred: boolean }>();
	for (const rec of j.recordings ?? []) {
		for (const rel of rec.releases ?? []) {
			const rg = rel['release-group'];
			if (!rg?.id) continue;
			const kind: string = rg['primary-type'] ?? 'Release';
			const e = tally.get(rg.id) ?? {
				g: { id: rg.id, title: rg.title ?? rel.title ?? '', kind },
				n: 0,
				live: (rg['secondary-types'] ?? []).includes('Live'),
				preferred: ['Album', 'Single', 'EP'].includes(kind),
			};
			e.n++;
			tally.set(rg.id, e);
		}
	}
	const all = [...tally.values()];
	let pool = all.filter((e) => !e.live);
	if (!pool.length) pool = all;
	pool.sort((a, b) => Number(b.preferred) - Number(a.preferred) || b.n - a.n);
	return pool.map((e) => e.g);
}

interface Candidate { rel: any; group: Group }

function toAlt(c: Candidate): AltCover {
	return {
		id: c.rel.id,
		releaseMbid: c.rel.id,
		releaseGroupMbid: c.group.id,
		title: c.group.title,
		kind: c.group.kind,
		date: c.rel.date || null,
		country: c.rel.country || null,
		thumbUrl: `${CAA_BASE}${c.rel.id}/front-250`,
		fullUrl: `${CAA_BASE}${c.rel.id}/front-500`,
	};
}

function readCache(db: Database.Database, key: string, now: number): AltCover[] | null {
	const row = db.prepare('SELECT json, fetched_at FROM cover_alt_cache WHERE key = ?').get(key) as { json: string; fetched_at: string } | undefined;
	if (!row) return null;
	const at = Date.parse(row.fetched_at);
	if (!Number.isFinite(at) || now - at > TTL_MS) return null;
	try { return JSON.parse(row.json) as AltCover[]; } catch { return null; }
}

export async function findAlternateCovers(
	db: Database.Database,
	q: { title: string; artist: string; album?: string | null },
	o: { fetchImpl?: FetchLike; now?: () => number; sleep?: Sleep } = {}
): Promise<{ alternates: AltCover[]; message: string | null }> {
	const now = o.now ?? Date.now;
	const ctx: Ctx = {
		fetchImpl: o.fetchImpl ?? fetch,
		now,
		sleep: o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
		mbCount: 0,
	};
	const title = cleanTerm(q.title);
	const artist = cleanTerm(q.artist);
	const album = q.album ? cleanTerm(q.album) : '';
	if (!title || !artist) return { alternates: [], message: EMPTY_MESSAGE };

	const key = `alt:${q.artist.toLowerCase()}|${q.title.toLowerCase()}|${(q.album ?? '').toLowerCase()}`;
	const cached = readCache(db, key, now());
	if (cached) return { alternates: cached, message: cached.length ? null : EMPTY_MESSAGE };

	try {
		let groups: Group[] = [];
		if (album) groups = await groupsFromAlbum(ctx, album, artist);
		if (!groups.length) groups = await groupsFromRecording(ctx, title, artist);
		groups = groups.slice(0, MAX_GROUPS);

		const candidates: Candidate[] = [];
		for (const group of groups) {
			const j = await mbGet(ctx, 'release', { 'release-group': group.id, limit: '50' });
			for (const rel of j.releases ?? []) {
				if (rel?.id && rel['cover-art-archive']?.front === true) candidates.push({ rel, group });
			}
		}
		candidates.sort((a, b) => {
			const da = a.rel.date || '9999', db_ = b.rel.date || '9999';
			return da < db_ ? -1 : da > db_ ? 1 : 0;
		});

		const kept: { alt: AltCover; hash: string }[] = [];
		for (const c of candidates.slice(0, MAX_CANDIDATES)) {
			if (kept.length >= MAX_ALTERNATES) break;
			const alt = toAlt(c);
			let hash: string;
			try {
				hash = await averageHash(await fetchCoverBytes(alt.thumbUrl, ctx.fetchImpl));
			} catch {
				continue;
			}
			if (kept.some((k) => hamming(k.hash, hash) <= HAMMING_LIMIT)) continue;
			kept.push({ alt, hash });
		}

		const alternates = kept.map((k) => k.alt);
		if (!alternates.length) return { alternates: [], message: EMPTY_MESSAGE };
		db.prepare('INSERT OR REPLACE INTO cover_alt_cache (key, json, fetched_at) VALUES (?, ?, ?)')
			.run(key, JSON.stringify(alternates), new Date(now()).toISOString());
		return { alternates, message: null };
	} catch (e) {
		if (e instanceof MusicBrainzBusy) return { alternates: [], message: BUSY_MESSAGE };
		throw e;
	}
}
