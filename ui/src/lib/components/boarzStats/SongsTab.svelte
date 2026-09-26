<script lang="ts">
	import type { Snapshot } from '$lib/server/boarzStats/data.js';
	import ChartCanvas from './ChartCanvas.svelte';

	let { snap }: { snap: Snapshot } = $props();

	const colors = snap.colors;

	const top = snap.songs.slice(0, 15);
	const barConfig = {
		type: 'bar',
		data: {
			labels: top.map((s) => (s.title.length > 22 ? s.title.slice(0, 21) + '…' : s.title)),
			datasets: [
				{
					label: 'Total points',
					data: top.map((s) => s.totalPts),
					backgroundColor: top.map((s) => colors[s.roundIdx % colors.length]),
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
		<h2 class="mb-1 text-lg font-semibold">🎵 Top Songs</h2>
		<p class="mb-4 text-sm text-fg-muted">Top 15 by total points received. Bar color = round.</p>
		<ChartCanvas height={520} config={barConfig} />
	</section>

	<section class="rounded-2xl border border-border-muted bg-surface/50 p-5">
		<h2 class="mb-4 text-lg font-semibold">All songs</h2>
		<div class="overflow-x-auto">
			<table class="w-full text-sm">
				<thead>
					<tr class="text-left text-fg-muted">
						<th class="px-3 py-2">#</th>
						<th class="px-3 py-2">Song</th>
						<th class="px-3 py-2">Artist</th>
						<th class="px-3 py-2">Submitter</th>
						<th class="px-3 py-2">Round</th>
						<th class="px-3 py-2 text-right">Pts</th>
						<th class="px-3 py-2 text-right">Votes</th>
					</tr>
				</thead>
				<tbody>
					{#each snap.songs as s, i (s.roundIdx + '-' + s.uri)}
						<tr class="border-t border-border-muted">
							<td class="px-3 py-2 text-fg-muted">{i + 1}</td>
							<td class="px-3 py-2">
								<span class="flex items-center gap-2">
									{#if s.art}
										<img src={s.art} alt="" class="h-8 w-8 rounded" loading="lazy" />
									{/if}
									{s.title}
								</span>
							</td>
							<td class="px-3 py-2 text-fg-muted">{s.artists.join(', ')}</td>
							<td class="px-3 py-2" style="color: {colors[s.compIdx % colors.length]}">{s.compName}</td>
							<td class="px-3 py-2 text-fg-muted" title={s.roundName}>
								{s.roundName.length > 18 ? s.roundName.slice(0, 17) + '…' : s.roundName}
							</td>
							<td class="px-3 py-2 text-right font-mono">{s.totalPts}</td>
							<td class="px-3 py-2 text-right font-mono text-fg-muted">{s.votesReceived}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>
</div>
