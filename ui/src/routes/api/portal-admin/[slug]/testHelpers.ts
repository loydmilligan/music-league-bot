// Round/season seeding for the portal-admin route tests. The full openLeagueDb
// migration path is required because round_number/managed_by exist only after
// the ALTERs run (they are not in the base SCHEMA string).

import type {} from 'vitest';
import { openLeagueDb } from '$lib/db/client.js';

export function seedLeagueAndSeason(db: ReturnType<typeof openLeagueDb>): void {
	db.prepare(`INSERT INTO leagues (id, slug, name) VALUES (1, 'bz', 'Boarz')`).run();
	db.prepare(
		`INSERT INTO seasons (id, league_id, season_number, status) VALUES (1, 1, 2, 'active')`
	).run();
}

export function seedRound(
	db: ReturnType<typeof openLeagueDb>,
	r: { id: number; name: string; roundNumber: number; sub: string; vote: string }
): void {
	db.prepare(
		`INSERT INTO rounds (id, season_id, ml_round_id, name, submission_deadline, voting_deadline, created_at, round_number, managed_by)
		 VALUES (?, 1, ?, ?, ?, ?, ?, ?, NULL)`
	).run(r.id, `ml-r${r.id}`, r.name, r.sub, r.vote, r.sub, r.roundNumber);
}

export function seedPlan(db: ReturnType<typeof openLeagueDb>): void {
	seedLeagueAndSeason(db);
	const base = Date.parse('2026-09-01T00:00:00Z');
	for (let i = 0; i < 2; i++) {
		const num = i + 1;
		const sub = new Date(base + i * 14 * 864e5).toISOString();
		seedRound(db, {
			id: num,
			name: `Round ${num}`,
			roundNumber: num,
			sub,
			vote: new Date(Date.parse(sub) + 7 * 864e5).toISOString(),
		});
	}
}

export const AUTH = { authorization: 'Bearer test-token' };

export function makeEvent(overrides: {
	slug?: string;
	body?: unknown;
	url?: string;
	headers?: Record<string, string>;
} = {}) {
	const { slug = 'bz', body, url = 'http://test/plan', headers = {} } = overrides;
	const params: Record<string, string> = { slug };
	const path = new URL(url).pathname;
	const jobMatch = /\/run\/([^/]+)$/.exec(path);
	if (jobMatch) params.jobId = jobMatch[1];
	return {
		params,
		url: new URL(url),
		request: {
			headers: new Headers(headers),
			json: async () => body,
		},
	} as never;
}

export function setAuth() {
	process.env.PORTAL_ADMIN_TOKEN = 'test-token';
}