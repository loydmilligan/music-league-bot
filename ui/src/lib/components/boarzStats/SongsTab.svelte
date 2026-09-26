<script lang="ts">
	import type { Snapshot } from '$lib/server/boarzStats/data.js';
	import ChartCanvas from './ChartCanvas.svelte';

	let { snap }: { snap: Snapshot } = $props();

	const colors = snap.colors;
	let songSort = $state<'title' | 'artist' | 'submitter' | 'round' | 'points' | 'votes'>('points');
	let songAscending = $state(false);
	const songRows = $derived([...snap.songs].sort((a, b) => {
		const delta = songSort === 'title' ? a.title.localeCompare(b.title) : songSort === 'artist' ? a.artists.join(', ').localeCompare(b.artists.join(', ')) : songSort === 'submitter' ? a.compName.localeCompare(b.compName) : songSort === 'round' ? a.roundName.localeCompare(b.roundName) : songSort === 'votes' ? a.votesReceived - b.votesReceived : a.totalPts - b.totalPts;
		return (songAscending ? 1 : -1) * delta;
	}));
	function sortSongs(key: typeof songSort) { if (songSort === key) songAscending = !songAscending; else { songSort = key; songAscending = key === 'title' || key === 'artist' || key === 'submitter' || key === 'round'; } }

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
			onClick: (_event: any, elements: { index: number }[]) => {
				const song = top[elements[0]?.index ?? -1];
				if (song?.spotifyUrl) window.open(song.spotifyUrl, '_blank', 'noopener,noreferrer');
			},
			plugins: {
				legend: { display: false },
				tooltip: { callbacks: { title: (items: { dataIndex: number }[]) => {
					const song = top[items[0]?.dataIndex ?? -1];
					return song ? `${song.title} — ${song.artists.join(', ')} (click to open Spotify)` : '';
				} } },
			},
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

	<details class="rounded-2xl border border-border-muted bg-surface/50 p-5">
		<summary class="cursor-pointer list-none text-lg font-semibold">All songs <span class="ml-2 text-xs font-normal text-fg-muted">Show song, artist, player, and round details</span></summary>
		<div class="overflow-x-auto">
			<table class="w-full text-sm">
				<thead>
					<tr class="text-left text-fg-muted">
						<th class="px-3 py-2">#</th>
						<th class="px-3 py-2"><button onclick={() => sortSongs('title')}>Song {songSort === 'title' ? (songAscending ? '↑' : '↓') : '↕'}</button></th>
						<th class="px-3 py-2"><button onclick={() => sortSongs('artist')}>Artist {songSort === 'artist' ? (songAscending ? '↑' : '↓') : '↕'}</button></th>
						<th class="px-3 py-2"><button onclick={() => sortSongs('submitter')}>Submitter {songSort === 'submitter' ? (songAscending ? '↑' : '↓') : '↕'}</button></th>
						<th class="px-3 py-2"><button onclick={() => sortSongs('round')}>Round {songSort === 'round' ? (songAscending ? '↑' : '↓') : '↕'}</button></th>
						<th class="px-3 py-2 text-right"><button onclick={() => sortSongs('points')}>Pts {songSort === 'points' ? (songAscending ? '↑' : '↓') : '↕'}</button></th>
						<th class="px-3 py-2 text-right"><button onclick={() => sortSongs('votes')}>Votes {songSort === 'votes' ? (songAscending ? '↑' : '↓') : '↕'}</button></th>
					</tr>
				</thead>
				<tbody>
					{#each songRows as s, i (s.roundIdx + '-' + s.uri)}
						<tr class="border-t border-border-muted">
							<td class="px-3 py-2 text-fg-muted">{i + 1}</td>
							<td class="px-3 py-2">
								<span class="flex items-center gap-2">
									{#if s.art}
										<img src={s.art} alt="" class="h-8 w-8 rounded" loading="lazy" />
									{/if}
									<span class="flex flex-wrap gap-2">
										{#if s.spotifyUrl}<a href={s.spotifyUrl} target="_blank" rel="noreferrer" title="Open {s.title} by {s.artists.join(', ')} in Spotify" class="underline decoration-dotted hover:text-accent">{s.title}</a>{:else}<span title="{s.title} by {s.artists.join(', ')}">{s.title}</span>{/if}
										{#if s.ytmUrl}<a href={s.ytmUrl} target="_blank" rel="noreferrer" title="Open {s.title} by {s.artists.join(', ')} on YouTube Music" aria-label="YouTube Music">▶</a>{/if}
									</span>
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
	</details>
</div>
