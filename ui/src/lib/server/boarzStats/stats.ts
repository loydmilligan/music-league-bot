// Pure computations for the boarz-stats share site. No DB access here —
// data.ts queries SQLite and calls into these. Everything is plain
// JSON-serializable so the snapshot survives SvelteKit's devalue serialization.

export interface Comp {
	id: number;
	name: string;
	botName?: string;
}

export interface RoundInfo {
	id: number;
	idx: number;
	seasonNumber: number;
	name: string;
	t0: string;
	subDeadline: string;
	voteDeadline: string;
	votingEnded: string | null;
}

export interface Sub {
	roundIdx: number;
	compIdx: number;
	uri: string;
	spotifyUrl?: string | null;
	ytmUrl?: string | null;
	title: string;
	artists: string[];
	art: string | null;
	createdAt: string;
	totalPts: number;
	votesReceived: number;
}

export interface Vote {
	roundIdx: number;
	voterIdx: number;
	songIdx: number;
	pts: number;
	createdAt: string;
}

export const PALETTE = [
	'#a78bfa', '#f472b6', '#2dd4bf', '#fb923c', '#60a5fa',
	'#4ade80', '#e879f9', '#22d3ee', '#fbbf24', '#f87171',
	'#38bdf8', '#c084fc',
];

// ---------------------------------------------------------------------------
// Voting spreads, round scores, standings

export function computeSpread(votes: Vote[]): { pts: number; count: number }[] {
	const m = new Map<number, number>();
	for (const v of votes) m.set(v.pts, (m.get(v.pts) ?? 0) + 1);
	return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([pts, count]) => ({ pts, count }));
}

/** Points earned per round per competitor: [roundIdx][compIdx] (0 when absent). */
export function computeRoundScores(subs: Sub[], votes: Vote[], nRounds: number, nComps: number): number[][] {
	const out = Array.from({ length: nRounds }, () => new Array<number>(nComps).fill(0));
	for (const s of subs) out[s.roundIdx][s.compIdx] = 0;
	for (const v of votes) {
		const song = subs[v.songIdx];
		if (song) out[v.roundIdx][song.compIdx] += v.pts;
	}
	return out;
}

/** Cumulative totals carried forward through missed rounds. */
export function computeCumulative(scores: number[][]): number[][] {
	const nComps = scores[0]?.length ?? 0;
	const out: number[][] = [];
	let running = new Array<number>(nComps).fill(0);
	for (const roundScores of scores) {
		running = running.map((t, i) => t + (roundScores[i] ?? 0));
		out.push([...running]);
	}
	return out;
}

/** Standing position (1-based, 1 = leader) after each round. */
export function computePositionsByRound(cumulative: number[][]): number[][] {
	return cumulative.map((totals) => {
		const order = totals.map((t, i) => ({ t, i })).sort((a, b) => b.t - a.t || a.i - b.i);
		const pos = new Array<number>(totals.length).fill(0);
		order.forEach((o, rank) => (pos[o.i] = rank + 1));
		return pos;
	});
}

// ---------------------------------------------------------------------------
// Vote heatmap — voter x submitter, raw and round-normalized

export interface Heatmap {
	/** Total points voter gave submitter across all rounds. */
	raw: number[][];
	/** Avg points/round restricted to rounds where BOTH were active (null = never co-active). */
	norm: (number | null)[][];
	/** Count of rounds where both were active. */
	both: number[][];
}

export function computeHeatmap(subs: Sub[], votes: Vote[], nRounds: number, nComps: number): Heatmap {
	const submitted = Array.from({ length: nRounds }, () => new Array<boolean>(nComps).fill(false));
	for (const s of subs) submitted[s.roundIdx][s.compIdx] = true;
	const voted = Array.from({ length: nRounds }, () => new Array<boolean>(nComps).fill(false));
	for (const v of votes) voted[v.roundIdx][v.voterIdx] = true;

	const raw = Array.from({ length: nComps }, () => new Array<number>(nComps).fill(0));
	const both = Array.from({ length: nComps }, () => new Array<number>(nComps).fill(0));
	for (const v of votes) {
		const song = subs[v.songIdx];
		if (!song) continue;
		raw[v.voterIdx][song.compIdx] += v.pts;
	}
	// both-count for normalization: rounds where the pair was co-active
	for (let r = 0; r < nRounds; r++) {
		for (let a = 0; a < nComps; a++) {
			if (!voted[r][a]) continue;
			for (let b = 0; b < nComps; b++) {
				if (a !== b && submitted[r][b]) both[a][b] += 1;
			}
		}
	}
	const norm: (number | null)[][] = raw.map((row, a) =>
		row.map((total, b) => {
			const coRounds = both[a][b];
			return coRounds > 0 ? total / coRounds : null;
		})
	);
	return { raw, norm, both };
}

// ---------------------------------------------------------------------------
// Playlist position bias

export interface PosPoint {
	pos: number;
	avgScore: number;
	avgVotes: number;
	rounds: number;
}

export type PositionMode = 'uri' | 'chrono';

export function computePositionBias(subs: Sub[], mode: PositionMode): PosPoint[] {
	// position 1..n within each round, for the requested ordering
	const byRound = new Map<number, Sub[]>();
	for (const s of subs) {
		const arr = byRound.get(s.roundIdx) ?? [];
		arr.push(s);
		byRound.set(s.roundIdx, arr);
	}
	const posOf = new Map<Sub, number>();
	for (const arr of byRound.values()) {
		const sorted = [...arr].sort((a, b) =>
			mode === 'uri' ? (a.uri < b.uri ? -1 : a.uri > b.uri ? 1 : 0) : a.createdAt.localeCompare(b.createdAt)
		);
		sorted.forEach((s, i) => posOf.set(s, i + 1));
	}
	const acc = new Map<number, { score: number; votes: number; n: number }>();
	for (const s of subs) {
		const pos = posOf.get(s)!;
		const a = acc.get(pos) ?? { score: 0, votes: 0, n: 0 };
		a.score += s.totalPts;
		a.votes += s.votesReceived;
		a.n += 1;
		acc.set(pos, a);
	}
	return [...acc.entries()]
		.sort((x, y) => x[0] - y[0])
		.map(([pos, a]) => ({
			pos,
			avgScore: a.score / a.n,
			avgVotes: a.votes / a.n,
			rounds: a.n,
		}));
}

// ---------------------------------------------------------------------------
// Fun stats

export interface SimpleStat {
	idx: number;
	avg: number;
	/** Votes counted toward the average. */
	used: number;
	/** All votes cast (generosity). */
	cast?: number;
	total?: number;
}

function songTotals(votes: Vote[]): Map<number, number> {
	const m = new Map<number, number>();
	for (const v of votes) m.set(v.songIdx, (m.get(v.songIdx) ?? 0) + v.pts);
	return m;
}

/** Contrarian: avg total score of songs voted for (non-zero votes only). */
export function computeContrarian(votes: Vote[], nComps: number): SimpleStat[] {
	const totals = songTotals(votes);
	const acc = Array.from({ length: nComps }, () => ({ sum: 0, used: 0 }));
	for (const v of votes) {
		if (v.pts === 0) continue;
		acc[v.voterIdx].sum += totals.get(v.songIdx) ?? 0;
		acc[v.voterIdx].used += 1;
	}
	return acc.map((a, idx) => ({ idx, avg: a.used ? a.sum / a.used : 0, used: a.used }));
}

/** Generosity: avg points per vote cast, zeros included. */
export function computeGenerosity(votes: Vote[], nComps: number): SimpleStat[] {
	const acc = Array.from({ length: nComps }, () => ({ sum: 0, cast: 0 }));
	for (const v of votes) {
		acc[v.voterIdx].sum += v.pts;
		acc[v.voterIdx].cast += 1;
	}
	return acc.map((a, idx) => ({ idx, avg: a.cast ? a.sum / a.cast : 0, used: a.cast, cast: a.cast, total: a.sum }));
}

export interface EagernessStat {
	idx: number;
	overall: number | null;
	sub: number | null;
	vote: number | null;
}

/** Percentile-style eagerness: 100 = always first, 0 = always last. */
export function computeEagerness(subs: Sub[], votes: Vote[], nComps: number): EagernessStat[] {
	const pct = (n: number, i: number) => (n > 1 ? ((n - 1 - i) / (n - 1)) * 100 : null);

	const byRoundSub = new Map<number, Sub[]>();
	for (const s of subs) byRoundSub.set(s.roundIdx, [...(byRoundSub.get(s.roundIdx) ?? []), s]);
	const subPct = new Map<Sub, number | null>();
	for (const arr of byRoundSub.values()) {
		const sorted = [...arr].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
		sorted.forEach((s, i) => subPct.set(s, pct(sorted.length, i)));
	}
	const subAcc = Array.from({ length: nComps }, () => ({ sum: 0, n: 0 }));
	for (const s of subs) {
		const p = subPct.get(s);
		if (p == null) continue;
		subAcc[s.compIdx].sum += p;
		subAcc[s.compIdx].n += 1;
	}

	const fv = new Map<number, Map<number, string>>();
	for (const v of votes) {
		let m = fv.get(v.roundIdx);
		if (!m) fv.set(v.roundIdx, (m = new Map()));
		const cur = m.get(v.voterIdx);
		if (cur == null || v.createdAt < cur) m.set(v.voterIdx, v.createdAt);
	}
	const voteAcc = Array.from({ length: nComps }, () => ({ sum: 0, n: 0 }));
	for (const m of fv.values()) {
		const arr = [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
		arr.forEach(([compIdx, ts], i) => {
			const p = pct(arr.length, i);
			if (p == null) return;
			voteAcc[compIdx].sum += p;
			voteAcc[compIdx].n += 1;
		});
	}

	const out: EagernessStat[] = [];
	for (let i = 0; i < nComps; i++) {
		const s = subAcc[i].n ? subAcc[i].sum / subAcc[i].n : null;
		const v = voteAcc[i].n ? voteAcc[i].sum / voteAcc[i].n : null;
		const overall = s != null && v != null ? (s + v) / 2 : (s ?? v);
		out.push({ idx: i, overall, sub: s, vote: v });
	}
	return out;
}

// ---------------------------------------------------------------------------
// Songs / artists tables

export interface SongRow extends Sub {
	roundName: string;
	compName: string;
	posUri: number;
	posChrono: number;
}

export function computeSongs(
	subs: Sub[],
	rounds: RoundInfo[],
	comps: Comp[]
): SongRow[] {
	const spansSeasons = new Set(rounds.map((round) => round.seasonNumber)).size > 1;
	const byRound = new Map<number, Sub[]>();
	for (const s of subs) byRound.set(s.roundIdx, [...(byRound.get(s.roundIdx) ?? []), s]);
	const posUri = new Map<Sub, number>();
	const posChrono = new Map<Sub, number>();
	for (const arr of byRound.values()) {
		[...arr].sort((a, b) => (a.uri < b.uri ? -1 : a.uri > b.uri ? 1 : 0)).forEach((s, i) => posUri.set(s, i + 1));
		[...arr].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).forEach((s, i) => posChrono.set(s, i + 1));
	}
	return subs
		.map((s) => ({
			...s,
			roundName: rounds[s.roundIdx]
				? `${spansSeasons ? `S${rounds[s.roundIdx].seasonNumber} · ` : ''}${rounds[s.roundIdx].name}`
				: '',
			compName: comps[s.compIdx]?.name ?? '',
			posUri: posUri.get(s) ?? 0,
			posChrono: posChrono.get(s) ?? 0,
		}))
		.sort((a, b) => b.totalPts - a.totalPts);
}

export interface ArtistRow {
	artist: string;
	subs: number;
	totalPts: number;
	avgPts: number;
	best: string;
}

export function computeArtists(songs: SongRow[]): ArtistRow[] {
	const m = new Map<string, { subs: number; total: number; best: { pts: number; name: string } }>();
	for (const s of songs) {
		for (const raw of s.artists.length ? s.artists : ['Unknown']) {
			const key = raw.trim();
			if (!key) continue;
			const a = m.get(key) ?? { subs: 0, total: 0, best: { pts: -Infinity, name: '' } };
			a.subs += 1;
			a.total += s.totalPts;
			if (s.totalPts > a.best.pts) a.best = { pts: s.totalPts, name: s.roundName };
			m.set(key, a);
		}
	}
	return [...m.entries()]
		.map(([artist, a]) => ({ artist, subs: a.subs, totalPts: a.total, avgPts: a.total / a.subs, best: a.best.name }))
		.sort((x, y) => y.totalPts - x.totalPts);
}
