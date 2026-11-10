<script lang="ts">
	import type { Snapshot } from '$lib/server/boarzStats/data.js';
	import { AXIS_META } from '$lib/boarzStats/shared.js';
	import ChartCanvas from './ChartCanvas.svelte';
	import HowToRead from './HowToRead.svelte';

	// `fromDay` (a round's first stats day, as in ChatDailyActivity) adds a "This round"
	// view of the bars, counted from that day to the end of the snapshot. The table
	// below stays season-wide: style stats need the whole season to mean anything.
	let { snap, fromDay = null, toDay = null }: { snap: Snapshot; fromDay?: string | null; toDay?: string | null } = $props();

	const chat = snap.chat;
	const colors = snap.colors;
	const people = chat.people;
	const personColor = (i: number) => (i < snap.competitors.length ? colors[i % colors.length] : '#64748b');

	const talk = [...people].sort((a, b) => b.msgs - a.msgs);

	const weekMsgs = new Map<string, number>();
	if (fromDay) {
		for (const t of chat.timelineByPerson) {
			if (t.day < fromDay || (toDay && t.day > toDay)) continue;
			for (const [k, n] of Object.entries(t.byKey)) weekMsgs.set(k, (weekMsgs.get(k) ?? 0) + n);
		}
	}
	const weekTotal = [...weekMsgs.values()].reduce((a, b) => a + b, 0);
	const hasWeek = weekTotal > 0;
	let barMode = $state<'week' | 'season'>(hasWeek ? 'week' : 'season');
	const fmtDay = (d: string) =>
		new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

	const talkConfig = $derived.by(() => {
		const count = (p: (typeof people)[number]) => (barMode === 'week' ? (weekMsgs.get(p.key) ?? 0) : p.msgs);
		const rows = [...people].filter((p) => count(p) > 0).sort((a, b) => count(b) - count(a));
		return {
			type: 'bar',
			data: {
				labels: rows.map((p) => p.display),
				datasets: [
					{
						label: barMode === 'week' ? 'Messages this round' : 'Messages this season',
						data: rows.map(count),
						backgroundColor: rows.map((p) => personColor(people.indexOf(p))),
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
	});

	const quad = chat.quadrant;
	const axisMetaA = AXIS_META[quad.axisA];
	const axisMetaB = AXIS_META[quad.axisB];

	const TIPS = {
		msgs: 'Messages posted in the group chat this season so far.',
		wpm: 'Average words per message. High = paragraphs; low = one-liners.',
		caps: 'Share of all letters they typed in CAPITALS. Shouting index.',
		emoji: 'Share of their messages that contain at least one emoji.',
		tone: 'Average mood per message, from −3 to +3: positive words/emoji (lol, love, banger, 🔥 😂 👍) minus negative ones (mid, trash, awful, 👎 💩). Above 0 = upbeat, below 0 = salty.',
		lift: 'Words this person uses far more often than everyone else does (at least 5 uses). Their verbal fingerprint.',
	};
	const tipAxes = `How the replies to their messages score on the two reaction axes that vary most across the league this season (${axisMetaA.label}: ${axisMetaA.low} → ${axisMetaA.high}; ${axisMetaB.label}: ${axisMetaB.low} → ${axisMetaB.high}). Each runs −1 to +1; 0 is neutral. See Reaction Quadrant under More chat stats.`;
	const howTo: [string, string][] = [
		['Bars', 'Total messages each person posted in the group chat this season.'],
		['Msgs', TIPS.msgs],
		['Words/msg', TIPS.wpm],
		['CAPS %', TIPS.caps],
		['Emoji %', TIPS.emoji],
		['Tone', TIPS.tone],
		[`${axisMetaA.label} / ${axisMetaB.label}`, tipAxes],
		['Signature words', TIPS.lift],
		['Guest', 'In the chat but hasn\'t submitted or voted in this league this season (yet).'],
	];
</script>

<section class="rounded-2xl border border-border-muted bg-surface/50 p-5">
	<div class="mb-1 flex flex-wrap items-center justify-between gap-2">
		<h2 class="text-lg font-semibold">💬 Talkativeness</h2>
		{#if hasWeek}
			<div class="flex gap-1 rounded-lg border border-border-muted p-1">
				<button
					type="button"
					class="rounded-md px-3 py-1 text-sm {barMode === 'week' ? 'bg-fg text-bg font-semibold' : 'text-fg-muted'}"
					onclick={() => (barMode = 'week')}
				>
					This round
				</button>
				<button
					type="button"
					class="rounded-md px-3 py-1 text-sm {barMode === 'season' ? 'bg-fg text-bg font-semibold' : 'text-fg-muted'}"
					onclick={() => (barMode = 'season')}
				>
					Season
				</button>
			</div>
		{/if}
	</div>
	<p class="mb-4 text-sm text-fg-muted">
		{#if barMode === 'week' && fromDay}
			Messages this round, {fmtDay(fromDay)}{toDay ? `–${fmtDay(toDay)}` : ' on'}: {weekTotal.toLocaleString('en-US')} in all. The table below covers the whole season.
		{:else}
			How much each person talks, and how. The bars are total messages; the table breaks down their style.
		{/if}
		Everyone in the group chat counts, including anyone who hasn't played this season yet (marked “guest”).
	</p>
	{#key barMode}<ChartCanvas height={340} config={talkConfig} />{/key}
	<div class="mt-4 overflow-x-auto">
		<table class="w-full text-sm">
			<thead>
				<tr class="text-left text-fg-muted">
					<th class="px-3 py-2">Person</th>
					<th class="px-3 py-2 text-right" title={TIPS.msgs}>Msgs ⓘ</th>
					<th class="px-3 py-2 text-right" title={TIPS.wpm}>Words/msg ⓘ</th>
					<th class="px-3 py-2 text-right" title={TIPS.caps}>CAPS % ⓘ</th>
					<th class="px-3 py-2 text-right" title={TIPS.emoji}>Emoji % ⓘ</th>
					<th class="px-3 py-2 text-right" title={TIPS.tone}>Tone ⓘ</th>
					<th class="px-3 py-2 text-right" title={tipAxes}>{axisMetaA.label} / {axisMetaB.label} ⓘ</th>
					<th class="px-3 py-2" title={TIPS.lift}>Signature words ⓘ</th>
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
	<HowToRead items={howTo} />
</section>
