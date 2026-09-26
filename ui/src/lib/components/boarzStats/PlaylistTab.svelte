<script lang="ts">
	import type { PositionMode } from '$lib/server/boarzStats/stats.js';
	import type { Snapshot } from '$lib/server/boarzStats/data.js';
	import ChartCanvas from './ChartCanvas.svelte';

	let { snap }: { snap: Snapshot } = $props();

	type Mode = PositionMode;
	let mode = $state<Mode>('uri');

	const points = $derived(snap.position[mode]);

	const biasConfig = $derived({
		type: 'line',
		data: {
			labels: points.map((p) => `#${p.pos}`),
			datasets: [
				{
					label: 'Avg total points',
					data: points.map((p) => p.avgScore),
					borderColor: '#a78bfa',
					backgroundColor: 'rgba(167,139,250,0.2)',
					fill: true,
					tension: 0.3,
					yAxisID: 'y',
				},
				{
					label: 'Songs at this slot',
					data: points.map((p) => p.rounds),
					type: 'bar' as const,
					backgroundColor: 'rgba(45,212,191,0.35)',
					yAxisID: 'y1',
				},
			],
		},
		options: {
			responsive: true,
			maintainAspectRatio: false,
			scales: {
				y: { title: { display: true, text: 'Avg total points received' } },
				y1: { position: 'right' as const, title: { display: true, text: 'Sample size' }, grid: { drawOnChartArea: false } },
				x: { title: { display: true, text: 'Playlist slot' } },
			},
		},
	});
</script>

<div class="space-y-6">
	<section class="rounded-2xl border border-border-muted bg-surface/50 p-5">
		<div class="mb-3 flex flex-wrap items-center justify-between gap-2">
			<h2 class="text-lg font-semibold">📍 Playlist Position Bias</h2>
			<div class="flex gap-1 rounded-lg border border-border-muted p-1">
				<button
					type="button"
					class="rounded-md px-3 py-1 text-sm {mode === 'uri' ? 'bg-fg text-bg font-semibold' : 'text-fg-muted'}"
					onclick={() => (mode = 'uri')}
				>
					Alphabetical (Spotify URI)
				</button>
				<button
					type="button"
					class="rounded-md px-3 py-1 text-sm {mode === 'chrono' ? 'bg-fg text-bg font-semibold' : 'text-fg-muted'}"
					onclick={() => (mode = 'chrono')}
				>
					Submission order
				</button>
			</div>
		</div>
		<p class="mb-4 text-sm text-fg-muted">
			{#if mode === 'uri'}
				Slot = position in the playlist when ordered alphabetically by Spotify URI (the Music League
				playlist order). Does listing early or late change your score?
			{:else}
				Slot = the order songs were submitted in. Compare with the alphabetical view to test the
				ordering theory.
			{/if}
		</p>
		<ChartCanvas height={340} config={biasConfig} />
	</section>

	<section class="rounded-2xl border border-border-muted bg-surface/50 p-5">
		<h2 class="mb-4 text-lg font-semibold">Full breakdown</h2>
		<div class="overflow-x-auto">
			<table class="w-full text-sm">
				<thead>
					<tr class="text-left text-fg-muted">
						<th class="px-3 py-2">Slot</th>
						<th class="px-3 py-2 text-right">Avg total points</th>
						<th class="px-3 py-2 text-right">Avg votes received</th>
						<th class="px-3 py-2 text-right">Sample</th>
					</tr>
				</thead>
				<tbody>
					{#each points as p (p.pos)}
						<tr class="border-t border-border-muted">
							<td class="px-3 py-2 font-mono">#{p.pos}</td>
							<td class="px-3 py-2 text-right font-mono">{p.avgScore.toFixed(2)}</td>
							<td class="px-3 py-2 text-right font-mono">{p.avgVotes.toFixed(1)}</td>
							<td class="px-3 py-2 text-right font-mono text-fg-muted">{p.rounds}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>
</div>
