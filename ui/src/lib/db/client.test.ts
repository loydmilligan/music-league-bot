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
		'settings'
	].forEach((t) => expect(names).toContain(t));
	db.close();
});

it('is idempotent', () => {
	openLeagueDb(TMP).close();
	expect(() => openLeagueDb(TMP).close()).not.toThrow();
});
