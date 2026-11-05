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
const MAX_ALBUM_GROUPS = 2;
const MAX_ALTERNATES = 12;
const PER_GROUP_CANDIDATES = 10;
const HAMMING_LIMIT = 6;
const HASH_CONCURRENCY = 6;
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
	if (ctx.mbCount >= MB_MAX_REQUESTS) return Promise.reject(new MusicBrainzBusy());
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
	const want = normTitle(album);
	return (j['release-groups'] ?? [])
		.filter((g: any) => Number(g.score) >= 90 && looseMatch(normTitle(g.title ?? ''), want))
		.map((g: any): Group => ({ id: g.id, title: g.title, kind: g['primary-type'] ?? 'Release' }));
}

function normTitle(s: string): string {
	return s
		.toLowerCase()
		.replace(/[\(\[][^)\]]*[\)\]]/g, ' ')
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}
function looseMatch(group: string, album: string): boolean {
	return !!group && !!album && (group === album || group.startsWith(album));
}

async function groupsFromRecording(ctx: Ctx, title: string, artist: string): Promise<Group[]> {
	const j = await mbGet(ctx, 'recording', { query: `recording:"${title}" AND artist:"${artist}" AND status:official`, limit: '25' });
	const tally = new Map<string, { g: Group; n: number; live: boolean; plain: boolean; preferred: boolean }>();
	for (const rec of j.recordings ?? []) {
		for (const rel of rec.releases ?? []) {
			const rg = rel['release-group'];
			if (!rg?.id) continue;
			const kind: string = rg['primary-type'] ?? 'Release';
			const e = tally.get(rg.id) ?? {
				g: { id: rg.id, title: rg.title ?? rel.title ?? '', kind },
				n: 0,
				live: (rg['secondary-types'] ?? []).includes('Live'),
				plain: !(rg['secondary-types'] ?? []).length,
				preferred: ['Album', 'Single', 'EP'].includes(kind),
			};
			e.n++;
			tally.set(rg.id, e);
		}
	}
	const all = [...tally.values()];
	let pool = all.filter((e) => !e.live);
	if (!pool.length) pool = all;
	const rank = (e: { g: Group; preferred: boolean; plain: boolean }) => (e.g.kind === 'Single' || e.g.kind === 'EP' ? 0 : e.preferred && e.plain ? 1 : 2);
	pool.sort((a, b) => rank(a) - rank(b) || b.n - a.n);
	return pool.map((e) => e.g);
}

function byDate(a: Candidate, b: Candidate): number {
	const da = a.rel.date || '9999', db = b.rel.date || '9999';
	return da < db ? -1 : da > db ? 1 : 0;
}

function makeLimiter(max: number) {
	let active = 0;
	const queue: (() => void)[] = [];
	const next = () => { active--; queue.shift()?.(); };
	return <T>(fn: () => Promise<T>): Promise<T> =>
		new Promise<T>((resolve, reject) => {
			const run = () => { active++; fn().then(resolve, reject).finally(next); };
			if (active < max) run(); else queue.push(run);
		});
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
		const albumGroups = album ? await groupsFromAlbum(ctx, album, artist) : [];
		const recGroups = await groupsFromRecording(ctx, title, artist);
		const seen = new Set<string>();
		const groups = [...albumGroups.slice(0, MAX_ALBUM_GROUPS), ...recGroups].filter((g) => !seen.has(g.id) && seen.add(g.id)).slice(0, MAX_GROUPS);

		// Thumbnails are fetched + hashed as soon as each browse returns, overlapping the 1.1 s
		// MusicBrainz spacing; the dedupe below still runs in date order so results are deterministic.
		const limiter = makeLimiter(HASH_CONCURRENCY);
		const hashes = new Map<string, Promise<string | null>>();
		const candidates: Candidate[] = [];
		for (const group of groups) {
			const j = await mbGet(ctx, 'release', { 'release-group': group.id, limit: '50' });
			const mine: Candidate[] = (j.releases ?? [])
				.filter((rel: any) => rel?.id && rel['cover-art-archive']?.front === true)
				.map((rel: any) => ({ rel, group }));
			mine.sort(byDate);
			for (const c of mine.slice(0, PER_GROUP_CANDIDATES)) {
				candidates.push(c);
				const url = toAlt(c).thumbUrl;
				hashes.set(c.rel.id, limiter(async () => {
					try { return await averageHash(await fetchCoverBytes(url, ctx.fetchImpl)); } catch { return null; }
				}));
			}
		}
		candidates.sort(byDate);

		const kept: { alt: AltCover; hash: string }[] = [];
		for (const c of candidates) {
			if (kept.length >= MAX_ALTERNATES) break;
			const hash = await hashes.get(c.rel.id)!;
			if (!hash) continue;
			if (kept.some((k) => hamming(k.hash, hash) <= HAMMING_LIMIT)) continue;
			kept.push({ alt: toAlt(c), hash });
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

/** The list the user was last shown for a project; use-alternate and the pitch `alternate` move validate against it. */
export function storeProjectAlternates(db: Database.Database, projectId: number, alternates: AltCover[], now: number = Date.now()): void {
	db.prepare('INSERT OR REPLACE INTO cover_alt_cache (key, json, fetched_at) VALUES (?, ?, ?)')
		.run(`project:${projectId}`, JSON.stringify(alternates), new Date(now).toISOString());
}

export function readProjectAlternates(db: Database.Database, projectId: number): AltCover[] {
	const row = db.prepare('SELECT json FROM cover_alt_cache WHERE key = ?').get(`project:${projectId}`) as { json: string } | undefined;
	if (!row) return [];
	try {
		const v = JSON.parse(row.json);
		return Array.isArray(v) ? (v as AltCover[]) : [];
	} catch { return []; }
}
