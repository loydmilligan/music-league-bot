// The two derived heatmap lenses: point share, and round-rank impact.
//
// Kept pure and separate from leagueResearch.ts (which does SQL) so the maths is
// testable without a database. Both lenses answer questions the raw points
// matrix cannot: raw points flatter prolific voters and popular recipients
// alike, so "Matt gave Mara 20" and "Sarah gave Jon 20" look identical even when
// they mean very different things.

/** One round's cross-votes, already resolved to player names. */
export interface RoundVotes {
	roundId: number;
	votes: Array<{ voter: string; submitter: string; points: number }>;
}

/** matrix[voterIdx][recipientIdx]; null on the diagonal. */
export type NumMatrix = (number | null)[][];

const blank = (n: number): NumMatrix =>
	Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => (r === c ? null : 0)));

/**
 * Share of the recipient's NET total that came from each voter, as a percentage.
 *
 * Net includes downvotes, so a cell can be negative: a voter who only ever
 * knifed someone genuinely reduced their total, and flooring that at zero would
 * hide the league's villain relationships behind a wall of blanks.
 *
 * A recipient on zero (or negative) net points has no meaningful denominator, so
 * their column is null rather than an infinity.
 */
export function pctMatrix(
	roster: string[],
	edges: Array<{ voter: string; submitter: string; points: number }>,
): NumMatrix {
	const idx = new Map(roster.map((n, i) => [n, i]));
	const received = new Map<string, number>();
	for (const e of edges) received.set(e.submitter, (received.get(e.submitter) ?? 0) + e.points);

	const m = blank(roster.length);
	for (const e of edges) {
		const r = idx.get(e.voter);
		const c = idx.get(e.submitter);
		if (r === undefined || c === undefined || r === c) continue;
		const total = received.get(e.submitter) ?? 0;
		m[r][c] = total > 0 ? Math.round((e.points / total) * 100) : null;
	}
	for (const name of roster) {
		const c = idx.get(name)!;
		if ((received.get(name) ?? 0) > 0) continue;
		for (let r = 0; r < roster.length; r++) if (r !== c) m[r][c] = null;
	}
	return m;
}

/** Rank players by summed points across all their songs; ties break by name. */
function rankRound(votes: RoundVotes['votes'], exclude: string | null): Map<string, number> {
	const totals = new Map<string, number>();
	for (const v of votes) {
		if (!totals.has(v.submitter)) totals.set(v.submitter, 0);
		if (v.voter === exclude) continue;
		totals.set(v.submitter, totals.get(v.submitter)! + v.points);
	}
	const order = [...totals.keys()].sort((a, b) => totals.get(b)! - totals.get(a)! || a.localeCompare(b));
	return new Map(order.map((n, i) => [n, i + 1]));
}

/**
 * How many positions each submitter would DROP if that voter's whole ballot
 * vanished from the round, summed across rounds.
 *
 * Whole-ballot removal, not just the points that voter gave the target: pulling
 * a ballot also pulls what it gave the target's rivals. So a cell can be
 * non-zero where nothing was given directly, and negative where a voter was
 * holding someone back — both are real effects and both are worth seeing.
 */
export function rankImpactMatrix(roster: string[], rounds: RoundVotes[]): NumMatrix {
	const idx = new Map(roster.map((n, i) => [n, i]));
	const m = blank(roster.length);
	for (const round of rounds) {
		const actual = rankRound(round.votes, null);
		const voters = [...new Set(round.votes.map((v) => v.voter))];
		for (const voter of voters) {
			const without = rankRound(round.votes, voter);
			const r = idx.get(voter);
			if (r === undefined) continue;
			for (const [submitter, rank] of actual) {
				const c = idx.get(submitter);
				if (c === undefined || r === c) continue;
				m[r][c] = (m[r][c] ?? 0) + (without.get(submitter)! - rank);
			}
		}
	}
	return m;
}
