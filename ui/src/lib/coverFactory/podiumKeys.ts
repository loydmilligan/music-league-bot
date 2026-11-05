// Podium medal slots and their operator-map keys. Pure, no server/node imports: shared by the
// server (podium.ts writes `_coverNotes` / `_coverProjects`) and the digest client (coverOps.ts reads
// them), so both sides agree on which items are medal slots and how a tied rank is keyed.

/** At most this many medal slots per round (ties included). */
export const MAX_SLOTS = 5;

export interface PodiumItemRef {
	index: number;
	rank: number;
	title: string;
	artist: string;
	coverUrl: string | null;
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

/** Podium items with rank 1–3 (rank|place|position, ties included), top-down, at most MAX_SLOTS. */
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

/** Key for `_coverNotes` / `_coverProjects`: the rank, or the title when that rank is tied among the medal slots. */
export function slotKey(ref: PodiumItemRef, medals: PodiumItemRef[]): string {
	return medals.filter((m) => m.rank === ref.rank).length > 1 ? ref.title : String(ref.rank);
}
