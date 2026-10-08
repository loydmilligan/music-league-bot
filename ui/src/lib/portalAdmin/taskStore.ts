// Portal admin — season planner task store (spec §7.1). Upsert-by-key with the
// preservation rules from §7.2: derived rows re-derive their due_at, but done /
// skipped / custom rows are never overwritten, and custom rows survive merges.
import type Database from 'better-sqlite3';
import type { Round, Season } from '../types.js';
import { deriveTasks, type DerivedTask } from './plan.js';

export type TaskStatus = 'open' | 'done' | 'skipped';
export type TaskSource = 'derived' | 'custom';

export interface PlannerTask {
	id: number;
	leagueId: number;
	seasonNumber: number;
	key: string;
	roundNumber: number | null;
	title: string;
	detail: string | null;
	dueAt: string | null;
	kind: 'content' | 'ops' | 'review';
	source: TaskSource;
	status: TaskStatus;
	completedAt: string | null;
	notes: string | null;
}

interface Row {
	id: number; league_id: number; season_number: number; key: string;
	round_number: number | null; title: string; detail: string | null; due_at: string | null;
	kind: 'content' | 'ops' | 'review'; source: TaskSource; status: TaskStatus;
	completed_at: string | null; notes: string | null;
}

const rowColumns = 'id, league_id, season_number, key, round_number, title, detail, due_at, kind, source, status, completed_at, notes';

function toPlannerTask(r: Row): PlannerTask {
	return {
		id: r.id, leagueId: r.league_id, seasonNumber: r.season_number, key: r.key,
		roundNumber: r.round_number, title: r.title, detail: r.detail, dueAt: r.due_at,
		kind: r.kind, source: r.source, status: r.status, completedAt: r.completed_at, notes: r.notes,
	};
}

export function listTasks(db: Database.Database, leagueId: number, seasonNumber: number): PlannerTask[] {
	const rows = db
		.prepare(`SELECT ${rowColumns} FROM portal_admin_tasks WHERE league_id = ? AND season_number = ? ORDER BY COALESCE(due_at,'' ) , id`)
		.all(leagueId, seasonNumber) as Row[];
	return rows.map(toPlannerTask);
}

export function getTask(db: Database.Database, leagueId: number, id: number): PlannerTask | null {
	const r = db
		.prepare(`SELECT ${rowColumns} FROM portal_admin_tasks WHERE league_id = ? AND id = ?`)
		.get(leagueId, id) as Row | undefined;
	return r ? toPlannerTask(r) : null;
}

/**
 * Re-derive every `DerivedTask`, merging into the stored rows by `key`:
 * open derived rows take the new due_at/title in place; rows that are done,
 * skipped, or custom are left exactly as they are, and a row whose key is gone
 * from the derivation (never happens for derived rows, but defensively) is
 * removed only if it is still `open` + `derived`.
 */
export function mergeDerived(
	db: Database.Database,
	leagueId: number,
	seasonNumber: number,
	derived: DerivedTask[]
): { inserted: number; updated: number; untouched: number } {
	const tx = db.transaction(() => {
		let inserted = 0;
		let updated = 0;
		let untouched = 0;
		const existing = listTasks(db, leagueId, seasonNumber);
		const byKey = new Map(existing.map((t) => [t.key, t]));

		for (const d of derived) {
			const cur = byKey.get(d.key);
			if (!cur) {
				db.prepare(`INSERT INTO portal_admin_tasks
					(league_id, season_number, key, round_number, title, detail, due_at, kind, source, status)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'derived', 'open')`)
					.run(leagueId, seasonNumber, d.key, d.roundNumber, d.title, d.detail, d.dueAt, d.kind);
				inserted++;
				continue;
			}
			if (cur.status === 'open' && cur.source === 'derived') {
				db.prepare('UPDATE portal_admin_tasks SET due_at = ?, title = ?, round_number = ?, detail = ? WHERE id = ?')
					.run(d.dueAt, d.title, d.roundNumber, d.detail, cur.id);
				updated++;
			} else {
				untouched++;
			}
		}

		// Garbage-collect derived rows whose key is no longer produced (e.g. an
		// anchor round vanished). Never GC a done/skipped/custom row.
		for (const row of existing) {
			if (row.source !== 'derived' || row.status !== 'open') continue;
			if (!derived.some((d) => d.key === row.key)) {
				db.prepare('DELETE FROM portal_admin_tasks WHERE id = ?').run(row.id);
			}
		}
		return { inserted, updated, untouched };
	});
	return tx();
}

export function deriveSeason(
	db: Database.Database,
	season: Season,
	rounds: Round[]
): { inserted: number; updated: number; untouched: number } {
	return mergeDerived(db, season.leagueId, season.seasonNumber, deriveTasks(season, rounds));
}

export function createTask(
	db: Database.Database,
	leagueId: number,
	seasonNumber: number,
	task: {
		key?: string;
		roundNumber?: number | null;
		title: string;
		detail?: string | null;
		dueAt?: string | null;
		kind: 'content' | 'ops' | 'review';
		notes?: string | null;
	}
): PlannerTask {
	const key = task.key ?? `custom.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 8)}`;
	const info = db.prepare(`INSERT INTO portal_admin_tasks
		(league_id, season_number, key, round_number, title, detail, due_at, kind, source, status, notes)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'custom', 'open', ?)`)
		.run(leagueId, seasonNumber, key, task.roundNumber ?? null, task.title, task.detail ?? null, task.dueAt ?? null, task.kind, task.notes ?? null);
	return getTask(db, leagueId, Number(info.lastInsertRowid))!;
}

export interface TaskPatch {
	status?: TaskStatus;
	title?: string;
	detail?: string | null;
	dueAt?: string | null;
	notes?: string | null;
}

/**
 * Patch a task. A status-only change (done/skipped toggle) never alters the
 * source. Editing a derived row's content/dates flips it to `custom` so the
 * next derive leaves it alone (spec §7.2 "an edit flips that row to custom").
 * `completed_at` is stamped when a task is marked done and cleared when it is
 * reopened.
 */
export function patchTask(
	db: Database.Database,
	leagueId: number,
	id: number,
	patch: TaskPatch
): PlannerTask | null {
	const cur = getTask(db, leagueId, id);
	if (!cur) return null;
	const edits = patch.title !== undefined || patch.dueAt !== undefined ||
		patch.detail !== undefined || patch.notes !== undefined;
	const source = edits && cur.source === 'derived' ? 'custom' : cur.source;
	const status = patch.status ?? cur.status;
	const completedAt =
		status === 'done' ? new Date().toISOString() :
		status === 'open' ? null :
		cur.completedAt;
	db.prepare(`UPDATE portal_admin_tasks SET
		status = ?, completed_at = ?, source = ?, title = ?, detail = ?, due_at = ?, notes = ?
		WHERE id = ?`)
		.run(
			status,
			completedAt,
			source,
			patch.title ?? cur.title,
			patch.detail !== undefined ? patch.detail : cur.detail,
			patch.dueAt !== undefined ? patch.dueAt : cur.dueAt,
			patch.notes !== undefined ? patch.notes : cur.notes,
			id
		);
	return getTask(db, leagueId, id);
}

/** Delete — custom rows only (§7.4). Derived rows are protected. */
export function deleteTask(db: Database.Database, leagueId: number, id: number): boolean {
	const cur = getTask(db, leagueId, id);
	if (!cur || cur.source !== 'custom') return false;
	db.prepare('DELETE FROM portal_admin_tasks WHERE id = ?').run(id);
	return true;
}