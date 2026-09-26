<script lang="ts">
	import type { Snapshot } from '$lib/server/boarzStats/data.js';
	import ChartCanvas from './ChartCanvas.svelte';

	let { snap }: { snap: Snapshot } = $props();

	const comps = snap.competitors;
	const colors = snap.colors;

	const genSorted = [...snap.generosity].sort((a, b) => b.avg - a.avg);
	const generosityConfig = {
		type: 'bar',
		data: {
			labels: genSorted.map((g) => comps[g.idx].name),
			datasets: [
				{
					label: 'Avg pts/vote',
					data: genSorted.map((g) => g.avg),
					backgroundColor: genSorted.map((_, i) => {
						// pink→violet gradient by rank, like mlstats
						const t = i / Math.max(1, genSorted.length - 1);
						return `rgba(${Math.round(236 - t * 80)}, ${Math.round(72 - t * 0)}, ${Math.round(153 - t * 20)}, 0.85)`;
					}),
				},
			],
		},
		options: {
			indexAxis: 'y' as const,
			responsive: true,
			maintainAspectRatio: false,
			plugins: { legend: { display: false } },
			scales: { x: { title: { display: true, text: 'Avg points per vote' } } },
		},
	};

	const spreadConfig = {
		type: 'bar',
		data: {
			labels: snap.spread.map((s) => String(s.pts)),
			datasets: [
				{
					label: 'Votes',
					data: snap.spread.map((s) => s.count),
					backgroundColor: snap.spread.map((s) => (s.pts < 0 ? 'rgba(251,113,133,0.8)' : 'rgba(167,139,250,0.8)')),
				},
			],
		},
		options: {
			responsive: true,
			maintainAspectRatio: false,
			plugins: {
				legend: { display: false },
				title: { display: true, text: 'Vote spread — how often each point value is awarded' },
			},
			scales: {
				x: { title: { display: true, text: 'Point value' } },
				y: { title: { display: true, text: 'Times awarded' } },
			},
		},
	};

	const given = [...snap.generosity].sort((a, b) => (b.total ?? 0) - (a.total ?? 0));
</script>

<div class="space-y-6">
	<section class="rounded-2xl border border-border-muted bg-surface/50 p-5">
		<h2 class="mb-1 text-lg font-semibold">💙 Voter Generosity</h2>
		<p class="mb-4 text-sm text-fg-muted">Average points awarded per vote (zeros included), ranked highest to lowest.</p>
		<ChartCanvas height={340} config={generosityConfig} />
	</section>

	<section class="rounded-2xl border border-border-muted bg-surface/50 p-5">
		<h2 class="mb-4 text-lg font-semibold">🎲 Vote Spread</h2>
		<ChartCanvas height={280} config={spreadConfig} />
	</section>

	<details class="rounded-2xl border border-border-muted bg-surface/50 p-5">
		<summary class="cursor-pointer list-none text-lg font-semibold">Full breakdown <span class="ml-2 text-xs font-normal text-fg-muted">Show exact values</span></summary>
		<div class="overflow-x-auto">
			<table class="w-full text-sm">
				<thead>
					<tr class="text-left text-fg-muted">
						<th class="px-3 py-2">#</th>
						<th class="px-3 py-2">Player</th>
						<th class="px-3 py-2 text-right">Avg pts/vote</th>
						<th class="px-3 py-2 text-right">Total given</th>
						<th class="px-3 py-2 text-right">Votes cast</th>
					</tr>
				</thead>
				<tbody>
					{#each given as g, i (g.idx)}
						<tr class="border-t border-border-muted">
							<td class="px-3 py-2 text-fg-muted">{i + 1}</td>
							<td class="px-3 py-2 font-medium" style="color: {colors[g.idx % colors.length]}">{comps[g.idx].name}</td>
							<td class="px-3 py-2 text-right font-mono">{g.avg.toFixed(2)}</td>
							<td class="px-3 py-2 text-right font-mono">{g.total}</td>
							<td class="px-3 py-2 text-right font-mono text-fg-muted">{g.cast}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</details>
</div>
