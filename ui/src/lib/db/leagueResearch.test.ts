import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getLeagueResearch } from './leagueResearch.js';

// getLeagueResearch had no test at all, and a SQL parse error ("ambiguous column
// name: name") shipped to production as a 500 because of it. The queries are
// long, multi-join and built by string interpolation, so the cheapest real guard
// is to actually run them against the real database.
const DB = join(import.meta.dirname, '..', '..', '..', '..', 'data', 'league.db');

describe.skipIf(!existsSync(DB))('getLeagueResearch against the real database', () => {
	const open = () => new Database(DB, { readonly: true });

	it('the database fixture is present, so the checks below actually run', () => {
		expect(existsSync(DB)).toBe(true);
	});

	it('every query parses and returns a dataset, all-seasons scope', () => {
		const db = open();
		const d = getLeagueResearch(db, 3, null);
		expect(d).not.toBeNull();
		expect(d!.roster.length).toBeGreaterThan(0);
		expect(d!.matrix.length).toBe(d!.roster.length);
		db.close();
	});

	it('every query parses under a season filter too', () => {
		const db = open();
		const d = getLeagueResearch(db, 3, 2);
		expect(d).not.toBeNull();
		expect(d!.roster.length).toBeGreaterThan(0);
		db.close();
	});

	it('the derived lenses are square and match the roster', () => {
		const db = open();
		const d = getLeagueResearch(db, 3, null)!;
		for (const m of [d.pct, d.rankImpact]) {
			expect(m.length).toBe(d.roster.length);
			for (const row of m) expect(row.length).toBe(d.roster.length);
		}
		// Diagonals are null in both lenses: nobody votes for themselves.
		for (let i = 0; i < d.roster.length; i++) {
			expect(d.pct[i][i]).toBeNull();
			expect(d.rankImpact[i][i]).toBeNull();
		}
		db.close();
	});

	it('resolves display names, so the two Sarahs are distinguishable', () => {
		const db = open();
		const d = getLeagueResearch(db, 3, null)!;
		// Raw ML handles would give "Sarah" and "Sarah S"; players.name gives both surnames.
		expect(d.roster).toContain('Sarah Black');
		expect(d.roster).toContain('Sarah Zucker');
		expect(d.roster).not.toContain('Sarah S');
		expect(d.roster).not.toContain('monicac1217');
		db.close();
	});
});
