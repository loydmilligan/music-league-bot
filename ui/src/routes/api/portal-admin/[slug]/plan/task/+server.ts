import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import type Database from 'better-sqlite3';
import { requirePortalAdmin } from '$lib/portalAdmin/api.js';
import { syncSeasonPlan } from '$lib/portalAdmin/seasonSync.js';
import { createTask, deleteTask, getTask, patchTask, type TaskPatch } from '$lib/portalAdmin/taskStore.js';
import type { PlanTaskDto } from '$lib/portalAdmin/planView.js';

const KINDS = ['content', 'ops', 'review'] as const;

function readTaskBody(raw: unknown): PlanTaskDto {
	const body = (raw ?? {}) as { task?: unknown };
	if (!body.task || typeof body.task !== 'object') throw error(400, 'body must be { task: PlanTask }');
	return body.task as PlanTaskDto;
}

function findTaskId(db: Database.Database, leagueId: number, seasonNumber: number, key: string): number {
	const row = db
		.prepare('SELECT id FROM portal_admin_tasks WHERE league_id = ? AND season_number = ? AND key = ?')
		.get(leagueId, seasonNumber, key) as { id: number } | undefined;
	if (!row) throw error(404, `no task with key "${key}"`);
	return row.id;
}

function validateTask(t: PlanTaskDto): t is PlanTaskDto {
	if (!t || typeof t !== 'object') return false;
	if (typeof t.label !== 'string' || t.label.length === 0) return false;
	if (!(KINDS as readonly string[]).includes(t.kind)) return false;
	if (t.dueAt !== null && typeof t.dueAt !== 'string') return false;
	return true;
}

export const POST: RequestHandler = async (event) => {
	const { db, leagueId } = requirePortalAdmin(event);
	const seasonNumber = syncSeasonPlan(db, leagueId);
	if (seasonNumber === null) throw error(400, 'league has no seasons yet');
	const task = readTaskBody(await event.request.json().catch(() => null));
	if (!validateTask(task)) throw error(400, 'task must have a non-empty label, a kind, and a nullable ISO dueAt');
	createTask(db, leagueId, seasonNumber, {
		roundNumber: task.round,
		title: task.label,
		dueAt: task.dueAt,
		kind: task.kind,
		notes: task.notes ?? null,
	});
	return json({ ok: true });
};

export const PATCH: RequestHandler = async (event) => {
	const { db, leagueId } = requirePortalAdmin(event);
	const seasonNumber = syncSeasonPlan(db, leagueId);
	if (seasonNumber === null) throw error(400, 'league has no seasons yet');
	const task = readTaskBody(await event.request.json().catch(() => null));
	if (typeof task.key !== 'string' || task.key.length === 0) throw error(400, 'task.key is required to PATCH');
	if (task.status !== undefined && task.status !== 'open' && task.status !== 'done' && task.status !== 'skipped') {
		throw error(400, 'task.status must be open, done, or skipped');
	}
	const id = findTaskId(db, leagueId, seasonNumber, task.key);
	const cur = getTask(db, leagueId, id);
	if (!cur) throw error(404, `no task with key "${task.key}"`);
	// Forward only the fields that actually changed, so a status toggle that
	// resends the same content (the bside saveTask flow) does NOT flip a derived
	// row to custom — only a genuine edit does (spec §7.2).
	const patch: TaskPatch = {};
	if (task.label !== undefined && task.label !== cur.title) patch.title = task.label;
	if (task.dueAt !== undefined && task.dueAt !== cur.dueAt) patch.dueAt = task.dueAt;
	if (task.notes !== undefined && task.notes !== cur.notes) patch.notes = task.notes;
	if (task.status !== undefined && task.status !== cur.status) patch.status = task.status;
	const patched = patchTask(db, leagueId, id, patch);
	if (!patched) throw error(404, `no task with key "${task.key}"`);
	return json({ ok: true });
};

export const DELETE: RequestHandler = async (event) => {
	const { db, leagueId } = requirePortalAdmin(event);
	const seasonNumber = syncSeasonPlan(db, leagueId);
	if (seasonNumber === null) throw error(400, 'league has no seasons yet');
	const body = (await event.request.json().catch(() => null)) as { key?: unknown } | null;
	if (typeof body?.key !== 'string' || body.key.length === 0) throw error(400, 'body must be { key: string }');
	const id = findTaskId(db, leagueId, seasonNumber, body.key);
	if (!deleteTask(db, leagueId, id)) throw error(409, 'derived tasks cannot be deleted');
	return json({ ok: true });
};