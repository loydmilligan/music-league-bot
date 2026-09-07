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

// Both of these were real modelling bugs, found by the soundness invariant
// above before any engine existed. They get named tests so a future refactor
// that reintroduces either one fails with the reason attached.
describe.skipIf(!existsSync(DB))('named regressions', () => {
	it('R139 — a submitter who never voted stays in his own pool (the Quinto case)', () => {
		const db = new Database(DB, { readonly: true });
		const p = getVotingReplay(db, 139)!;
		const voters = new Set(p.ballots.map((b) => b.voter));
		const ghost = p.songs.find((s) => !voters.has(s.submitter));
		expect(ghost, 'R139 should contain a submitter who cast no ballot').toBeDefined();
		const pools = candidatePools(
			p.songs,
			p.ballots,
			p.ballots.map((b) => b.voter),
			[]
		);
		expect(pools[ghost!.uri]).toContain(ghost!.submitter);
		db.close();
	});

	it('R97 — a two-songs-each round does not evict a player from their second song', () => {
		const db = new Database(DB, { readonly: true });
		const p = getVotingReplay(db, 97)!;
		const counts = new Map<string, number>();
		for (const s of p.songs) counts.set(s.submitter, (counts.get(s.submitter) ?? 0) + 1);
		expect(
			[...counts.values()].some((n) => n > 1),
			'R97 should be a two-fer round'
		).toBe(true);
		const pools = candidatePools(
			p.songs,
			p.ballots,
			p.ballots.map((b) => b.voter),
			[]
		);
		for (const s of p.songs) expect(pools[s.uri]).toContain(s.submitter);
		db.close();
	});
});

describe.skipIf(!existsSync(DB))('partition and recovery rates', () => {
	it('a single observer schedule produces disjoint intervals', () => {
		const db = new Database(DB, { readonly: true });
		let roundsChecked = 0;
		for (const roundId of rounds(db).slice(0, 10)) {
			const p = getVotingReplay(db, roundId);
			if (!p || p.ballots.length < 4) continue;
			const ivs = intervals(p.ballots, checkpoints(0, p.ballots.length - 1, 3));
			expect(ivs.length, 'a 3GS schedule should cut the round into several intervals').toBeGreaterThan(1);
			const seen = new Set<string>();
			for (const iv of ivs)
				for (const v of iv.voters) {
					expect(seen.has(v), `${v} appears in two intervals`).toBe(false);
					seen.add(v);
				}
			roundsChecked++;
		}
		expect(roundsChecked, 'no round was large enough to partition').toBeGreaterThan(0);
		db.close();
	});

	it('recovery rises monotonically with glance severity and reaches 100% at 4GS', () => {
		const db = new Database(DB, { readonly: true });
		// Measured over EVERY observer pair with a window of at least one ballot,
		// weighted by window size: recovered in-window ballots / window ballots.
		// Restricting to the widest pair (first voter vs last) makes 1GS and 2GS
		// both flatly 0 — the window is too wide for a coarse glance to isolate
		// anybody — so monotonicity is only meaningful across the pair space.
		//
		// This denominator is not the one behind the spec's headline 18/39/69/100,
		// which is a per-scenario mean and so leans on narrow windows; weighted by
		// ballots the same engine measures 3.9% / 13.6% / 40.3% / 100%.
		const ids = rounds(db);
		const payloads = ids
			.map((id) => getVotingReplay(db, id))
			.filter((p): p is NonNullable<typeof p> => !!p && p.ballots.length >= 4);
		expect(payloads.length, 'no usable rounds in the database').toBeGreaterThan(20);

		const rate = (gs: 1 | 2 | 3 | 4) => {
			let got = 0;
			let tot = 0;
			for (const p of payloads) {
				for (let a = 0; a < p.ballots.length; a++) {
					for (let z = a + 2; z < p.ballots.length; z++) {
						got += recoveredVoters(intervals(p.ballots, checkpoints(a, z, gs))).length;
						tot += z - a - 1; // ballots strictly between the two observers
					}
				}
			}
			return got / tot;
		};
		const [r1, r2, r3, r4] = [rate(1), rate(2), rate(3), rate(4)];
		expect(r1).toBeGreaterThan(0); // a coarse glance still catches lone ballots
		expect(r1).toBeLessThan(r2);
		expect(r2).toBeLessThan(r3);
		expect(r3).toBeLessThan(r4);
		expect(r4).toBeCloseTo(1, 5); // 4GS recovers every ballot in the window
		db.close();
	}, 60_000);
});
