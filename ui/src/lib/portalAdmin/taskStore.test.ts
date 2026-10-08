import { describe, expect, it } from 'vitest';
import { openLeagueDb } from '../db/client.ts';
import {
	deriveSeason, listTasks, createTask, patchTask, deleteTask, mergeDerived,
} from './taskStore.ts';
import { deriveTasks } from './plan.ts';
import type { Round, Season } from '../types.js';

const season: Season = { id: 1, leagueId: 7, seasonNumber: 2, status: 'active' };

function mkRounds(subShiftDays = 0): Round[] {
	const base = Date.parse('2026-09-01T00:00:00Z') + subShiftDays * 864e5;
	return Array.from({ length: 3 }, (_, i) => {
		const num = i + 1;
		const sub = new Date(base + i * 14 * 864e5).toISOString();
		return {
			id: num, seasonId: 1, mlRoundId: `r${num}`, name: `Round ${num}`,
			description: null, spotifyPlaylistUrl: null,
			submissionDeadline: sub, votingDeadline: new Date(base + i * 14 * 864e5 + 7 * 864e5).toISOString(),
			createdAt: sub, roundNumber: num, managedBy: null,
		} satisfies Round;
	});
}

describe('taskStore', () => {
	function freshDb() {
		const db = openLeagueDb(':memory:');
		db.prepare('INSERT INTO leagues (id, slug, name) VALUES (7, ?, ?)').run('test', 'Test League');
		return db;
	}

	it('derives the full set and is idempotent on re-derive', () => {
		const db = freshDb();
		const first = deriveSeason(db, season, mkRounds());
		expect(first.updated).toBe(0);
		const count = listTasks(db, season.leagueId, season.seasonNumber).length;
		expect(count).toBe(deriveTasks(season, mkRounds()).length);

		const again = deriveSeason(db, season, mkRounds());
		expect(again.inserted).toBe(0);
		expect(again.updated).toBeGreaterThan(0);
		expect(listTasks(db, season.leagueId, season.seasonNumber).length).toBe(count);
	});

	it('a deadline change moves an open derived row in place', () => {
		const db = freshDb();
		deriveSeason(db, season, mkRounds());
		const before = listTasks(db, season.leagueId, season.seasonNumber)
			.find((t) => t.key === 'r2.voting-rules')!;
		deriveSeason(db, season, mkRounds(3)); // every deadline shifts +3 days
		const after = listTasks(db, season.leagueId, season.seasonNumber)
			.find((t) => t.key === 'r2.voting-rules')!;
		expect(new Date(after.dueAt!).getTime()).toBeGreaterThan(new Date(before.dueAt!).getTime());
		expect(after.id).toBe(before.id);
	});

	it('a done row survives re-derivation untouched', () => {
		const db = freshDb();
		deriveSeason(db, season, mkRounds());
		const row = listTasks(db, season.leagueId, season.seasonNumber).find((t) => t.key === 'r1.submission')!;
		patchTask(db, season.leagueId, row.id, { status: 'done' });
		deriveSeason(db, season, mkRounds(5));
		const after = listTasks(db, season.leagueId, season.seasonNumber).find((t) => t.key === 'r1.submission')!;
		expect(after.status).toBe('done');
		expect(after.dueAt).toBe(row.dueAt); // due_at not overwritten
	});

	it('a custom row survives re-derivation', () => {
		const db = freshDb();
		deriveSeason(db, season, mkRounds());
		createTask(db, season.leagueId, season.seasonNumber, {
			roundNumber: 2,
			title: 'Collect away-trip playlist',
			kind: 'ops',
			dueAt: '2026-11-01T09:00:00Z',
		});
		deriveSeason(db, season, mkRounds(9));
		const rows = listTasks(db, season.leagueId, season.seasonNumber);
		const custom = rows.find((t) => t.title === 'Collect away-trip playlist')!;
		expect(custom.source).toBe('custom');
		expect(custom.dueAt).toBe('2026-11-01T09:00:00Z');
	});

	it('editing a derived row flips it to custom so derive leaves it alone', () => {
		const db = freshDb();
		deriveSeason(db, season, mkRounds());
		const row = listTasks(db, season.leagueId, season.seasonNumber).find((t) => t.key === 'season.start')!;
		const moved = patchTask(db, season.leagueId, row.id, { dueAt: '2026-09-25T00:00:00Z' })!;
		expect(moved.source).toBe('custom');
		deriveSeason(db, season, mkRounds(5));
		const after = listTasks(db, season.leagueId, season.seasonNumber).find((t) => t.key === 'season.start')!;
		expect(after.dueAt).toBe('2026-09-25T00:00:00Z');
	});

	it('only custom rows can be deleted', () => {
		const db = freshDb();
		deriveSeason(db, season, mkRounds());
		const derived = listTasks(db, season.leagueId, season.seasonNumber)[0];
		expect(deleteTask(db, season.leagueId, derived.id)).toBe(false);
		expect(listTasks(db, season.leagueId, season.seasonNumber)).toContainEqual(derived);
		const custom = createTask(db, season.leagueId, season.seasonNumber, {
			title: 'Temporary', kind: 'ops',
		});
		expect(deleteTask(db, season.leagueId, custom.id)).toBe(true);
		expect(listTasks(db, season.leagueId, season.seasonNumber).some((t) => t.id === custom.id)).toBe(false);
	});

	it('GC drops open derived rows gone from the derivation but keeps done sentinels', () => {
		const db = freshDb();
		deriveSeason(db, season, mkRounds());
		// r3 is the last round: 10 per-round rows, no r*.next-reveal that round.
		const r3Keys = listTasks(db, season.leagueId, season.seasonNumber)
			.filter((t) => t.roundNumber === 3)
			.map((t) => t.key);
		expect(r3Keys.length).toBe(10);
		const sentinel = listTasks(db, season.leagueId, season.seasonNumber)
			.find((t) => t.key === 'r3.submission')!;
		patchTask(db, season.leagueId, sentinel.id, { status: 'done' });

		const before = listTasks(db, season.leagueId, season.seasonNumber).length;
		mergeDerived(db, season.leagueId, season.seasonNumber, deriveTasks(season, mkRounds().slice(0, 2)));
		const after = listTasks(db, season.leagueId, season.seasonNumber);

		// 9 open r3 rows GC'd (r3 is gone from the derivation) — and so is
		// r2.next-reveal, which only exists while r3 is part of the season.
		expect(after.length).toBe(before - 10);
		expect(after.some((t) => t.key === 'r3.submission')).toBe(true); // done sentinel survives
		expect(after.some((t) => t.key === 'r3.digest-edit')).toBe(false); // open r3 row gone
		expect(after.some((t) => t.key === 'r2.next-reveal')).toBe(false);
	});
});