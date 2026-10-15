<script lang="ts">
	import type { Snapshot } from '$lib/server/boarzStats/data.js';
	import { type DaySummary } from '$lib/boarzStats/shared.js';
	import { onMount } from 'svelte';
	import ChartCanvas from './ChartCanvas.svelte';
	import HowToRead from './HowToRead.svelte';

	let { snap }: { snap: Snapshot } = $props();

	const chat = snap.chat;
	const colors = snap.colors;
	const people = chat.people;
	const personColor = (i: number) => (i < snap.competitors.length ? colors[i % colors.length] : '#64748b');

	let summaries = $state<Record<string, DaySummary>>({});
	onMount(async () => {
		if (snap.league.slug !== 'boarz-ii-men') return;
		try {
			const res = await fetch('/boarz-stats/api/day-topics');
			const data = (await res.json()) as { summaries?: Record<string, DaySummary> };
			summaries = data.summaries ?? {};
		} catch {
			/* topic summaries are decorative — fail quiet */
		}
	});

	// --- daily activity: total vs stacked-by-participant ----------------------
	type ActMode = 'people' | 'total';
	let actMode = $state<ActMode>('people');

	const actLabels = snap.activity.map((d) => d.day.slice(5));
	const actByDayPeople = new Map(chat.timelineByPerson.map((t) => [t.day, t.byKey]));

	const votesDataset = {
		label: 'ML votes',
		data: snap.activity.map((d) => d.votes),
		type: 'bar' as const,
		backgroundColor: 'rgba(45,212,191,0.3)',
		yAxisID: 'y1',
	};
	const commentsDataset = {
		label: 'Vote comments',
		data: snap.activity.map((d) => d.voteComments),
		borderColor: '#f472b6',
		backgroundColor: '#f472b6',
		tension: 0.3,
		pointRadius: 2,
		yAxisID: 'y1',
	};

	const activityConfig = $derived.by(() => {
		const personDatasets = people.map((p, i) => ({
			label: p.display,
			data: snap.activity.map((d) => actMode === 'people' ? (actByDayPeople.get(d.day)?.[p.key] ?? 0) : 0),
			borderColor: personColor(i),
			backgroundColor: personColor(i),
			fill: true,
			pointRadius: 0,
			tension: 0.25,
			yAxisID: 'y',
		}));
		const totalDataset = {
			label: 'WhatsApp msgs',
			data: snap.activity.map((d) => d.chat),
			borderColor: '#818cf8',
			backgroundColor: 'rgba(129,140,248,0.2)',
			fill: true,
			tension: 0.25,
			pointRadius: snap.activity.map((d) => (chat.peaks.some((p) => p.day === d.day) ? 4 : 0)),
			pointBackgroundColor: '#fbbf24',
			pointHoverRadius: 7,
			yAxisID: 'y',
		};
		// peak dots overlay for the stacked view (gold dots at daily totals)
		const peakDataset = {
			label: 'Peak day',
			data: snap.activity.map((d) => (chat.peaks.some((p) => p.day === d.day) ? d.chat : null)),
			type: 'scatter' as const,
			pointStyle: 'circle' as const,
			pointRadius: 5,
			pointBackgroundColor: '#fbbf24',
			pointBorderColor: 'rgba(10,10,20,0.9)',
			pointBorderWidth: 1.5,
			showLine: false,
			yAxisID: 'y',
		};
		return {
			type: 'line',
			data: {
				labels: actLabels,
				datasets: actMode === 'people' ? [...personDatasets, peakDataset, votesDataset, commentsDataset] : [totalDataset, votesDataset, commentsDataset],
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				interaction: { mode: 'index' as const, intersect: false },
				scales: {
					y: actMode === 'people'
						? { stacked: true, beginAtZero: true, title: { display: true, text: 'Messages by participant' } }
						: {
							type: 'logarithmic' as const,
							min: 10,
							title: { display: true, text: 'WhatsApp messages (log scale)' },
							ticks: { callback: (v: number) => (v === 10 || v === 100 || v === 250 || v === 500 || v === 1000 ? String(v) : '') },
						},
					y1: { position: 'right' as const, grid: { drawOnChartArea: false }, beginAtZero: true, title: { display: true, text: 'ML votes / comments' } },
					x: { ticks: { autoSkip: true, maxTicksLimit: 14 }, stacked: actMode === 'people' },
				},
				plugins: {
					legend: {
						display: actMode === 'people',
						labels: { boxWidth: 10, boxHeight: 10 },
					},
					tooltip: {
						callbacks: {
							afterBody: (items: { dataIndex: number }[]) => {
								const day = snap.activity[items[0]?.dataIndex]?.day;
								const s = day ? summaries[day] : undefined;
								return s?.topics?.length ? '\n' + s.topics.map((t) => '• ' + t).join('\n') : '';
							},
						},
					},
				},
			},
		};
	});
</script>

<div class="rounded-2xl border border-border-muted bg-surface/50 p-5">
	<div class="mb-3 flex flex-wrap items-center justify-between gap-2">
		<h2 class="text-lg font-semibold">📅 Daily Activity — chat vs Music League</h2>
		<div class="flex gap-1 rounded-lg border border-border-muted p-1">
			<button
				type="button"
				class="rounded-md px-3 py-1 text-sm {actMode === 'people' ? 'bg-fg text-bg font-semibold' : 'text-fg-muted'}"
				onclick={() => (actMode = 'people')}
			>
				By participant
			</button>
			<button
				type="button"
				class="rounded-md px-3 py-1 text-sm {actMode === 'total' ? 'bg-fg text-bg font-semibold' : 'text-fg-muted'}"
				onclick={() => (actMode = 'total')}
			>
				Total (log)
			</button>
		</div>
	</div>
	<p class="mb-4 text-sm text-fg-muted">
		{#if actMode === 'people'}
			Each day's group-chat messages, stacked and colored by who sent them, with Music League votes and
			vote comments per day on the right axis. Gold dots mark the busiest days — hover a dot for what
			people were talking about.
		{:else}
			Chat messages per day (left axis, log scale) against Music League votes and vote comments per day
			(right axis). Gold dots mark the busiest chat days — hover a dot for what people were talking about.
		{/if}
	</p>
	<ChartCanvas height={320} config={activityConfig} zoomable zoomMode="x" />
	<HowToRead
		items={[
			['Across', 'Calendar days (Central time) from the start of this season to today.'],
			['By participant', 'Messages per day, stacked by sender — the taller a color band, the more that person talked that day.'],
			['Total (log)', 'All chat messages per day on the left axis. Log scale: each gridline is ten times the one below, so quiet days stay visible next to huge ones.'],
			['ML votes / comments', 'Lines on the right axis, both views: how many Music League votes and written vote comments were cast that day. Chat spikes that line up with these are voting-night chatter.'],
			['Gold dots / peak days', 'Days busier than the days around them. The summaries below each are AI-written topic lists from that day\'s messages.'],
			['Zoom', 'Drag or pinch on the chart to zoom into a stretch of days.'],
		]}
	/>
	{#if chat.peaks.length}
		<div class="mt-4 space-y-2">
			{#each chat.peaks as pk (pk.day)}
				<div class="rounded-xl border border-border-muted px-3 py-2 text-sm">
					<span class="font-semibold text-amber-400">{pk.day.slice(5)}</span>
					<span class="text-fg-muted"> · {pk.count} msgs · </span>
					{#if summaries[pk.day]?.topics?.length}
						{summaries[pk.day].topics.join(' · ')}
					{:else}
						<span class="text-fg-muted italic">summarizing…</span>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>
