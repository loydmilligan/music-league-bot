// Ledger view maths for the Voting Replay drawer.
//
// Presentation maths, deliberately kept out of deduce.ts: that module holds the
// SOUND deduction rules and nothing else. This one turns a payload plus a
// scrubber position into rows a bar chart can render, and it is pure so the one
// property that matters — segments summing to the total — is testable without a
// browser. A stacked bar whose parts do not add up to its label is worse than
// no chart, because it looks authoritative while being wrong.
import type { ReplayPayload } from './replayTypes.js';

/** One slice of a song's bar. `prior` pools every non-selected historical voter. */
export interface LedgerSegment {
	kind: 'prior' | 'observer' | 'current';
	/** Set only for `observer` segments. */
	player?: string;
	points: number;
}

export interface LedgerRow {
	uri: string;
	title: string;
	artist: string;
	submitter: string;
	total: number;
	rank: number;
	/** Position before this ballot, ONLY when it changed. Null means it held station. */
	prevRank: number | null;
	/** Points the current voter just added (may be negative). */
	currentDelta: number;
	/** True when a selected observer submitted this song. */
	isObserverSong: boolean;
	/** Whose ballot is being viewed — same on every row, carried for convenience. */
	currentVoter: string;
	segments: LedgerSegment[];
}

/** Ties break by uri so ranking is deterministic across steps. */
function rankOf(totals: Map<string, number>, uris: string[]): Map<string, number> {
	const order = [...uris].sort((a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0) || a.localeCompare(b));
	return new Map(order.map((u, i) => [u, i + 1]));
}

function totalsAfter(payload: ReplayPayload, upto: number): Map<string, number> {
	const t = new Map<string, number>(payload.songs.map((s) => [s.uri, 0]));
	payload.ballots.slice(0, upto + 1).forEach((b) => {
		for (const v of b.votes) t.set(v.uri, (t.get(v.uri) ?? 0) + v.points);
	});
	return t;
}

/**
 * Rows for the ledger at scrubber position `index`.
 *
 * Segment rule, which is the whole point of the view: the CURRENT voter's
 * contribution is always its own segment (rendered red), even when that voter is
 * one of the selected observers. A selected observer only takes their own colour
 * once they are historical — behind the scrubber.
 */
export function ledgerRows(payload: ReplayPayload, index: number, observers: string[]): LedgerRow[] {
	const cur = payload.ballots[index];
	const totals = totalsAfter(payload, index);
	const ranks = rankOf(totals, payload.songs.map((s) => s.uri));
	const prevRanks = rankOf(totalsAfter(payload, index - 1), payload.songs.map((s) => s.uri));
	const obs = new Set(observers);

	return payload.songs
		.map((s): LedgerRow => {
			let prior = 0;
			const byObserver = new Map<string, number>();
			for (const b of payload.ballots.slice(0, index)) {
				const pts = b.votes.filter((v) => v.uri === s.uri).reduce((n, v) => n + v.points, 0);
				if (!pts) continue;
				if (obs.has(b.voter)) byObserver.set(b.voter, (byObserver.get(b.voter) ?? 0) + pts);
				else prior += pts;
			}
			const currentDelta = cur ? cur.votes.filter((v) => v.uri === s.uri).reduce((n, v) => n + v.points, 0) : 0;

			const segments: LedgerSegment[] = [];
			if (prior !== 0) segments.push({ kind: 'prior', points: prior });
			for (const [player, points] of byObserver) segments.push({ kind: 'observer', player, points });
			if (currentDelta !== 0) segments.push({ kind: 'current', points: currentDelta });

			const rank = ranks.get(s.uri)!;
			const before = prevRanks.get(s.uri)!;
			return {
				uri: s.uri, title: s.title, artist: s.artist, submitter: s.submitter,
				total: totals.get(s.uri) ?? 0,
				rank, prevRank: before === rank ? null : before,
				currentDelta,
				isObserverSong: obs.has(s.submitter),
				currentVoter: cur?.voter ?? '',
				segments,
			};
		})
		.sort((a, b) => a.rank - b.rank);
}

/** Songs whose position changed on each ballot — the scrubber's tick heights. */
export function churn(payload: ReplayPayload): number[] {
	const uris = payload.songs.map((s) => s.uri);
	return payload.ballots.map((_, i) => {
		const before = rankOf(totalsAfter(payload, i - 1), uris);
		const after = rankOf(totalsAfter(payload, i), uris);
		return uris.filter((u) => before.get(u) !== after.get(u)).length;
	});
}

/**
 * Scale for the churn ticks. The opening ballot is excluded: it moves every
 * scored song by definition, because it breaks an all-zero tie, so including it
 * flattens the rest of the round into noise.
 */
export function churnScale(payload: ReplayPayload): { scaleMax: number; values: number[] } {
	const values = churn(payload);
	const rest = values.slice(1);
	return { scaleMax: rest.length ? Math.max(...rest) : 0, values };
}
