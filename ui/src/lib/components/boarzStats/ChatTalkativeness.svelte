<script lang="ts">
	import type { Snapshot } from '$lib/server/boarzStats/data.js';
	import { AXIS_META } from '$lib/boarzStats/shared.js';
	import ChartCanvas from './ChartCanvas.svelte';

	let { snap }: { snap: Snapshot } = $props();

	const chat = snap.chat;
	const colors = snap.colors;
	const people = chat.people;
	const personColor = (i: number) => (i < snap.competitors.length ? colors[i % colors.length] : '#64748b');

	const talk = [...people].sort((a, b) => b.msgs - a.msgs);
	const talkConfig = {
		type: 'bar',
		data: {
			labels: talk.map((p) => p.display),
			datasets: [
				{
					label: 'Messages',
					data: talk.map((p) => p.msgs),
					backgroundColor: talk.map((p) => personColor(people.indexOf(p))),
				},
			],
		},
		options: {
			indexAxis: 'y' as const,
			responsive: true,
			maintainAspectRatio: false,
			plugins: { legend: { display: false } },
		},
	};

	const quad = chat.quadrant;
	const axisMetaA = AXIS_META[quad.axisA];
	const axisMetaB = AXIS_META[quad.axisB];
</script>

<section class="rounded-2xl border border-border-muted bg-surface/50 p-5">
	<h2 class="mb-1 text-lg font-semibold">💬 Talkativeness</h2>
	<p class="mb-4 text-sm text-fg-muted">
		Messages, words per message, CAPS %, emoji %. Everyone in the group chat — including non-competing
		friends.
	</p>
	<ChartCanvas height={340} config={talkConfig} />
	<div class="mt-4 overflow-x-auto">
		<table class="w-full text-sm">
			<thead>
				<tr class="text-left text-fg-muted">
					<th class="px-3 py-2">Person</th>
					<th class="px-3 py-2 text-right">Msgs</th>
					<th class="px-3 py-2 text-right">Words/msg</th>
					<th class="px-3 py-2 text-right">CAPS %</th>
					<th class="px-3 py-2 text-right">Emoji %</th>
					<th class="px-3 py-2 text-right">Tone</th>
					<th class="px-3 py-2 text-right">{axisMetaA.label} / {axisMetaB.label}</th>
					<th class="px-3 py-2">Vocabulary (lift)</th>
				</tr>
			</thead>
			<tbody>
				{#each talk as p (p.key)}
					<tr class="border-t border-border-muted">
						<td class="px-3 py-2 font-medium" style="color: {personColor(people.indexOf(p))}">
							{p.display}{p.competitorId == null ? ' (guest)' : ''}
						</td>
						<td class="px-3 py-2 text-right font-mono">{p.msgs}</td>
						<td class="px-3 py-2 text-right font-mono">{p.wpm}</td>
						<td class="px-3 py-2 text-right font-mono">{p.capsPct}%</td>
						<td class="px-3 py-2 text-right font-mono">{p.emojiPct}%</td>
						<td class="px-3 py-2 text-right font-mono" class:text-rose-400={p.toneAvg < 0} class:text-emerald-400={p.toneAvg > 0}>
							{p.toneAvg > 0 ? '+' : ''}{p.toneAvg}
						</td>
						<td class="px-3 py-2 text-right font-mono text-xs" title="{axisMetaA.label}: {p.react[quad.axisA]} · {axisMetaB.label}: {p.react[quad.axisB]} · {p.react.rated} rated messages">
							{p.react[quad.axisA] == null ? '—' : p.react[quad.axisA]!.toFixed(1)}/{p.react[quad.axisB] == null ? '—' : p.react[quad.axisB]!.toFixed(1)}
						</td>
						<td class="px-3 py-2 text-fg-muted">
							{p.topWords.slice(0, 5).map((t) => t.w).join(' · ')}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</section>
