import { describe, it, expect, afterEach } from 'vitest';
import { openLeagueDb } from './client.js';
import { unlinkSync, existsSync } from 'node:fs';

const TMP = '/tmp/test-league.db';
const cleanup = () => {
	for (const suffix of ['', '-wal', '-shm']) {
		const p = `${TMP}${suffix}`;
		if (existsSync(p)) unlinkSync(p);
	}
};
afterEach(cleanup);

it('creates all tables', () => {
	const db = openLeagueDb(TMP);
	const names = (
		db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
	).map((r) => r.name);
	[
		'leagues',
		'seasons',
		'rounds',
		'ml_submissions',
		'votes',
		'research_songs',
		'ytm_link_cache',
		'ytm_resolution_queue',
		'import_log',
		'settings',
		'dashboard_sites',
		'dashboard_section_state'
	].forEach((t) => expect(names).toContain(t));
	db.close();
});

describe('dashboard_sites', () => {
	it('has all required columns', () => {
		const db = openLeagueDb(TMP);
		const cols = (
			db.prepare('PRAGMA table_info(dashboard_sites)').all() as { name: string }[]
		).map((r) => r.name);
		for (const col of [
			'slug', 'league_id', 'season', 'read_model',
			'archived_rounds', 'is_live', 'published_at', 'refreshed_at'
		]) {
			expect(cols).toContain(col);
		}
		db.close();
	});
});

describe('dashboard_section_state', () => {
	it('has all required columns', () => {
		const db = openLeagueDb(TMP);
		const cols = (
			db.prepare('PRAGMA table_info(dashboard_section_state)').all() as { name: string }[]
		).map((r) => r.name);
		for (const col of ['league_id', 'section', 'decision', 'steer']) {
			expect(cols).toContain(col);
		}
		db.close();
	});
});

it('is idempotent', () => {
	openLeagueDb(TMP).close();
	expect(() => openLeagueDb(TMP).close()).not.toThrow();
});
