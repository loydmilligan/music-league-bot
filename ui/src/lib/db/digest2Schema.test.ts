import { describe, it, expect } from 'vitest';
import { openLeagueDb } from './client.js';

describe('digest2 schema', () => {
	it('creates the five digest2_* tables', () => {
		const db = openLeagueDb(':memory:');
		const names = (
			db.prepare(
				"SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'digest2_%'"
			).all() as { name: string }[]
		).map((r) => r.name).sort();
		db.close();
		expect(names).toEqual([
			'digest2_drafts',
			'digest2_jobs',
			'digest2_sends',
			'digest2_sections',
			'digest2_shares'
		].sort());
	});

	it('leaves the live digest_sections.kind CHECK intact', () => {
		const db = openLeagueDb(':memory:');
		const row = db.prepare(
			"SELECT sql FROM sqlite_master WHERE type='table' AND name='digest_sections'"
		).get() as { sql: string };
		db.close();
		expect(row.sql).toContain(
			"kind IN ('podium','villain','flow','consensus','quotes','chat','storylines')"
		);
	});

	it('does NOT constrain digest2_sections.kind', () => {
		const db = openLeagueDb(':memory:');
		const row = db.prepare(
			"SELECT sql FROM sqlite_master WHERE type='table' AND name='digest2_sections'"
		).get() as { sql: string };
		db.close();
		expect(row.sql).not.toMatch(/kind[^,\n]*CHECK/i);
	});
});
