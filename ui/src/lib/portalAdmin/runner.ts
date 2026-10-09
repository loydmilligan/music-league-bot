// Portal admin — section run jobs (spec §4 run/poll). Each `run` is a row in
// portal_admin_runs; POST /run enqueues one and the poll route reads its status.
//
// `runSection` is the real builder today: the panel's sections ARE the digest
// portal's content (see `publicSections`), so Run now regenerates the league's
// portal.json from the current portal-admin config and publishes it atomically
// through the same leak-checked path the digest-publish route uses. A run for a
// disabled section fails (the panel surfaces it) rather than force-publishing
// content the toggle switched off. The "big" per-section automation (digest
// generation, yearbook, moments prompts) does not exist in this repo yet; until
// it lands, a section run == re-publish portal from current config, and the
// runStatus/runState wiring here is the contract those builders will slot into.
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { writePortalJson } from '$lib/portal/portalJson.js';
import { setRunState, type SectionId } from './config.js';
import { readConfig, writeConfig } from './store.js';

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

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e)).slice(0, 400);

/** THE BUILDER — regenerate + publish portal.json from the current config. */
export async function runSection(
	db: Database.Database,
	leagueId: number,
	sectionId: SectionId
): Promise<{ ok: boolean; error?: string }> {
	const config = readConfig(db, leagueId);
	if (!(sectionId in config.sections)) {
		return { ok: false, error: `unknown section "${sectionId}"` };
	}
	if (!config.sections[sectionId].enabled) {
		return { ok: false, error: `section "${sectionId}" is disabled` };
	}
	try {
		const out = await writePortalJson(db, leagueId);
		if (!out) return { ok: false, error: 'no dashboard site for league — portal.json not written' };
		return { ok: true };
	} catch (e) {
		return { ok: false, error: message(e) };
	}
}

export async function enqueueSectionRun(
	db: Database.Database,
	leagueId: number,
	sectionId: SectionId
): Promise<{ jobId: string }> {
	const id = randomUUID();
	const now = new Date().toISOString();
	db.prepare(
		`INSERT INTO portal_admin_runs (id, league_id, section_id, status, created_at, updated_at)
		 VALUES (?, ?, ?, 'pending', ?, ?)`
	).run(id, leagueId, sectionId, now, now);

	db.prepare(`UPDATE portal_admin_runs SET status = 'running', updated_at = ? WHERE id = ?`).run(now, id);
	const outcome = await runSection(db, leagueId, sectionId);
	const finishedAt = new Date().toISOString();
	db.prepare(`UPDATE portal_admin_runs SET status = ?, error = ?, updated_at = ? WHERE id = ?`).run(
		outcome.ok ? 'done' : 'failed',
		outcome.ok ? null : (outcome.error ?? null),
		finishedAt,
		id
	);
	writeConfig(
		db,
		leagueId,
		setRunState(readConfig(db, leagueId), sectionId, {
			status: outcome.ok ? 'ok' : 'error',
			error: outcome.ok ? null : (outcome.error ?? null),
			at: finishedAt
		})
	);
	return { jobId: id };
}

export function getRunStatus(db: Database.Database, jobId: string): PortalRunStatusDto | null {
	const r = db.prepare('SELECT status, updated_at, error FROM portal_admin_runs WHERE id = ?').get(jobId) as
		| Pick<RunRow, 'status' | 'updated_at' | 'error'>
		| undefined;
	if (!r) return null;
	return { status: r.status, updatedAt: r.updated_at, error: r.error };
}