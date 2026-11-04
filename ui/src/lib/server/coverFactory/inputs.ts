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

export async function listRoundSongs(db: Database.Database, roundId: number): Promise<RoundSong[]> {
	await ensureAlbumArt(db, roundId);
	const rows = db
		.prepare(
			`SELECT s.id, s.title, s.artists, s.album_art_url AS artUrl,
			        c.name AS cname, c.ml_competitor_id AS mlId
			 FROM ml_submissions s LEFT JOIN competitors c ON c.id = s.competitor_id
			 WHERE s.round_id = ? ORDER BY s.spotify_uri`,
		)
		.all(roundId) as { id: number; title: string; artists: string; artUrl: string | null; cname: string | null; mlId: string | null }[];
	const byMl = db.prepare('SELECT id, name FROM players WHERE ml_competitor_id = ? LIMIT 1');
	const byName = db.prepare('SELECT id, name FROM players WHERE name = ? LIMIT 1');
	return rows.map((r) => {
		let p: { id: number; name: string } | undefined;
		if (r.mlId) p = byMl.get(r.mlId) as typeof p;
		if (!p && r.cname) p = byName.get(r.cname) as typeof p;
		const playerName = p?.name ?? r.cname ?? null;
		const playerSlug = p ? (BOARZ_PLAYER_IDS[p.id] ?? slugify(p.name)) : playerName ? slugify(playerName) : null;
		return { submissionId: r.id, title: r.title, artists: r.artists, playerName, playerSlug, artUrl: r.artUrl };
	});
}

export async function resolveSpotifyCover(
	url: string,
): Promise<{ title: string; artists: string; artUrl: string; spotifyUri: string }> {
	const parsed = parseSpotifyUrl(url);
	if (!parsed || parsed.kind !== 'track') throw new Error('not a Spotify track link');
	const t = await fetchTrack(parsed.id);
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
	return roster.members.map((m) => {
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
