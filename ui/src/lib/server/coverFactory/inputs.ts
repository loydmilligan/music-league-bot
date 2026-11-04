import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type Database from 'better-sqlite3';
import sharp from 'sharp';
import { ensureAlbumArt } from '$lib/digest/albumArt.js';
import { fetchTrack, parseSpotifyUrl } from '$lib/spotify/client.js';
import { BOARZ_PLAYER_IDS } from '../avatarFactory/notes.js';
import { HIP_JAMMERS_PLAYERS_SUB, SECOND_BEST_PLAYERS_SUB } from '../avatarFactory/notes.js';
import { slugify } from '../avatarFactory/filenames.js';
import { normalizeImage } from '../avatarFactory/normalize.js';
import type { FetchLike } from '../avatarFactory/openrouter.js';
import { sourcesRoot } from '../avatarFactory/paths.js';
import { readRoster } from '../avatarFactory/roster.js';
import { coverFile } from './paths.js';

/** league slug -> folder under sourcesRoot() (mirrors avatarFactory/seed.ts). */
const LEAGUE_FOLDERS: Record<string, string> = {
	'boarz-ii-men': 'boarz-players',
	'second-best': SECOND_BEST_PLAYERS_SUB,
	'hip-jammers': HIP_JAMMERS_PLAYERS_SUB,
};

const OEMBED_CONCURRENCY = 4;
const MAX_COVER_BYTES = 10 * 1024 * 1024;
const HEADSHOT_NAMES = ['headshot.png', 'headshot.jpg', 'headshot.jpeg'] as const;

export interface RoundSong {
	submissionId: number;
	title: string;
	artists: string;
	playerName: string | null;
	playerSlug: string | null;
	artUrl: string | null;
}

/** Spotify oEmbed needs no API credentials, so it still works when the Web API refuses (403). */
async function oembedCover(trackId: string, fetchImpl: FetchLike): Promise<{ title: string; artUrl: string } | null> {
	try {
		const page = `https://open.spotify.com/track/${encodeURIComponent(trackId)}`;
		const res = await fetchImpl(`https://open.spotify.com/oembed?url=${encodeURIComponent(page)}`);
		if (!res.ok) return null;
		const j = (await res.json()) as { title?: string; thumbnail_url?: string };
		if (!j.thumbnail_url || !/^https:\/\//.test(j.thumbnail_url)) return null;
		// oEmbed returns the 300 px rendition; the same image hash with the b273 size code is 640 px.
		return { title: j.title ?? '', artUrl: j.thumbnail_url.replace('ab67616d00001e02', 'ab67616d0000b273') };
	} catch {
		return null;
	}
}

/** Fill missing album art via oEmbed and cache it on ml_submissions (the column ensureAlbumArt fills). */
async function fillArtFromOembed(db: Database.Database, roundId: number, fetchImpl: FetchLike): Promise<void> {
	const rows = db
		.prepare(
			`SELECT id, spotify_uri FROM ml_submissions
			 WHERE round_id = ? AND album_art_url IS NULL AND spotify_uri LIKE 'spotify:track:%'`,
		)
		.all(roundId) as { id: number; spotify_uri: string }[];
	// Simple worker pool: at most OEMBED_CONCURRENCY requests in flight.
	const found: ({ title: string; artUrl: string } | null)[] = new Array(rows.length).fill(null);
	let next = 0;
	const worker = async () => {
		while (next < rows.length) {
			const i = next++;
			found[i] = await oembedCover(rows[i].spotify_uri.split(':').pop()!, fetchImpl);
		}
	};
	await Promise.all(Array.from({ length: Math.min(OEMBED_CONCURRENCY, rows.length) }, worker));
	const upd = db.prepare('UPDATE ml_submissions SET album_art_url = ? WHERE id = ?');
	rows.forEach((r, i) => {
		if (found[i]) upd.run(found[i]!.artUrl, r.id);
	});
}

type PlayerLookup = { get(arg: string): unknown };

/** Shared submitter rule: players row by ml_competitor_id, then by name; slug = BOARZ id map or slugify. */
function resolveSubmitter(
	byMl: PlayerLookup,
	byName: PlayerLookup,
	mlId: string | null,
	cname: string | null,
	byId?: PlayerLookup,
	playerId?: number | null,
): { playerName: string | null; playerSlug: string | null } {
	let p: { id: number; name: string } | undefined;
	// ml_submissions.player_id is the authoritative link; the ML display name
	// (e.g. "queen0reno") often matches no players.name.
	if (byId && playerId != null) p = byId.get(playerId) as typeof p;
	if (!p && mlId) p = byMl.get(mlId) as typeof p;
	if (!p && cname) p = byName.get(cname) as typeof p;
	const playerName = p?.name ?? cname ?? null;
	const playerSlug = p ? (BOARZ_PLAYER_IDS[p.id] ?? slugify(p.name)) : playerName ? slugify(playerName) : null;
	return { playerName, playerSlug };
}

/** Older/fixture schemas lack ml_submissions.player_id; select it only when present. */
function playerIdExpr(db: Database.Database): string {
	const cols = db.prepare('PRAGMA table_info(ml_submissions)').all() as { name: string }[];
	return cols.some((c) => c.name === 'player_id') ? 's.player_id' : 'NULL';
}

/** One direct query for a submission's submitter: no album-art fill, no network. */
export function submitterOfSubmission(db: Database.Database, submissionId: number): { slug: string; name: string } | undefined {
	const r = db
		.prepare(
			`SELECT c.name AS cname, c.ml_competitor_id AS mlId, ${playerIdExpr(db)} AS playerId
			 FROM ml_submissions s LEFT JOIN competitors c ON c.id = s.competitor_id WHERE s.id = ?`,
		)
		.get(submissionId) as { cname: string | null; mlId: string | null; playerId: number | null } | undefined;
	if (!r) return undefined;
	const byMl = db.prepare('SELECT id, name FROM players WHERE ml_competitor_id = ? LIMIT 1');
	const byName = db.prepare('SELECT id, name FROM players WHERE name = ? LIMIT 1');
	const byId = db.prepare('SELECT id, name FROM players WHERE id = ? LIMIT 1');
	const { playerName, playerSlug } = resolveSubmitter(byMl, byName, r.mlId, r.cname, byId, r.playerId);
	return playerSlug && playerName ? { slug: playerSlug, name: playerName } : undefined;
}

export async function listRoundSongs(db: Database.Database, roundId: number, fetchImpl: FetchLike = fetch): Promise<RoundSong[]> {
	try {
		await ensureAlbumArt(db, roundId);
	} catch {
		// Best-effort, as ensureAlbumArt documents: e.g. Spotify Web API 403. Songs must still list.
		await fillArtFromOembed(db, roundId, fetchImpl);
	}
	const rows = db
		.prepare(
			`SELECT s.id, s.title, s.artists, s.album_art_url AS artUrl,
			        c.name AS cname, c.ml_competitor_id AS mlId, ${playerIdExpr(db)} AS playerId
			 FROM ml_submissions s LEFT JOIN competitors c ON c.id = s.competitor_id
			 WHERE s.round_id = ? ORDER BY s.spotify_uri`,
		)
		.all(roundId) as { id: number; title: string; artists: string; artUrl: string | null; cname: string | null; mlId: string | null; playerId: number | null }[];
	const byId = db.prepare('SELECT id, name FROM players WHERE id = ? LIMIT 1');
	const byMl = db.prepare('SELECT id, name FROM players WHERE ml_competitor_id = ? LIMIT 1');
	const byName = db.prepare('SELECT id, name FROM players WHERE name = ? LIMIT 1');
	return rows.map((r) => {
		const { playerName, playerSlug } = resolveSubmitter(byMl, byName, r.mlId, r.cname, byId, r.playerId);
		return { submissionId: r.id, title: r.title, artists: r.artists, playerName, playerSlug, artUrl: r.artUrl };
	});
}

export async function resolveSpotifyCover(
	url: string,
	fetchImpl: FetchLike = fetch,
): Promise<{ title: string; artists: string; artUrl: string; spotifyUri: string }> {
	const parsed = parseSpotifyUrl(url);
	if (!parsed || parsed.kind !== 'track') throw new Error('not a Spotify track link');
	let t;
	try {
		t = await fetchTrack(parsed.id);
	} catch (e) {
		const o = await oembedCover(parsed.id, fetchImpl);
		if (!o) throw e;
		return { title: o.title, artists: '', artUrl: o.artUrl, spotifyUri: `spotify:track:${parsed.id}` };
	}
	if (!t.albumArtUrl) throw new Error('Spotify track has no album art');
	return { title: t.title, artists: t.artist, artUrl: t.albumArtUrl, spotifyUri: t.uri };
}

export async function fetchCoverBytes(artUrl: string, fetchImpl: FetchLike = fetch): Promise<Buffer> {
	let url = artUrl;
	let res: Response | null = null;
	for (let hop = 0; hop <= 3; hop++) {
		if (!/^https:\/\//i.test(url)) throw new Error('cover URL must be https');
		res = await fetchImpl(url, { redirect: 'manual' });
		if (res.status >= 300 && res.status < 400) {
			const loc = res.headers.get('location');
			if (!loc) throw new Error('cover redirect without location');
			if (hop === 3) throw new Error('too many cover redirects');
			url = new URL(loc, url).toString();
			continue;
		}
		break;
	}
	if (!res || !res.ok) throw new Error(`cover fetch failed: ${res?.status}`);
	const type = res.headers.get('content-type') ?? '';
	if (!type.toLowerCase().startsWith('image/')) throw new Error('cover URL is not an image');
	if (Number(res.headers.get('content-length') ?? 0) > MAX_COVER_BYTES) throw new Error('cover image too large (>10 MB)');
	if (!res.body) throw new Error('cover response has no body');
	const reader = res.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > MAX_COVER_BYTES) {
			await reader.cancel().catch(() => {});
			throw new Error('cover image too large (>10 MB)');
		}
		chunks.push(value);
	}
	return Buffer.concat(chunks);
}

export interface PlayerOption {
	slug: string;
	name: string;
	leagueSlug: string;
	headshotRel: string | null;
	lowRes: boolean;
	missing: boolean;
}

function findHeadshotRel(folder: string, slug: string): string | null {
	for (const n of HEADSHOT_NAMES) {
		if (existsSync(join(sourcesRoot(), folder, slug, n))) return `${folder}/${slug}/${n}`;
	}
	return null;
}

function minEdge(abs: string): number {
	try {
		// Synchronous header read via sharp is async-only; parse dims from file bytes instead.
		const b = readFileSync(abs);
		if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return Math.min(b.readUInt32BE(16), b.readUInt32BE(20));
		if (b[0] === 0xff && b[1] === 0xd8) {
			let i = 2;
			while (i + 9 < b.length) {
				if (b[i] !== 0xff) { i++; continue; }
				const m = b[i + 1];
				if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
					return Math.min(b.readUInt16BE(i + 5), b.readUInt16BE(i + 7));
				}
				i += 2 + b.readUInt16BE(i + 2);
			}
		}
	} catch { /* fall through */ }
	return Infinity;
}

function latestUploadRel(projectId: number, slug: string): string | null {
	const dir = coverFile(`uploads/${projectId}`);
	if (!existsSync(dir)) return null;
	const hits = readdirSync(dir).filter((f) => f.startsWith(`${slug}.`)).sort();
	return hits.length ? `uploads/${projectId}/${hits[hits.length - 1]}` : null;
}

export function listPlayers(leagueSlug: string, projectId?: number): PlayerOption[] {
	const roster = readRoster(leagueSlug);
	const folder = LEAGUE_FOLDERS[leagueSlug];
	if (!roster || !folder) return [];
	const seen = new Set<string>();
	// Dedupe by slug (keep first) so Svelte {#each} keys cannot collide.
	const members = roster.members.filter((m) => (seen.has(m.slug) ? false : (seen.add(m.slug), true)));
	return members.map((m) => {
		const up = projectId !== undefined ? latestUploadRel(projectId, m.slug) : null;
		if (up) {
			return { slug: m.slug, name: m.name, leagueSlug, headshotRel: up, lowRes: minEdge(coverFile(up)) < 256, missing: false };
		}
		const headshotRel = findHeadshotRel(folder, m.slug);
		const lowRes = headshotRel ? minEdge(join(sourcesRoot(), headshotRel)) < 256 : false;
		return { slug: m.slug, name: m.name, leagueSlug, headshotRel, lowRes, missing: !headshotRel };
	});
}

export async function loadHeadshot(projectId: number, p: PlayerOption): Promise<Buffer | null> {
	const upDir = coverFile(`uploads/${projectId}`);
	if (existsSync(upDir)) {
		const hits = readdirSync(upDir)
			.filter((f) => f.startsWith(`${p.slug}.`))
			.sort();
		if (hits.length) return readFileSync(join(upDir, hits[hits.length - 1]));
	}
	if (!p.headshotRel) return null;
	return readFileSync(join(sourcesRoot(), p.headshotRel));
}

function writeNew(rel: string, bytes: Buffer): void {
	const abs = coverFile(rel);
	if (existsSync(abs)) throw new Error('refusing to overwrite existing file');
	mkdirSync(dirname(abs), { recursive: true });
	writeFileSync(abs, bytes);
}

/** Never overwrites: each upload gets a timestamped name; loadHeadshot picks the newest. */
export async function saveHeadshotUpload(projectId: number, slug: string, bytes: Buffer): Promise<string> {
	if (!/^[a-z0-9-]+$/.test(slug)) throw new Error('invalid player slug');
	const n = await normalizeImage(bytes, `${slug}.jpg`);
	const out = Buffer.from(n.dataUrl.split(',')[1], 'base64');
	const rel = `uploads/${projectId}/${slug}.${Date.now()}.jpg`;
	writeNew(rel, out);
	return rel;
}

export async function saveCoverUpload(bytes: Buffer): Promise<string> {
	const n = await normalizeImage(bytes, 'cover.jpg');
	const out = Buffer.from(n.dataUrl.split(',')[1], 'base64');
	const rel = `covers/${randomBytes(12).toString('hex')}.jpg`;
	writeNew(rel, out);
	return rel;
}
