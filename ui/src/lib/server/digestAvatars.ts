import type Database from 'better-sqlite3';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { factoryRoot } from './avatarFactory/paths.js';
import { approvedForTheme, imagesRoot, loadState } from './avatarFactory/store.js';

/**
 * One Avatar Factory set per league's digests: the league's chosen theme (e.g. Boarz → gta)
 * supplies every face in the 2.0 cards/grid and the 1.0 Standings. Faces are cut once into
 * 96px JPEGs under <factory>/digest-faces/<league>/<theme>/<player-slug>.jpg when the set is
 * chosen (or rebuilt), so the digest's synchronous builders only read files. With a set
 * chosen, a player without a face gets initials, never a face from another style.
 */

export const DIGEST_AVATAR_SETS_KEY = 'digest_avatar_sets';
const FACE_PX = 96;

export const slugName = (name: string): string =>
	name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function readSets(db: Database.Database): Record<string, string> {
	try {
		const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(DIGEST_AVATAR_SETS_KEY) as { value?: string } | undefined;
		return row?.value ? (JSON.parse(row.value) as Record<string, string>) : {};
	} catch {
		return {};
	}
}

/** The league's chosen theme slug, or null (digests then use their built-in faces). */
export function getDigestAvatarSet(db: Database.Database, leagueSlug: string): string | null {
	return readSets(db)[leagueSlug] || null;
}

export function getDigestAvatarSets(db: Database.Database): Record<string, string> {
	return readSets(db);
}

export function setDigestAvatarSet(db: Database.Database, leagueSlug: string, themeSlug: string | null): void {
	const sets = readSets(db);
	if (themeSlug) sets[leagueSlug] = themeSlug;
	else delete sets[leagueSlug];
	db.prepare(
		`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
	).run(DIGEST_AVATAR_SETS_KEY, JSON.stringify(sets));
}

export function facesDir(leagueSlug: string, themeSlug: string, root = factoryRoot()): string {
	return join(root, 'digest-faces', leagueSlug, themeSlug);
}

/**
 * Face boxes, keyed by the candidate's relPath: [centreX, centreY, side] as fractions of the
 * image width/height (side is a fraction of the width). Hand-set per image because the
 * styles frame people very differently (a GTA figure's face is a tenth of the frame).
 */
export type FaceBox = [number, number, number];
const DEFAULT_BOX: FaceBox = [0.5, 0.3, 0.5];

function readCrops(root: string): Record<string, FaceBox> {
	const p = join(root, 'digest-face-crops.json');
	try {
		return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as Record<string, FaceBox>) : {};
	} catch {
		return {};
	}
}

/** Square crop in pixels, clamped inside the image. */
export function cropRect(box: FaceBox, width: number, height: number) {
	const side = Math.max(1, Math.min(Math.round(box[2] * width), width, height));
	const left = Math.min(Math.max(0, Math.round(box[0] * width - side / 2)), width - side);
	const top = Math.min(Math.max(0, Math.round(box[1] * height - side / 2)), height - side);
	return { left, top, width: side, height: side };
}

export interface BuildFacesResult {
	written: string[];
	missing: string[]; // roster names with no approved image in this theme
}

/** Cut the 96px digest faces for one league's set from the factory's approved images. */
export async function buildDigestFaces(
	db: Database.Database,
	leagueSlug: string,
	themeSlug: string,
	root = factoryRoot()
): Promise<BuildFacesResult> {
	const league = loadState(root).leagues[leagueSlug];
	if (!league) throw new Error(`no Avatar Factory roster for ${leagueSlug}`);
	const crops = readCrops(root);
	const nameOf = db.prepare('SELECT name FROM players WHERE id = ?');
	const dir = facesDir(leagueSlug, themeSlug, root);
	mkdirSync(dir, { recursive: true });
	const out: BuildFacesResult = { written: [], missing: [] };
	for (const m of league.members) {
		// Faces are keyed by players.name, the name every digest section displays.
		const name = (m.playerId != null ? (nameOf.get(m.playerId) as { name: string } | undefined)?.name : null) ?? m.name;
		const cand = approvedForTheme(m, themeSlug);
		const src = cand ? join(imagesRoot(root), cand.relPath) : null;
		if (!cand || !src || !existsSync(src)) {
			out.missing.push(name);
			continue;
		}
		const img = sharp(src);
		const { width = 0, height = 0 } = await img.metadata();
		const buf = await img
			.extract(cropRect(crops[cand.relPath] ?? DEFAULT_BOX, width, height))
			.resize(FACE_PX, FACE_PX)
			.jpeg({ quality: 85 })
			.toBuffer();
		writeFileSync(join(dir, `${slugName(name)}.jpg`), buf);
		out.written.push(name);
	}
	return out;
}

/**
 * Face lookup for one league's digest: null when no set is chosen (caller uses its own
 * faces); otherwise name → data URI, or null for initials.
 */
export function digestFaceLookup(
	db: Database.Database,
	leagueSlug: string,
	root = factoryRoot()
): ((playerName: string) => string | null) | null {
	const theme = getDigestAvatarSet(db, leagueSlug);
	if (!theme) return null;
	const dir = facesDir(leagueSlug, theme, root);
	const cache = new Map<string, string | null>();
	return (playerName) => {
		const slug = slugName(playerName);
		if (!cache.has(slug)) {
			const p = join(dir, `${slug}.jpg`);
			cache.set(slug, existsSync(p) ? `data:image/jpeg;base64,${readFileSync(p).toString('base64')}` : null);
		}
		return cache.get(slug) ?? null;
	};
}

export interface DigestAvatarOption {
	leagueSlug: string;
	leagueName: string;
	current: string | null;
	built: number; // faces on disk for the current set
	members: number;
	themes: { slug: string; name: string; approved: number }[];
}

/** Settings panel data: every factory league, its themes by approved count, and its set. */
export function listDigestAvatarOptions(db: Database.Database, root = factoryRoot()): DigestAvatarOption[] {
	const state = loadState(root);
	const sets = readSets(db);
	return Object.values(state.leagues).map((league) => {
		const current = sets[league.slug] || null;
		const dir = current ? facesDir(league.slug, current, root) : null;
		const themes = state.themes
			.map((t) => ({ slug: t.slug, name: t.name, approved: league.members.filter((m) => approvedForTheme(m, t.slug)).length }))
			.filter((t) => t.approved > 0)
			.sort((a, b) => b.approved - a.approved);
		return {
			leagueSlug: league.slug,
			leagueName: league.name,
			current,
			built: dir && existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.jpg')).length : 0,
			members: league.members.length,
			themes,
		};
	});
}
