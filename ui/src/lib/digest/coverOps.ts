// Cover Factory operator data on podium content (written by the server's applyCoverKeepers):
// `_coverNotes` / `_coverProjects`, keyed by the medal rank, or by the song title when that rank
// is tied. Client-safe: no server imports. Notes and links are app-only, never in shares/exports.

export interface CoverOp {
	note: string | null;
	projectId: number | null;
}

type OpsContent = { _coverNotes?: unknown; _coverProjects?: unknown };

const asMap = (v: unknown): Record<string, unknown> =>
	v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** Same rank rule as the server's podium.ts (rank | place | position, else list position). */
function slotRank(item: unknown, idx: number): number {
	const it = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
	for (const k of ['rank', 'place', 'position']) {
		const v = it[k];
		const n = typeof v === 'number' ? v : typeof v === 'string' ? parseInt(v, 10) : NaN;
		if (Number.isFinite(n)) return n;
	}
	return idx + 1;
}

/**
 * The operator note + factory project for the podium item at `index` of `content.items`. Keys follow
 * the server: the item's rank, or its title when another item shares that rank. Null when the
 * content carries neither for the item.
 */
export function coverOpAt(content: unknown, index: number): CoverOp | null {
	const c = (content && typeof content === 'object' ? content : {}) as OpsContent & { items?: unknown };
	if (!Array.isArray(c.items) || !c.items[index]) return null;
	const notes = asMap(c._coverNotes);
	const projects = asMap(c._coverProjects);
	if (!Object.keys(notes).length && !Object.keys(projects).length) return null;
	const ranks = c.items.map(slotRank);
	const rank = ranks[index];
	const tied = ranks.filter((r) => r === rank).length > 1;
	const title = (c.items[index] as { title?: unknown }).title;
	const key = tied ? (typeof title === 'string' ? title : '') : String(rank);
	const note = notes[key];
	const project = projects[key];
	const op: CoverOp = {
		note: typeof note === 'string' && note.trim() ? note : null,
		projectId: typeof project === 'number' && Number.isInteger(project) && project > 0 ? project : null,
	};
	return op.note || op.projectId ? op : null;
}

/** Content without the operator keys (identity when it has none) — for share renders. */
export function stripCoverOps<T>(content: T): T {
	if (!content || typeof content !== 'object' || Array.isArray(content)) return content;
	const c = content as Record<string, unknown>;
	if (!('_coverNotes' in c) && !('_coverProjects' in c)) return content;
	const { _coverNotes: _n, _coverProjects: _p, ...rest } = c;
	void _n;
	void _p;
	return rest as T;
}
