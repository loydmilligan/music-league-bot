<script lang="ts">
	import type { Snapshot } from '$lib/server/boarzStats/data.js';
	import ChartCanvas from './ChartCanvas.svelte';

	let { snap }: { snap: Snapshot } = $props();

	const comps = snap.competitors;
	const colors = snap.colors;

	function hbar(stats: { avg: number }[], labels: string[], label: string) {
		return {
			type: 'bar',
			data: {
				labels,
				datasets: [{ label, data: stats.map((s) => s.avg), backgroundColor: colors.slice(0, stats.length) }],
			},
			options: {
				indexAxis: 'y' as const,
				responsive: true,
				maintainAspectRatio: false,
				plugins: { legend: { display: false } },
			},
		};
	}

	const contrarianSorted = [...snap.contrarian].sort((a, b) => a.avg - b.avg);
	const contrarianConfig = hbar(
		contrarianSorted,
		contrarianSorted.map((c) => comps[c.idx].name),
		'Avg song score'
	);

	const eagernessSorted = [...snap.eagerness]
		.filter((e) => e.overall != null)
		.sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0));
	const eagerConfig = {
		type: 'bar',
		data: {
			labels: eagernessSorted.map((e) => comps[e.idx].name),
			datasets: [
				{
					label: 'Overall',
					data: eagernessSorted.map((e) => e.overall),
					backgroundColor: eagernessSorted.map((_, i) => {
						const t = i / Math.max(1, eagernessSorted.length - 1);
						return `rgba(${Math.round(96 + t * 100)}, ${Math.round(165 - t * 80)}, ${Math.round(250 - t * 90)}, 0.85)`;
					}),
				},
			],
		},
		options: {
			indexAxis: 'y' as const,
			responsive: true,
			maintainAspectRatio: false,
			plugins: { legend: { display: false } },
			scales: { x: { title: { display: true, text: '% — 100 = always first' } } },
		},
	};

	const subSorted = [...snap.eagerness].sort((a, b) => (b.sub ?? 0) - (a.sub ?? 0));
	const subConfig = {
		type: 'bar',
		data: {
			labels: subSorted.map((e) => comps[e.idx].name),
			datasets: [{ label: 'Submission eagerness', data: subSorted.map((e) => e.sub), backgroundColor: '#2dd4bf' }],
		},
		options: {
			indexAxis: 'y' as const,
			responsive: true,
			maintainAspectRatio: false,
			plugins: { legend: { display: false } },
		},
	};

	const voteSorted = [...snap.eagerness].sort((a, b) => (b.vote ?? 0) - (a.vote ?? 0));
	const voteConfig = {
		type: 'bar',
		data: {
			labels: voteSorted.map((e) => comps[e.idx].name),
			datasets: [{ label: 'Voting promptness', data: voteSorted.map((e) => e.vote), backgroundColor: '#f472b6' }],
		},
		options: {
			indexAxis: 'y' as const,
			responsive: true,
			maintainAspectRatio: false,
			plugins: { legend: { display: false } },
		},
	};
</script>

<div class="space-y-6">
	<section class="rounded-2xl border border-border-muted bg-surface/50 p-5">
		<h2 class="mb-1 text-lg font-semibold">🦎 Contrarian Score</h2>
		<p class="mb-4 text-sm text-fg-muted">
			Average total score of songs each player voted for (non-zero votes only). Lower = more contrarian
			taste; higher = more mainstream.
		</p>
		<ChartCanvas height={340} config={contrarianConfig} />
		<div class="mt-4 overflow-x-auto">
			<table class="w-full text-sm">
				<thead>
					<tr class="text-left text-fg-muted">
						<th class="px-3 py-2">#</th>
						<th class="px-3 py-2">Player</th>
						<th class="px-3 py-2 text-right">Avg song score</th>
						<th class="px-3 py-2 text-right">Votes cast</th>
					</tr>
				</thead>
				<tbody>
					{#each contrarianSorted as c, i (c.idx)}
						<tr class="border-t border-border-muted">
							<td class="px-3 py-2 text-fg-muted">{i + 1}</td>
							<td class="px-3 py-2 font-medium" style="color: {colors[c.idx % colors.length]}">{comps[c.idx].name}</td>
							<td class="px-3 py-2 text-right font-mono">{c.avg.toFixed(2)}</td>
							<td class="px-3 py-2 text-right font-mono text-fg-muted">{c.used}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>

	<section class="rounded-2xl border border-border-muted bg-surface/50 p-5">
		<h2 class="mb-1 text-lg font-semibold">⚡ Overall Eagerness</h2>
		<p class="mb-4 text-sm text-fg-muted">
			Average of submission eagerness and voting promptness. How early each player tends to engage with a
			round compared to the rest of the league.
		</p>
		<ChartCanvas height={340} config={eagerConfig} />
		<div class="mt-6 grid gap-6 md:grid-cols-2">
			<div>
				<h3 class="mb-2 font-medium">🎵 Submission Eagerness</h3>
				<ChartCanvas height={300} config={subConfig} />
			</div>
			<div>
				<h3 class="mb-2 font-medium">🗳️ Voting Promptness</h3>
				<ChartCanvas height={300} config={voteConfig} />
			</div>
		</div>
		<div class="mt-4 overflow-x-auto">
			<table class="w-full text-sm">
				<thead>
					<tr class="text-left text-fg-muted">
						<th class="px-3 py-2">#</th>
						<th class="px-3 py-2">Player</th>
						<th class="px-3 py-2 text-right">Overall</th>
						<th class="px-3 py-2 text-right">Submission</th>
						<th class="px-3 py-2 text-right">Voting</th>
					</tr>
				</thead>
				<tbody>
					{#each eagernessSorted as e, i (e.idx)}
						<tr class="border-t border-border-muted">
							<td class="px-3 py-2 text-fg-muted">{i + 1}</td>
							<td class="px-3 py-2 font-medium" style="color: {colors[e.idx % colors.length]}">{comps[e.idx].name}</td>
							<td class="px-3 py-2 text-right font-mono">{e.overall?.toFixed(1) ?? '—'}</td>
							<td class="px-3 py-2 text-right font-mono text-fg-muted">{e.sub?.toFixed(1) ?? '—'}</td>
							<td class="px-3 py-2 text-right font-mono text-fg-muted">{e.vote?.toFixed(1) ?? '—'}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>
</div>
