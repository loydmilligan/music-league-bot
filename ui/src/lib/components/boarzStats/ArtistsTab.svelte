<script lang="ts">
	import type { Snapshot } from '$lib/server/boarzStats/data.js';
	import ChartCanvas from './ChartCanvas.svelte';

	let { snap }: { snap: Snapshot } = $props();
	let artistSort = $state<'name' | 'subs' | 'points' | 'average'>('points');
	let artistAscending = $state(false);
	const artistRows = $derived([...snap.artists].sort((a, b) => {
		const delta = artistSort === 'name' ? a.artist.localeCompare(b.artist) : artistSort === 'subs' ? a.subs - b.subs : artistSort === 'average' ? a.avgPts - b.avgPts : a.totalPts - b.totalPts;
		return (artistAscending ? 1 : -1) * delta;
	}));
	function sortArtists(key: typeof artistSort) { if (artistSort === key) artistAscending = !artistAscending; else { artistSort = key; artistAscending = key === 'name'; } }

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

	<details class="rounded-2xl border border-border-muted bg-surface/50 p-5">
		<summary class="cursor-pointer list-none text-lg font-semibold">All artists <span class="ml-2 text-xs font-normal text-fg-muted">Show artist totals and best round</span></summary>
		<div class="overflow-x-auto">
			<table class="w-full text-sm">
				<thead>
					<tr class="text-left text-fg-muted">
						<th class="px-3 py-2">#</th>
						<th class="px-3 py-2"><button onclick={() => sortArtists('name')}>Artist {artistSort === 'name' ? (artistAscending ? '↑' : '↓') : '↕'}</button></th>
						<th class="px-3 py-2 text-right"><button onclick={() => sortArtists('subs')}>Submissions {artistSort === 'subs' ? (artistAscending ? '↑' : '↓') : '↕'}</button></th>
						<th class="px-3 py-2 text-right"><button onclick={() => sortArtists('points')}>Total pts {artistSort === 'points' ? (artistAscending ? '↑' : '↓') : '↕'}</button></th>
						<th class="px-3 py-2 text-right"><button onclick={() => sortArtists('average')}>Avg pts {artistSort === 'average' ? (artistAscending ? '↑' : '↓') : '↕'}</button></th>
						<th class="px-3 py-2">Best round</th>
					</tr>
				</thead>
				<tbody>
					{#each artistRows as a, i (a.artist)}
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
	</details>
</div>
