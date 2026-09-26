<script lang="ts">
	import type { Snapshot } from '$lib/server/boarzStats/data.js';
	import ChartCanvas from './ChartCanvas.svelte';

	let { snap }: { snap: Snapshot } = $props();

	const comps = snap.competitors;
	const colors = snap.colors;

	let selected = $state<number | 'all'>('all');
	const shown = $derived(selected === 'all' ? comps.map((_, i) => i) : [selected]);

	const spansSeasons = new Set(snap.rounds.map((round) => round.seasonNumber)).size > 1;
	const roundNames = snap.rounds.map((round) => {
		const label = `${spansSeasons ? `S${round.seasonNumber} · ` : ''}${round.name}`;
		return label.length > 17 ? label.slice(0, 16) + '…' : label;
	});

	const scoresConfig = $derived({
		type: 'line',
		data: {
			labels: roundNames,
			datasets: shown.map((i) => ({
				label: comps[i].name,
				data: snap.scores.map((r) => r[i]),
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
				y: { title: { display: true, text: 'Points earned' } },
				x: { ticks: { maxRotation: 40, minRotation: 0 } },
			},
			plugins: { legend: { position: 'right' as const } },
		},
	});

	const cumConfig = $derived({
		type: 'line',
		data: {
			labels: roundNames,
			datasets: shown.map((i) => ({
				label: comps[i].name,
				data: snap.cumulative.map((r) => r[i]),
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
				y: { title: { display: true, text: 'Cumulative points' } },
				x: { ticks: { maxRotation: 40, minRotation: 0 } },
			},
			plugins: { legend: { position: 'right' as const } },
		},
	});

	// per-round winner strip
	const winners = snap.scores.map((r) => {
		let best = -Infinity;
		let who = -1;
		r.forEach((v, i) => {
			if (v > best) {
				best = v;
				who = i;
			}
		});
		return { who, best };
	});
</script>

<div class="space-y-6">
	<section class="rounded-2xl border border-border-muted bg-surface/50 p-5">
		<div class="mb-3 flex flex-wrap items-center justify-between gap-2">
			<h2 class="text-lg font-semibold">📈 Round-by-Round Scores</h2>
			<select
				class="rounded-lg border border-border-muted bg-surface px-3 py-1.5 text-sm"
				bind:value={selected}
			>
				<option value={'all'}>All players</option>
				{#each comps as c, i (c.id)}
					<option value={i}>{c.name}</option>
				{/each}
			</select>
		</div>
		<p class="mb-4 text-sm text-fg-muted">Points earned per round.</p>
		<ChartCanvas height={380} config={scoresConfig} zoomable zoomMode="x" />
	</section>

	<section class="rounded-2xl border border-border-muted bg-surface/50 p-5">
		<h2 class="mb-1 text-lg font-semibold">🧮 Cumulative Race</h2>
		<p class="mb-4 text-sm text-fg-muted">Running total after each round.</p>
		<ChartCanvas height={380} config={cumConfig} zoomable zoomMode="x" />
	</section>

	<section class="rounded-2xl border border-border-muted bg-surface/50 p-5">
		<h2 class="mb-1 text-lg font-semibold">🏅 Round winners</h2>
		<div class="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
			{#each snap.rounds as r, i (r.id)}
				<div class="rounded-xl border border-border-muted bg-surface/50 p-3">
					<div class="truncate text-xs text-fg-muted" title={r.name}>{r.name}</div>
					<div class="mt-1 font-semibold" style="color: {colors[winners[i].who]}">
						{comps[winners[i].who]?.name}
					</div>
					<div class="font-mono text-sm text-fg-muted">{winners[i].best} pts</div>
				</div>
			{/each}
		</div>
	</section>
</div>
