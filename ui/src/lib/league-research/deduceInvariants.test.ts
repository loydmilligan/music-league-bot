// Property tests for the voting-replay deduction engine, run against the real
// league database rather than fixtures. These are the tests that make the tool
// trustworthy: the soundness invariant below caught two modelling bugs (the
// Quinto case and the two-fer case) before any engine code existed.
//
// See docs/superpowers/specs/2026-09-07-voting-replay-design.md, "Testing".
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getVotingReplay } from '$lib/db/votingReplay.js';
import { candidatePools, checkpoints, intervals, recoveredVoters } from './deduce.js';

// Resolved from this file, not from the working directory: vitest runs with cwd
// = ui/, and the real database lives at the repository root.
const DB = fileURLToPath(new URL('../../../../data/league.db', import.meta.url));

const rounds = (db: Database.Database) =>
	(db.prepare('SELECT DISTINCT round_id AS id FROM votes').all() as { id: number }[]).map(
		(r) => r.id
	);

// Guard: everything below is skipIf'd on the database being absent, which would
// otherwise let a missing fixture read as a clean pass. This test is not
// skipped, so an absent database is a loud failure instead of a silent one.
describe('the real league database', () => {
	it('is present, so the invariants below actually run', () => {
		expect(existsSync(DB), `expected the real league db at ${DB}`).toBe(true);
	});
});

describe.skipIf(!existsSync(DB))('soundness against every real round', () => {
	it('mechanical narrowing NEVER excludes the true submitter', () => {
		const db = new Database(DB, { readonly: true });
		const failures: string[] = [];
		let checked = 0;
		for (const roundId of rounds(db)) {
			const p = getVotingReplay(db, roundId);
			if (!p || p.ballots.length < 3 || !p.songs.length) continue;
			for (let a = 0; a < p.ballots.length; a++) {
				for (let z = a + 1; z < p.ballots.length; z++) {
					for (const gs of [1, 2, 3, 4] as const) {
						const cps = checkpoints(a, z, gs);
						const known = [
							...recoveredVoters(intervals(p.ballots, cps)),
							p.ballots[a].voter,
							p.ballots[z].voter
						];
						const obs = [p.ballots[a].voter, p.ballots[z].voter];
						const pools = candidatePools(p.songs, p.ballots, known, obs);
						checked++;
						for (const s of p.songs) {
							if (!pools[s.uri].includes(s.submitter)) {
								failures.push(
									`r${roundId} ${obs.join('+')} gs${gs}: ${s.uri} lost ${s.submitter}`
								);
							}
						}
					}
				}
			}
		}
		db.close();
		expect(checked).toBeGreaterThan(20000);
		expect(failures).toEqual([]);
	}, 120_000);
});
