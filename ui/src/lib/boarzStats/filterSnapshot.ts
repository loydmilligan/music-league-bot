import type { Snapshot } from '$lib/server/boarzStats/data.js';

function positionsFor(cumulative: number[][]): number[][] {
	return cumulative.map((totals) => {
		const order = totals.map((total, idx) => ({ total, idx }))
			.sort((a, b) => b.total - a.total || a.idx - b.idx);
		const positions = new Array<number>(totals.length).fill(0);
		order.forEach((row, rank) => (positions[row.idx] = rank + 1));
		return positions;
	});
}

/**
 * Focus competition visuals on a player subset without mutating the server
 * snapshot. Chat remains league-wide: aliases and conversation context make a
 * partial-chat view actively misleading.
 */
export function filterSnapshotPlayers(snapshot: Snapshot, playerIds: number[]): Snapshot {
	if (playerIds.length === 0 || playerIds.length === snapshot.competitors.length) return snapshot;
	const wanted = new Set(playerIds);
	const oldIndexes = snapshot.competitors
		.map((competitor, idx) => ({ competitor, idx }))
		.filter(({ competitor }) => wanted.has(competitor.id));
	if (oldIndexes.length === 0) return snapshot;

	const oldToNew = new Map(oldIndexes.map(({ idx }, next) => [idx, next]));
	const competitors = oldIndexes.map(({ competitor }) => competitor);
	const colors = oldIndexes.map(({ idx }) => snapshot.colors[idx % snapshot.colors.length]);
	const scores = snapshot.scores.map((row) => oldIndexes.map(({ idx }) => row[idx] ?? 0));
	const cumulative = snapshot.cumulative.map((row) => oldIndexes.map(({ idx }) => row[idx] ?? 0));
	const positions = positionsFor(cumulative);

	const subs = snapshot.subs
		.filter((sub) => oldToNew.has(sub.compIdx))
		.map((sub) => ({ ...sub, compIdx: oldToNew.get(sub.compIdx)! }));
	const keptSongIndexes = new Map<number, number>();
	snapshot.subs.forEach((sub, oldSongIdx) => {
		if (oldToNew.has(sub.compIdx)) keptSongIndexes.set(oldSongIdx, keptSongIndexes.size);
	});
	const votes = snapshot.votes
		.filter((vote) => oldToNew.has(vote.voterIdx) && keptSongIndexes.has(vote.songIdx))
		.map((vote) => ({
			...vote,
			voterIdx: oldToNew.get(vote.voterIdx)!,
			songIdx: keptSongIndexes.get(vote.songIdx)!,
		}));
	const pickMatrix = <T>(matrix: T[][]): T[][] =>
		oldIndexes.map(({ idx: row }) => oldIndexes.map(({ idx: col }) => matrix[row][col]));
	const remapIndexed = <T extends { idx: number }>(rows: T[]): T[] => rows
		.filter((row) => oldToNew.has(row.idx))
		.map((row) => ({ ...row, idx: oldToNew.get(row.idx)! }));
	const playerNames = new Set(competitors.map((competitor) => competitor.name));
	const songs = snapshot.songs
		.filter((song) => playerNames.has(song.compName))
		.map((song) => ({ ...song, compIdx: oldToNew.get(song.compIdx)! }));
	const artistsByName = new Map<string, { subs: number; totalPts: number; best: string; bestPts: number }>();
	for (const song of songs) {
		for (const artist of song.artists.length ? song.artists : ['Unknown']) {
			const value = artistsByName.get(artist) ?? { subs: 0, totalPts: 0, best: '', bestPts: -Infinity };
			value.subs += 1;
			value.totalPts += song.totalPts;
			if (song.totalPts > value.bestPts) {
				value.best = song.roundName;
				value.bestPts = song.totalPts;
			}
			artistsByName.set(artist, value);
		}
	}
	const artists = [...artistsByName.entries()]
		.map(([artist, value]) => ({
			artist,
			subs: value.subs,
			totalPts: value.totalPts,
			avgPts: value.totalPts / value.subs,
			best: value.best,
		}))
		.sort((a, b) => b.totalPts - a.totalPts);

	return {
		...snapshot,
		colors,
		competitors,
		scores,
		cumulative,
		positions,
		subs,
		votes,
		heat: {
			raw: pickMatrix(snapshot.heat.raw),
			norm: pickMatrix(snapshot.heat.norm),
			both: pickMatrix(snapshot.heat.both),
		},
		contrarian: remapIndexed(snapshot.contrarian),
		generosity: remapIndexed(snapshot.generosity),
		eagerness: remapIndexed(snapshot.eagerness),
		songs,
		artists,
		hype: snapshot.hype.filter((row) => row.submitter == null || playerNames.has(row.submitter)),
	};
}
