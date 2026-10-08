// Portal admin — shared request wrapper for /api/portal-admin/<slug>/…
// Every handler runs through requirePortalAdmin: fail-closed bearer check
// first (401), then the slug must resolve to a real league (404).
import { error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import type Database from 'better-sqlite3';
import { getDb } from '$lib/db/client.js';
import { verifyPortalAdmin } from './auth.js';

export interface PortalAdminContext {
	event: RequestEvent;
	db: Database.Database;
	leagueId: number;
	slug: string;
}

export function requirePortalAdmin(event: RequestEvent): PortalAdminContext {
	if (!verifyPortalAdmin(event.request)) {
		throw error(401, 'unauthorized: missing or invalid admin token');
	}
	const db = getDb();
	const slug = event.params.slug ?? '';
	const row = db.prepare('SELECT id FROM leagues WHERE slug = ?').get(slug) as { id: number } | undefined;
	if (!row) throw error(404, 'unknown league slug');
	return { event, db, leagueId: row.id, slug };
}

/** Parse the `days` query param for GET /plan. Absent/invalid → default 7. */
export function parsePlanDays(raw: string | null): number {
	const n = Number(raw);
	if (!Number.isFinite(n) || n < 0) return 7;
	return Math.floor(n);
}