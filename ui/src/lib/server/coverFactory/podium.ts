import type Database from 'better-sqlite3';
import { getActiveDraftForRound, normTitle } from '$lib/digest/llm.js';
import { shareKeeper } from './share.js';

type DB = Database.Database;

/** settings key: JSON `{ [leagueSlug]: boolean }` — which leagues get the round-end auto run. */
export const AUTO_LEAGUES_KEY = 'cover_factory_auto_leagues';
const DEFAULT_AUTO_LEAGUES: Record<string, boolean> = { 'boarz-ii-men': true, 'second-best': true, 'hip-jammers': true };
const MAX_SLOTS = 5;

export interface PodiumSlot {
	id: number;
	round_id: number;
	rank: number;
	title: string;
	submission_id: number | null;
	project_id: number | null;
	status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
	note: string | null;
	public_url: string | null;
	gif_rel: string | null;
	updated_at: string;
}

export interface PodiumItemRef {
	index: number;
	rank: number;
	title: string;
	artist: string;
	coverUrl: string | null;
}

export function autoLeagues(db: DB): Record<string, boolean> {
	const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(AUTO_LEAGUES_KEY) as { value?: string } | undefined;
	if (!row?.value) return { ...DEFAULT_AUTO_LEAGUES };
	try {
		const parsed = JSON.parse(row.value) as unknown;
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ...DEFAULT_AUTO_LEAGUES };
		const out: Record<string, boolean> = {};
		for (const [k, v] of Object.entries(parsed)) out[k] = v === true;
		return out;
	} catch {
		return { ...DEFAULT_AUTO_LEAGUES };
	}
}

export function setAutoLeague(db: DB, slug: string, on: boolean): void {
	const next = { ...autoLeagues(db), [slug]: on };
	db.prepare(
		`INSERT INTO settings (key, value) VALUES (?, ?)
		 ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
	).run(AUTO_LEAGUES_KEY, JSON.stringify(next));
}

export function isAutoLeague(db: DB, roundId: number): boolean {
	const row = db
		.prepare(
			`SELECT l.slug AS slug FROM rounds r
			 JOIN seasons s ON s.id = r.season_id
			 JOIN leagues l ON l.id = s.league_id
			 WHERE r.id = ?`,
		)
		.get(roundId) as { slug?: string } | undefined;
	return !!row?.slug && autoLeagues(db)[row.slug] === true;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

function rankOf(item: Record<string, unknown>, idx: number): number {
	for (const k of ['rank', 'place', 'position']) {
		const v = item[k];
		const n = typeof v === 'number' ? v : typeof v === 'string' ? parseInt(v, 10) : NaN;
		if (Number.isFinite(n)) return n;
	}
	return idx + 1; // same fallback AlbumPodium uses
}

function coverOf(item: Record<string, unknown>): string | null {
	for (const k of ['coverUrl', 'albumArtUrl', 'album_art_url']) {
		if (typeof item[k] === 'string' && item[k]) return item[k] as string;
	}
	return null;
}

/** Podium items with rank 1–3 (rank|place|position, ties included), top-down, at most 5. */
export function medalItems(content: unknown): PodiumItemRef[] {
	const items = content && typeof content === 'object' ? (content as { items?: unknown }).items : undefined;
	if (!Array.isArray(items)) return [];
	const refs: PodiumItemRef[] = [];
	items.forEach((it, index) => {
		if (!it || typeof it !== 'object') return;
		const item = it as Record<string, unknown>;
		const rank = rankOf(item, index);
		if (rank < 1 || rank > 3) return;
		refs.push({ index, rank, title: str(item.title), artist: str(item.artist), coverUrl: coverOf(item) });
	});
	return refs.sort((a, b) => a.rank - b.rank || a.index - b.index).slice(0, MAX_SLOTS);
}

/** Round submission for a podium item, by enrichPodiumArt's normalized title; artist breaks title ties. */
export function matchSubmission(db: DB, roundId: number, ref: PodiumItemRef): number | null {
	const key = normTitle(ref.title);
	if (!key) return null;
	const rows = (db.prepare('SELECT id, title, artists FROM ml_submissions WHERE round_id = ? ORDER BY id').all(roundId) as
		{ id: number; title: string; artists: string }[]).filter((r) => normTitle(r.title) === key);
	if (rows.length === 0) return null;
	const artist = normTitle(ref.artist);
	const byArtist = artist ? rows.find((r) => normTitle(r.artists).includes(artist)) : undefined;
	return (byArtist ?? rows[0]).id;
}

/** URLs this system wrote: the private factory media route and shared `/_media/covers/` files. */
function isFactoryUrl(url: string): boolean {
	return url.startsWith('/api/cover-factory/media/') || /\/_media\/covers\//.test(url);
}

function isSpotifyCdn(url: string): boolean {
	try {
		return new URL(url).hostname === 'i.scdn.co';
	} catch {
		return false;
	}
}

/** A cover someone placed by hand: neither Spotify CDN art nor a cover-factory URL. Never overwritten. */
export function isHandMade(url: string | null, roundId: number): boolean {
	void roundId;
	if (!url) return false;
	return !isSpotifyCdn(url) && !isFactoryUrl(url);
}

export function listSlots(db: DB, roundId: number): PodiumSlot[] {
	return db.prepare('SELECT * FROM cover_podium_slots WHERE round_id = ? ORDER BY rank, id').all(roundId) as PodiumSlot[];
}

/** Draft URL for a done slot: public share once promoted, else the pre-rendered private GIF, else the keeper export. */
function slotCoverUrl(db: DB, slot: PodiumSlot): string | null {
	if (slot.public_url) return slot.public_url;
	if (slot.gif_rel) return `/api/cover-factory/media/${slot.gif_rel}`;
	if (slot.project_id == null) return null;
	const p = db.prepare('SELECT keeper_version_id FROM cover_projects WHERE id = ?').get(slot.project_id) as
		{ keeper_version_id: number | null } | undefined;
	return p?.keeper_version_id != null ? `/api/cover-factory/media/export/${p.keeper_version_id}.gif` : null;
}

/**
 * Key for `_coverNotes` / `_coverProjects`: the rank, or the item title when that rank is tied.
 */
function slotKey(ref: PodiumItemRef, medals: PodiumItemRef[]): string {
	return medals.filter((m) => m.rank === ref.rank).length > 1 ? ref.title : String(ref.rank);
}

/**
 * Re-apply slot keepers to podium content. Returns `content` itself when the round has no slots
 * (or the content has no items); otherwise a copy with done-slot coverUrls set (hand-made covers
 * kept) and `_coverNotes` / `_coverProjects` rebuilt from the slots.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyCoverKeepers(db: DB, roundId: number, content: any): any {
	if (!content || typeof content !== 'object' || !Array.isArray(content.items)) return content;
	const slots = listSlots(db, roundId);
	if (slots.length === 0) return content;

	const out = structuredClone(content);
	const medals = medalItems(out);
	const notes: Record<string, string> = {};
	const projects: Record<string, number> = {};
	for (const ref of medals) {
		const slot = slots.find((s) => s.rank === ref.rank && normTitle(s.title) === normTitle(ref.title));
		if (!slot) continue;
		const key = slotKey(ref, medals);
		if (slot.note) notes[key] = slot.note;
		if (slot.project_id != null) projects[key] = slot.project_id;
		if (slot.status !== 'done' || isHandMade(ref.coverUrl, roundId)) continue;
		const url = slotCoverUrl(db, slot);
		if (url) out.items[ref.index].coverUrl = url;
	}
	// For a round with slots these keys are owned by the slots: rebuilt from them on every apply,
	// so a stale note/project link disappears once its slot no longer carries one.
	if (Object.keys(notes).length) out._coverNotes = notes;
	else delete out._coverNotes;
	if (Object.keys(projects).length) out._coverProjects = projects;
	else delete out._coverProjects;
	return out;
}

/**
 * Re-apply keepers to the round's podium (the given draft, else the active one) and persist when it
 * changed. No slot rows for the round → returns false without reading or writing the draft.
 * Never throws: it runs on hot digest paths after a paid draft/regen is already saved, so any
 * failure is logged and reported as "unchanged".
 */
export function writePodiumCover(db: DB, roundId: number, draftId?: string): boolean {
	try {
		return writePodiumCoverUnsafe(db, roundId, draftId);
	} catch (e) {
		console.error(`[cover-factory] writePodiumCover(round ${roundId}) failed:`, (e as Error).message);
		return false;
	}
}

function writePodiumCoverUnsafe(db: DB, roundId: number, draftId?: string): boolean {
	if (!db.prepare('SELECT 1 FROM cover_podium_slots WHERE round_id = ? LIMIT 1').get(roundId)) return false;
	const id = draftId ?? getActiveDraftForRound(db, roundId)?.id;
	if (!id) return false;
	const row = db.prepare(`SELECT id, content_json FROM digest_sections WHERE draft_id = ? AND kind = 'podium'`).get(id) as
		{ id: string; content_json: string } | undefined;
	if (!row) return false;
	let content: unknown;
	try {
		content = JSON.parse(row.content_json);
	} catch {
		return false;
	}
	const before = JSON.stringify(content);
	const after = JSON.stringify(applyCoverKeepers(db, roundId, content));
	if (after === before) return false;
	db.prepare('UPDATE digest_sections SET content_json = ? WHERE id = ?').run(after, row.id);
	return true;
}

/**
 * Make the round's auto covers public before an export/share: every done slot's project keeper is
 * shared (`shareKeeper` reuses its dir while the keeper is unchanged), the slot's `public_url` is
 * stored and the podium is re-applied so `coverUrl` is the digest-host GIF instead of the private
 * app route. Returns how many slots got a new `public_url`.
 * No slot rows for the round → returns 0 without writing anything (OFF leagues are untouched).
 * A slot that cannot be shared does not stop the others; after the rest are written it throws one
 * error naming every failed slot, so callers can surface it as a warning.
 */
export async function promotePodiumCovers(db: DB, roundId: number, digestsRoot?: string): Promise<number> {
	const slots = listSlots(db, roundId).filter((s) => s.status === 'done' && s.project_id != null);
	if (slots.length === 0) return 0;
	let promoted = 0;
	const errors: string[] = [];
	for (const slot of slots) {
		try {
			const { gifUrl } = await shareKeeper(db, slot.project_id as number, digestsRoot);
			if (slot.public_url !== gifUrl) {
				db.prepare('UPDATE cover_podium_slots SET public_url = ?, updated_at = ? WHERE id = ?').run(gifUrl, new Date().toISOString(), slot.id);
				promoted++;
			}
		} catch (e) {
			errors.push(`rank ${slot.rank} "${slot.title}": ${e instanceof Error ? e.message : String(e)}`);
		}
	}
	writePodiumCover(db, roundId);
	if (errors.length) throw new Error(`podium cover promotion failed for ${errors.join('; ')}`);
	return promoted;
}
