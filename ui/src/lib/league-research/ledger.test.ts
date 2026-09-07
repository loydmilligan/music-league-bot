import { describe, it, expect } from 'vitest';
import { ledgerRows, churn, churnScale } from './ledger.js';
import type { ReplayPayload } from './replayTypes.js';

const song = (uri: string, submitter: string) =>
	({ uri, title: uri.toUpperCase(), artist: 'A', submitter, submitterComment: null });
const ballot = (voter: string, day: number, ...pairs: Array<[string, number]>) => ({
	voter,
	castAt: `2026-09-0${day}T00:00:00Z`,
	votes: pairs.map(([uri, points]) => ({ uri, points, comment: null })),
});

/** A: s1, B: s2, C: s3. Votes chosen so ranks actually reorder as the round runs. */
const payload = (): ReplayPayload => ({
	round: { id: 1, name: 'R', description: '', votingDeadline: null, windowOpensAfter: null },
	songs: [song('s1', 'A'), song('s2', 'B'), song('s3', 'C')],
	ballots: [
		ballot('A', 1, ['s2', 1], ['s3', 5]),
		ballot('B', 2, ['s1', 4], ['s3', -1]),
		ballot('C', 3, ['s1', 3], ['s2', 1]),
	],
});

describe('ledgerRows', () => {
	it('segments always sum to the running total — a bar that lies is worse than no bar', () => {
		for (let i = 0; i < 3; i++) {
			for (const obs of [[], ['A'], ['A', 'B']]) {
				for (const row of ledgerRows(payload(), i, obs)) {
					const summed = row.segments.reduce((n, s) => n + s.points, 0);
					expect(summed, `step ${i} obs ${obs} song ${row.uri}`).toBe(row.total);
				}
			}
		}
	});

	it("the current voter's points are never in a colour segment, at any position", () => {
		for (let i = 0; i < 3; i++) {
			const rows = ledgerRows(payload(), i, ['A', 'B', 'C']);
			for (const row of rows) {
				for (const seg of row.segments) {
					if (seg.kind === 'observer') expect(seg.player).not.toBe(rows[0].currentVoter);
				}
			}
		}
	});

	it("an observer's points are grey before their ballot and coloured after it", () => {
		// A votes first. At step 0 A IS the current voter -> red, no colour segment.
		const atA = ledgerRows(payload(), 0, ['A']).find((r) => r.uri === 's3')!;
		expect(atA.segments.some((s) => s.kind === 'observer')).toBe(false);
		expect(atA.segments.some((s) => s.kind === 'current' && s.points === 5)).toBe(true);
		// By step 1, A is historical -> their 5 points carry A's colour, not grey.
		const atB = ledgerRows(payload(), 1, ['A']).find((r) => r.uri === 's3')!;
		expect(atB.segments.find((s) => s.kind === 'observer' && s.player === 'A')?.points).toBe(5);
	});

	it('non-selected historical voters pool into one grey segment', () => {
		const row = ledgerRows(payload(), 2, [])!.find((r) => r.uri === 's1')!;
		expect(row.segments.filter((s) => s.kind === 'prior')).toHaveLength(1);
		expect(row.segments.find((s) => s.kind === 'prior')!.points).toBe(4); // B's 4
	});

	it('prevRank is set if and only if the song actually changed position', () => {
		// Asserted as an invariant against a recomputed ranking rather than against
		// hand-worked expectations: my first version of this test hand-computed the
		// ranks and got them wrong, because a song can hold its POINTS and still
		// change RANK when another song leapfrogs it.
		const p = payload();
		const rankAt = (i: number) => {
			const t = new Map(p.songs.map((s) => [s.uri, 0]));
			p.ballots.slice(0, i + 1).forEach((b) => b.votes.forEach((v) => t.set(v.uri, t.get(v.uri)! + v.points)));
			const order = [...t.keys()].sort((a, b) => t.get(b)! - t.get(a)! || a.localeCompare(b));
			return new Map(order.map((u, n) => [u, n + 1]));
		};
		for (let i = 0; i < p.ballots.length; i++) {
			const before = rankAt(i - 1);
			for (const row of ledgerRows(p, i, [])) {
				const moved = before.get(row.uri) !== row.rank;
				expect(row.prevRank, `${row.uri} at step ${i}`).toBe(moved ? before.get(row.uri)! : null);
			}
		}
		// And the specific climb still holds: s1 gains 4 and moves up.
		const s1 = ledgerRows(p, 1, []).find((r) => r.uri === 's1')!;
		expect(s1.prevRank).toBeGreaterThan(s1.rank);
	});

	it('flags rows submitted by a selected observer', () => {
		const rows = ledgerRows(payload(), 2, ['B']);
		expect(rows.find((r) => r.uri === 's2')!.isObserverSong).toBe(true);
		expect(rows.find((r) => r.uri === 's1')!.isObserverSong).toBe(false);
	});
});

describe('churn', () => {
	it('counts songs that changed position on each ballot', () => {
		const c = churn(payload());
		expect(c).toHaveLength(3);
		expect(c.every((n) => n >= 0)).toBe(true);
	});

	it('excludes the opening ballot from the scale — it reorders everything by definition', () => {
		expect(churn(payload()).length).toBe(3);
		const { scaleMax } = churnScale(payload());
		const raw = churn(payload());
		expect(scaleMax).toBe(Math.max(...raw.slice(1)));
	});
});
