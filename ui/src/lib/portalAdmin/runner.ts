// Portal admin — section run jobs (spec §4 run/poll). Each `run` is a row in
// portal_admin_runs; POST /run enqueues one and the poll route reads its status.
//
// `runSection` is the seam: today it's a stub because no section builder exists
// in this repo yet. The real builder replaces that body and the wire contract
// (post-run state + error) doesn't move.
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

export type PortalRunStatus = 'pending' | 'running' | 'done' | 'failed';

export interface PortalRunStatusDto {
	status: PortalRunStatus;
	updatedAt: string | null;
	error: string | null;
}

interface RunRow {
	id: string;
	league_id: number;
	section_id: string;
	status: PortalRunStatus;
	created_at: string;
	updated_at: string;
	error: string | null;
}

/** THE SEAM — replace with the real section builder. */
export function runSection(
	_db: Database.Database,
	_leagueId: number,
	sectionId: string
): { ok: boolean; error?: string } {
	return { ok: true, error: `stub runner: no builder configured for "${sectionId}"` };
}

export function enqueueSectionRun(
	db: Database.Database,
	leagueId: number,
	sectionId: string
): { jobId: string } {
	const id = randomUUID();
	const now = new Date().toISOString();
	db.prepare(
		`INSERT INTO portal_admin_runs (id, league_id, section_id, status, created_at, updated_at)
		 VALUES (?, ?, ?, 'pending', ?, ?)`
	).run(id, leagueId, sectionId, now, now);

	// Execute inline so the job is terminal before the route returns; the poll
	// route stays meaningful for real (slower) builders that swap in later.
	const tx = db.transaction(() => {
		db.prepare(`UPDATE portal_admin_runs SET status = 'running', updated_at = ? WHERE id = ?`).run(now, id);
		const outcome = runSection(db, leagueId, sectionId);
		if (outcome.ok) {
			db.prepare(`UPDATE portal_admin_runs SET status = 'done', error = NULL, updated_at = ? WHERE id = ?`).run(
				new Date().toISOString(),
				id
			);
		} else {
			db.prepare(`UPDATE portal_admin_runs SET status = 'failed', error = ?, updated_at = ? WHERE id = ?`).run(
				outcome.error ?? null,
				new Date().toISOString(),
				id
			);
		}
	});
	tx();

	return { jobId: id };
}

export function getRunStatus(db: Database.Database, jobId: string): PortalRunStatusDto | null {
	const r = db.prepare('SELECT status, updated_at, error FROM portal_admin_runs WHERE id = ?').get(jobId) as
		| Pick<RunRow, 'status' | 'updated_at' | 'error'>
		| undefined;
	if (!r) return null;
	return { status: r.status, updatedAt: r.updated_at, error: r.error };
}