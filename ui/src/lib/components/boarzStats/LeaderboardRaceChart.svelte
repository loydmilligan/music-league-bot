<script lang="ts">
	import HowToRead from './HowToRead.svelte';
	import { flip } from 'svelte/animate';
	import type { Snapshot } from '$lib/server/boarzStats/data.js';

	let { snap }: { snap: Snapshot } = $props();

	const comps = snap.competitors;
	const colors = snap.colors;
	const spansSeasons = new Set(snap.rounds.map((round) => round.seasonNumber)).size > 1;
	const roundLabel = (round: (typeof snap.rounds)[number]) =>
		`${spansSeasons ? `S${round.seasonNumber} · ` : ''}${round.name}`;

	// --- leaderboard race (moved verbatim from LeaderboardTab) -----------------
	const raceRows = $derived(
		comps
			.map((c, i) => ({ c, i, cum: snap.cumulative.map((r) => r[i] ?? 0) }))
			.sort((a, b) => b.cum[b.cum.length - 1] - a.cum[a.cum.length - 1] || a.c.name.localeCompare(b.c.name))
	);
	// Only rounds that have been played: the season's future rounds are in the
	// snapshot too, and starting the slider on the last scheduled round read as
	// "Round 12 of 12" after round one. Played = results recorded, or anyone's
	// total moved (older imports lack votingEnded).
	const played = snap.rounds.map((round, i) =>
		!!round.votingEnded || snap.cumulative[i]?.some((v, c) => v !== (i > 0 ? (snap.cumulative[i - 1]?.[c] ?? 0) : 0)),
	);
	const lastPlayed = played.lastIndexOf(true);
	const R = Math.max(1, lastPlayed + 1);
	const totalRounds = snap.rounds.length;
	const maxTotal = Math.max(...raceRows.map((r) => r.cum[R - 1]), 1);

	let raceIdx = $state(R - 1);
	let racePlaying = $state(false);
	let fixedRankSlots = $state(false);
	let raceTimer: ReturnType<typeof setInterval> | null = null;

	function raceRank(pi: number, r: number): number {
		// Ties break by display order so the rank column always reads 1,2,3 down
		// the list (comp-index tiebreak showed "3" above "2" on equal points).
		const totals = raceRows.map((row, pos) => ({ t: row.cum[r] ?? 0, comp: row.i, pos }));
		const sorted = [...totals].sort((a, b) => b.t - a.t || a.pos - b.pos);
		return sorted.findIndex((o) => o.comp === pi) + 1;
	}
	function stopRace() {
		if (raceTimer) { clearInterval(raceTimer); raceTimer = null; }
		racePlaying = false;
	}
	function toggleRace() {
		if (racePlaying) { stopRace(); return; }
		if (raceIdx >= R - 1) raceIdx = 0;
		racePlaying = true;
		raceTimer = setInterval(() => {
			if (raceIdx >= R - 1) { stopRace(); return; }
			raceIdx += 1;
		}, 1600);
	}
	$effect(() => () => stopRace());

	const raceDisplayRows = $derived(fixedRankSlots
		? [...raceRows].sort((a, b) => (b.cum[raceIdx] ?? 0) - (a.cum[raceIdx] ?? 0) || a.c.name.localeCompare(b.c.name))
		: raceRows);
</script>

<section class="rounded-2xl border border-border-muted bg-surface/50 p-5">
	<h2 class="mb-1 text-lg font-semibold">🏁 Leaderboard Race</h2>
	<p class="mb-4 text-sm text-fg-muted">
		An animated race through the season — bars grow as points accumulate. Drag the slider to scrub or
		press play.
	</p>
	<div class="space-y-2">
		{#each raceDisplayRows as row, ri (row.c.id)}
			{@const total = row.cum[raceIdx] ?? 0}
			{@const rank = fixedRankSlots ? ri + 1 : raceRank(row.i, raceIdx)}
			<div class="race-row" animate:flip={{ duration: 450 }}>
				<span class="race-rank" class:lead={rank === 1}>{rank}</span>
				<span class="race-name" title={row.c.name} style="color: {colors[row.i % colors.length]}">{row.c.name}</span>
				<span class="race-track">
					<span
						class="race-fill"
						class:striped={ri % 2 === 1}
						style="width: {(total / maxTotal) * 100}%; background: {colors[row.i % colors.length]}"
					></span>
				</span>
				<span class="race-val">{total}</span>
			</div>
		{/each}
	</div>
	<div class="mt-4 flex items-center gap-3">
		<label class="flex items-center gap-2 whitespace-nowrap text-xs text-fg-muted"><input type="checkbox" bind:checked={fixedRankSlots} /> Keep rank slots fixed</label>
		<button
			type="button"
			class="rounded-lg border border-border-muted px-3 py-1.5 text-sm transition-colors hover:bg-surface"
			onclick={toggleRace}
		>
			{racePlaying ? '⏸ Pause' : '▶ Play'}
		</button>
		<input type="range" min="0" max={R - 1} bind:value={raceIdx} oninput={stopRace} class="h-1.5 flex-1 accent-violet-400" />
		<span class="whitespace-nowrap text-xs text-fg-muted">
			Round {raceIdx + 1} of {R} played{totalRounds > R ? ` (${totalRounds} this season)` : ''} — {roundLabel(snap.rounds[raceIdx])}
		</span>
	</div>
	<HowToRead items={[
		['Bars', 'Each player\'s running season total: every round\'s points (upvotes received minus downvotes received) added up, as of the round shown.'],
		['Rank (left)', 'Position after that round. Gold = in the lead.'],
		['Number (right)', 'Season points so far.'],
		['Slider / Play', 'Scrub or play through the season round by round and watch the order shuffle.'],
		['Keep rank slots fixed', 'Off: rows re-sort as the lead changes. On: rows stay put and only the bars move, which is easier to follow one person.'],
		['Stripes', 'Every other bar is striped just to tell neighbors apart. It doesn\'t mean anything.'],
	]} />
</section>

<style>
	.race-row { display: grid; grid-template-columns: 28px minmax(90px, 170px) 1fr 52px; align-items: center; gap: 10px; }
	.race-rank { text-align: center; font-weight: 700; font-size: 13px; color: var(--color-fg-muted, #94a3b8); }
	.race-rank.lead { color: #fbbf24; }
	.race-name { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.race-track { display: block; height: 18px; background: rgba(148, 163, 184, 0.08); border-radius: 9px; overflow: hidden; }
	.race-fill { display: block; height: 100%; border-radius: 9px; transition: width 0.6s ease; opacity: 0.9; }
	.race-fill.striped {
		background-image: linear-gradient(45deg, rgba(255,255,255,0.22) 25%, transparent 25%, transparent 50%, rgba(255,255,255,0.22) 50%, rgba(255,255,255,0.22) 75%, transparent 75%, transparent);
		background-size: 14px 14px;
	}
	.race-val { font-variant-numeric: tabular-nums; font-weight: 700; font-size: 13px; text-align: right; }
</style>
