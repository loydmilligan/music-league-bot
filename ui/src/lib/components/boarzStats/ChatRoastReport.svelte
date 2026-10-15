<script lang="ts">
	import type { Snapshot } from '$lib/server/boarzStats/data.js';
	import ChartCanvas from './ChartCanvas.svelte';
	import HowToRead from './HowToRead.svelte';

	let { snap }: { snap: Snapshot } = $props();

	const chat = snap.chat;
	const colors = snap.colors;
	const people = chat.people;
	const personColor = (i: number) => (i < snap.competitors.length ? colors[i % colors.length] : '#64748b');

	const roastTotal = people.map((_, j) => chat.roastMatrix.reduce((a, row) => a + (row[j] ?? 0), 0));
	const mostRoasted = people
		.map((p, j) => ({ name: p.display, count: roastTotal[j] }))
		.sort((a, b) => b.count - a.count)
		.slice(0, 5);
	const roastConfig = {
		type: 'bar',
		data: {
			labels: mostRoasted.map((m) => m.name),
			datasets: [{ label: 'Times mentioned by others', data: mostRoasted.map((m) => m.count), backgroundColor: '#fb7185' }],
		},
		options: { indexAxis: 'y' as const, responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } },
	};
</script>

<section class="rounded-2xl border border-border-muted bg-surface/50 p-5">
	<h2 class="mb-1 text-lg font-semibold">🔥 Roast Report</h2>
	<p class="mb-4 text-sm text-fg-muted">
		Who gets talked about. Every time someone's name or nickname comes up in another person's message, it
		counts — roast or not. Left: the five most-mentioned people. Right: who mentions whom.
	</p>
	<div class="grid gap-6 md:grid-cols-2">
		<div>
			<ChartCanvas height={260} config={roastConfig} />
		</div>
		<div class="overflow-x-auto">
			<table class="border-separate text-xs" style="border-spacing: 2px">
				<thead>
					<tr>
						<th class="p-1"></th>
						{#each people as p (p.key)}
							<th class="p-1 text-fg-muted" title={p.display}>{p.display.slice(0, 4)}</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each people as row, i (row.key)}
						<tr>
							<th class="whitespace-nowrap p-1 text-right" style="color: {personColor(i)}">{row.display}</th>
							{#each people as _, j (j)}
								{@const v = chat.roastMatrix[i][j] ?? 0}
								<td
									class="rounded p-1 text-center font-mono"
									style="background: {i === j ? 'transparent' : v ? `rgba(251,113,133,${Math.min(0.85, 0.15 + (v / Math.max(...roastTotal, 1)) * 0.7).toFixed(2)})` : 'transparent'}"
									title="{row.display} mentions {people[j].display}: {v}"
								>
									{i === j ? '—' : v || ''}
								</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>
	<HowToRead
		items={[
			['Bars', 'Total times each person was mentioned by someone else this season. Top five only.'],
			['Mentions', 'Names and nicknames both count — Conor or CJ, Dave or Jensen, Berto, Mashew or Matt, and so on. Mentioning yourself doesn\'t.'],
			['Grid rows', 'The person doing the talking.'],
			['Grid columns', 'The person being talked about (first four letters of their name; hover for the full name).'],
			['Cell number', 'How many of the row person\'s messages mention the column person. Darker red = more.'],
		]}
	/>
</section>
