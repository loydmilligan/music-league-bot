<script lang="ts">
	import type { Snapshot } from '$lib/server/boarzStats/data.js';
	import ChartCanvas from './ChartCanvas.svelte';

	let { snap }: { snap: Snapshot } = $props();

	const top = snap.artists.slice(0, 15);
	const barConfig = {
		type: 'bar',
		data: {
			labels: top.map((a) => (a.artist.length > 20 ? a.artist.slice(0, 19) + '…' : a.artist)),
			datasets: [
				{
					label: 'Total points',
					data: top.map((a) => a.totalPts),
					backgroundColor: '#a78bfa',
				},
			],
		},
		options: {
			indexAxis: 'y' as const,
			responsive: true,
			maintainAspectRatio: false,
			plugins: { legend: { display: false } },
			scales: { x: { title: { display: true, text: 'Total points' } } },
		},
	};
</script>

<div class="space-y-6">
	<section class="rounded-2xl border border-border-muted bg-surface/50 p-5">
		<h2 class="mb-1 text-lg font-semibold">🎤 Top Artists</h2>
		<p class="mb-4 text-sm text-fg-muted">Most-submitted artists across the league.</p>
		<ChartCanvas height={480} config={barConfig} />
	</section>

	<section class="rounded-2xl border border-border-muted bg-surface/50 p-5">
		<h2 class="mb-4 text-lg font-semibold">All artists</h2>
		<div class="overflow-x-auto">
			<table class="w-full text-sm">
				<thead>
					<tr class="text-left text-fg-muted">
						<th class="px-3 py-2">#</th>
						<th class="px-3 py-2">Artist</th>
						<th class="px-3 py-2 text-right">Submissions</th>
						<th class="px-3 py-2 text-right">Total pts</th>
						<th class="px-3 py-2 text-right">Avg pts</th>
						<th class="px-3 py-2">Best round</th>
					</tr>
				</thead>
				<tbody>
					{#each snap.artists as a, i (a.artist)}
						<tr class="border-t border-border-muted">
							<td class="px-3 py-2 text-fg-muted">{i + 1}</td>
							<td class="px-3 py-2 font-medium">{a.artist}</td>
							<td class="px-3 py-2 text-right font-mono">{a.subs}</td>
							<td class="px-3 py-2 text-right font-mono">{a.totalPts}</td>
							<td class="px-3 py-2 text-right font-mono">{a.avgPts.toFixed(1)}</td>
							<td class="px-3 py-2 text-fg-muted">{a.best}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>
</div>
