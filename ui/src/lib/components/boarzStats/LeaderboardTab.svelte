<script lang="ts">
	import type { Snapshot } from '$lib/server/boarzStats/data.js';
	import ChartCanvas from './ChartCanvas.svelte';

	let { snap }: { snap: Snapshot } = $props();

	const comps = snap.competitors;
	const colors = snap.colors;
	const medal = ['🥇', '🥈', '🥉'];
	const spansSeasons = new Set(snap.rounds.map((round) => round.seasonNumber)).size > 1;
	const roundLabel = (round: (typeof snap.rounds)[number]) =>
		`${spansSeasons ? `S${round.seasonNumber} · ` : ''}${round.name}`;

	const last = snap.cumulative[snap.cumulative.length - 1] ?? [];
	const roundsPlayed = comps.map((_, i) =>
		snap.rounds.filter((r) => snap.subs.some((s) => s.roundIdx === r.idx && s.compIdx === i)).length
	);

	const standings = comps
		.map((c, i) => ({
			name: c.name,
			color: colors[i],
			total: last[i] ?? 0,
			rounds: roundsPlayed[i],
			avg: roundsPlayed[i] ? (last[i] ?? 0) / roundsPlayed[i] : 0,
		}))
		.sort((a, b) => b.total - a.total);

	const positionConfig = {
		type: 'line',
		data: {
			labels: snap.rounds.map((round) => {
				const label = roundLabel(round);
				return label.length > 17 ? label.slice(0, 16) + '…' : label;
			}),
			datasets: comps.map((c, i) => ({
				label: c.name,
				data: snap.positions.map((p) => p[i]),
				borderColor: colors[i],
				backgroundColor: colors[i],
				tension: 0.25,
				pointRadius: 4,
				spanGaps: true,
			})),
		},
		options: {
			responsive: true,
			maintainAspectRatio: false,
			scales: {
				y: { reverse: true, min: 1, ticks: { stepSize: 1 }, title: { display: true, text: 'Position' } },
				x: { ticks: { maxRotation: 40, minRotation: 0 } },
			},
			plugins: { legend: { position: 'right' as const } },
		},
	};

	// --- standings heatmap (ported from music-league-stats) -------------------
	// rows ordered by final standing; cell = standing after that round
	const hmRows = $derived(
		comps
			.map((c, i) => ({ c, i, final: last[i] ?? 0 }))
			.sort((a, b) => b.final - a.final || a.c.name.localeCompare(b.c.name))
	);

	function rankColor(rank: number, n: number): string {
		// green (best) -> amber (middle) -> red (weakest)
		const stops = [
			[34, 197, 94],
			[234, 179, 8],
			[239, 68, 68],
		];
		const t = n <= 1 ? 0 : ((rank - 1) / (n - 1)) * (stops.length - 1);
		const i = Math.min(Math.floor(t), stops.length - 2);
		const f = t - i;
		const c = stops[i].map((v, k) => Math.round(v + (stops[i + 1][k] - v) * f));
		return `rgb(${c[0]},${c[1]},${c[2]})`;
	}

	function movementText(cur: number, prev: number | null): string {
		if (prev == null) return 'First round — no movement yet.';
		if (cur < prev) return `Moved up ${prev - cur} place${prev - cur > 1 ? 's' : ''}`;
		if (cur > prev) return `Dropped ${cur - prev} place${cur - prev > 1 ? 's' : ''}`;
		return `Held position (#${prev})`;
	}

	function hmTitle(pi: number, r: number): string {
		const standing = snap.positions[r][pi];
		const prev = r > 0 ? snap.positions[r - 1][pi] : null;
		const earned = snap.scores[r][pi] ?? 0;
		const cum = snap.cumulative[r][pi] ?? 0;
		return `${comps[pi].name} — Round ${r + 1} of ${snap.rounds.length} (${snap.rounds[r].name})\n`
			+ `Standing after this round: #${standing}\n`
			+ `Cumulative points: ${cum}\n`
			+ `Points earned this round: ${earned}\n`
			+ movementText(standing, prev);
	}

	let hotCol = $state<number | null>(null);
	let selRow = $state<number | null>(null);

	// --- leaderboard race (ported from music-league-stats) --------------------
	const raceRows = $derived(
		comps
			.map((c, i) => ({ c, i, cum: snap.cumulative.map((r) => r[i] ?? 0) }))
			.sort((a, b) => b.cum[b.cum.length - 1] - a.cum[a.cum.length - 1] || a.c.name.localeCompare(b.c.name))
	);
	const R = snap.rounds.length;
	const maxTotal = Math.max(...raceRows.map((r) => r.cum[R - 1]), 1);

	let raceIdx = $state(R - 1);
	let racePlaying = $state(false);
	let raceTimer: ReturnType<typeof setInterval> | null = null;

	function raceTotals(r: number): number[] {
		return raceRows.map((row) => row.cum[r] ?? 0);
	}
	function raceRank(pi: number, r: number): number {
		const totals = raceRows.map((row) => ({ t: row.cum[r] ?? 0, comp: row.i }));
		const sorted = [...totals].sort((a, b) => b.t - a.t || a.comp - b.comp);
		return sorted.findIndex((o) => o.comp === pi) + 1;
	}
	function stopRace() {
		if (raceTimer) {
			clearInterval(raceTimer);
			raceTimer = null;
		}
		racePlaying = false;
	}
	function toggleRace() {
		if (racePlaying) {
			stopRace();
			return;
		}
		if (raceIdx >= R - 1) raceIdx = 0;
		racePlaying = true;
		raceTimer = setInterval(() => {
			if (raceIdx >= R - 1) {
				stopRace();
				return;
			}
			raceIdx += 1;
		}, 1600);
	}
	$effect(() => () => stopRace());

	const raceTotalsNow = $derived(raceTotals(raceIdx));
</script>

<div class="space-y-6">
	<section class="rounded-2xl border border-border-muted bg-surface/50 p-5">
		<h2 class="mb-1 text-lg font-semibold">🏆 Standings</h2>
		<p class="mb-4 text-sm text-fg-muted">Cumulative points across all {snap.rounds.length} rounds.</p>
		<div class="overflow-x-auto">
			<table class="w-full text-sm">
				<thead>
					<tr class="text-left text-fg-muted">
						<th class="px-3 py-2">#</th>
						<th class="px-3 py-2">Player</th>
						<th class="px-3 py-2 text-right">Total</th>
						<th class="px-3 py-2 text-right">Rounds</th>
						<th class="px-3 py-2 text-right">Avg/round</th>
					</tr>
				</thead>
				<tbody>
					{#each standings as s, i (s.name)}
						<tr class="border-t border-border-muted">
							<td class="px-3 py-2">{medal[i] ?? i + 1}</td>
							<td class="px-3 py-2 font-medium" style="color: {s.color}">{s.name}</td>
							<td class="px-3 py-2 text-right font-mono">{s.total}</td>
							<td class="px-3 py-2 text-right font-mono">{s.rounds}</td>
							<td class="px-3 py-2 text-right font-mono">{s.avg.toFixed(1)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>

	<section class="rounded-2xl border border-border-muted bg-surface/50 p-5">
		<h2 class="mb-1 text-lg font-semibold">🗺️ Standings Heatmap</h2>
		<p class="mb-4 text-sm text-fg-muted">
			Each cell is a player's league position after that round — green leads, red trails. Hover a column
			to trace a round, click a player to spotlight their season.
		</p>
		<div class="overflow-x-auto">
			<table class="hm" class:focus={selRow != null}>
				<thead>
					<tr>
						<th class="hm-corner">Player</th>
						{#each snap.rounds as r, ri (r.id)}
							<th class="hm-th" class:hot={hotCol === ri}>
								<span title={r.name}>{r.name.slice(0, 2)}<span class="text-[9px] text-fg-muted">·{ri + 1}</span></span>
							</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each hmRows as row (row.c.id)}
						<tr class:sel={selRow === row.i}>
							<th class="hm-name" style="color: {colors[row.i % colors.length]}" onclick={() => (selRow = selRow === row.i ? null : row.i)}>
								{row.c.name}
							</th>
							{#each snap.rounds as r, ri (r.id)}
								{@const standing = snap.positions[ri][row.i]}
								<td
									class="hm-cell"
									class:rk1={standing === 1}
									class:hot={hotCol === ri}
									style="background: {rankColor(standing, comps.length)}"
									title={hmTitle(row.i, ri)}
									onmouseenter={() => (hotCol = ri)}
									onmouseleave={() => (hotCol = null)}
								>
									{standing}
								</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<div class="mt-3 flex items-center gap-2 text-xs text-fg-muted">
			<span>1st</span>
			<span class="h-3 w-40 rounded" style="background: linear-gradient(to right, rgb(34,197,94), rgb(234,179,8), rgb(239,68,68))"></span>
			<span>last ({comps.length})</span>
		</div>
	</section>

	<section class="rounded-2xl border border-border-muted bg-surface/50 p-5">
		<h2 class="mb-1 text-lg font-semibold">🏁 Leaderboard Race</h2>
		<p class="mb-4 text-sm text-fg-muted">
			An animated race through the season — bars grow as points accumulate. Drag the slider to scrub or
			press play.
		</p>
		<div class="space-y-2">
			{#each raceRows as row, ri (row.c.id)}
				{@const total = raceTotalsNow[ri]}
				{@const rank = raceRank(row.i, raceIdx)}
				<div class="race-row">
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
			<button
				type="button"
				class="rounded-lg border border-border-muted px-3 py-1.5 text-sm transition-colors hover:bg-surface"
				onclick={toggleRace}
			>
				{racePlaying ? '⏸ Pause' : '▶ Play'}
			</button>
			<input
				type="range"
				min="0"
				max={R - 1}
				bind:value={raceIdx}
				oninput={stopRace}
				class="h-1.5 flex-1 accent-violet-400"
			/>
			<span class="whitespace-nowrap text-xs text-fg-muted">
				Round {raceIdx + 1} of {R} — {roundLabel(snap.rounds[raceIdx])}
			</span>
		</div>
	</section>

	<section class="rounded-2xl border border-border-muted bg-surface/50 p-5">
		<h2 class="mb-1 text-lg font-semibold">🥇 Leaderboard Position by Round</h2>
		<p class="mb-4 text-sm text-fg-muted">Same story as the heatmap, as lines — 1st at the top.</p>
		<ChartCanvas height={340} config={positionConfig} zoomable zoomMode="x" />
	</section>
</div>

<style>
	.hm {
		border-collapse: separate;
		border-spacing: 2px;
		font-size: 12px;
	}
	.hm-corner {
		text-align: left;
		padding: 4px 8px;
		color: var(--color-fg-muted, #94a3b8);
		font-weight: 500;
	}
	.hm-th {
		padding: 2px;
		font-weight: 500;
		vertical-align: bottom;
	}
	.hm-th span {
		writing-mode: vertical-rl;
		transform: rotate(180deg);
		display: inline-block;
		max-height: 96px;
		overflow: hidden;
	}
	.hm-name {
		text-align: right;
		padding: 4px 8px;
		font-weight: 600;
		white-space: nowrap;
		cursor: pointer;
	}
	.hm-cell {
		padding: 5px 0;
		text-align: center;
		font-variant-numeric: tabular-nums;
		min-width: 34px;
		border-radius: 6px;
		color: rgba(10, 10, 20, 0.85);
		font-weight: 700;
		transition: filter 0.1s;
	}
	.hm-cell.rk1 {
		box-shadow: inset 0 0 0 2px #fbbf24;
	}
	.hm-cell.hot,
	.hm th.hot span {
		filter: brightness(1.3);
		outline: 1px solid rgba(255, 255, 255, 0.55);
		outline-offset: -1px;
	}
	.hm tbody tr:hover .hm-cell {
		filter: brightness(1.18);
	}
	.hm.focus tbody tr:not(.sel) {
		opacity: 0.25;
	}
	.hm tbody tr.sel .hm-name {
		color: #fbbf24 !important;
	}
	.race-row {
		display: grid;
		grid-template-columns: 28px minmax(90px, 170px) 1fr 52px;
		align-items: center;
		gap: 10px;
	}
	.race-rank {
		text-align: center;
		font-weight: 700;
		font-size: 13px;
		color: var(--color-fg-muted, #94a3b8);
	}
	.race-rank.lead {
		color: #fbbf24;
	}
	.race-name {
		font-size: 13px;
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.race-track {
		display: block;
		height: 18px;
		background: rgba(148, 163, 184, 0.08);
		border-radius: 9px;
		overflow: hidden;
	}
	.race-fill {
		display: block;
		height: 100%;
		border-radius: 9px;
		transition: width 0.6s ease;
		opacity: 0.9;
	}
	.race-fill.striped {
		background-image: linear-gradient(
			45deg,
			rgba(255, 255, 255, 0.22) 25%,
			transparent 25%,
			transparent 50%,
			rgba(255, 255, 255, 0.22) 50%,
			rgba(255, 255, 255, 0.22) 75%,
			transparent 75%,
			transparent
		);
		background-size: 14px 14px;
	}
	.race-val {
		font-variant-numeric: tabular-nums;
		font-weight: 700;
		font-size: 13px;
		text-align: right;
	}
</style>
