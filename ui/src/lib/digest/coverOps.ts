// Cover Factory operator data on podium content (written by the server's applyCoverKeepers):
// `_coverNotes` / `_coverProjects`, keyed by the medal rank, or by the song title when that rank
// is tied. Client-safe: no server imports. Notes and links are app-only, never in shares/exports.

export interface CoverOp {
	note: string | null;
	projectId: number | null;
}

import { medalItems, slotKey } from '$lib/coverFactory/podiumKeys.js';

type OpsContent = { _coverNotes?: unknown; _coverProjects?: unknown };

const asMap = (v: unknown): Record<string, unknown> =>
	v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/**
 * The operator note + factory project for the podium item at `index` of `content.items`. Keys follow
 * the server exactly (shared podiumKeys: medal items only, ranks 1–3, at most MAX_SLOTS, tie = same
 * rank among those slots → keyed by title). Null for non-medal items or when the content carries
 * neither a note nor a project for the item.
 */
export function coverOpAt(content: unknown, index: number): CoverOp | null {
	const c = (content && typeof content === 'object' ? content : {}) as OpsContent;
	const notes = asMap(c._coverNotes);
	const projects = asMap(c._coverProjects);
	if (!Object.keys(notes).length && !Object.keys(projects).length) return null;
	const medals = medalItems(content);
	const ref = medals.find((m) => m.index === index);
	if (!ref) return null;
	const key = slotKey(ref, medals);
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
