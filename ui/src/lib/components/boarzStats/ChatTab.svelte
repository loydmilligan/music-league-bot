<script lang="ts">
	import type { Snapshot } from '$lib/server/boarzStats/data.js';
	import { AXIS_META } from '$lib/boarzStats/shared.js';
	import ChartCanvas from './ChartCanvas.svelte';
	import HowToRead from './HowToRead.svelte';
	import PlayerFingerprint from './PlayerFingerprint.svelte';
	import ChatTalkativeness from './ChatTalkativeness.svelte';
	import ChatRoastReport from './ChatRoastReport.svelte';
	import ChatDailyActivity from './ChatDailyActivity.svelte';

	let { snap, omitHighlights = false }: { snap: Snapshot; omitHighlights?: boolean } = $props();

	const chat = snap.chat;
	const colors = snap.colors;
	const people = chat.people;
	const personColor = (i: number) => (i < snap.competitors.length ? colors[i % colors.length] : '#64748b');

	const hourLabels = Array.from({ length: 24 }, (_, h) => String(h));
	const hourConfig = {
		type: 'bar',
		data: {
			labels: hourLabels,
			datasets: [{ label: 'Messages', data: chat.hourOverall, backgroundColor: '#818cf8' }],
		},
		options: {
			responsive: true,
			maintainAspectRatio: false,
			plugins: {
				legend: { display: false },
				title: { display: true, text: 'Message volume by hour (local time)' },
			},
			scales: { x: { title: { display: true, text: 'Hour' } } },
		},
	};

	const nightOwl = [...people].sort(
		(a, b) => b.hourHist.slice(0, 5).reduce((x, y) => x + y, 0) - a.hourHist.slice(0, 5).reduce((x, y) => x + y, 0)
	)[0];

	// first in the chat
	const starterRows = [...people]
		.map((p) => ({ name: p.display, rounds: p.roundStarters, results: p.resultStarters }))
		.filter((p) => p.rounds + p.results > 0)
		.sort((a, b) => b.rounds + b.results - (a.rounds + a.results));
	const starterConfig = {
		type: 'bar',
		data: {
			labels: starterRows.map((p) => p.name),
			datasets: [
				{ label: 'Round drops', data: starterRows.map((p) => p.rounds), backgroundColor: '#2dd4bf' },
				{ label: 'Results posts', data: starterRows.map((p) => p.results), backgroundColor: '#fbbf24' },
			],
		},
		options: { responsive: true, maintainAspectRatio: false, scales: { x: { stacked: true } }, y: { stacked: true } },
	};

	// hype vs votes scatter
	const hypePts = snap.hype.filter((h) => h.totalPts != null);
	const hypeConfig = {
		type: 'bubble',
		data: {
			datasets: [
				{
					label: 'Chat-mentioned songs',
					data: hypePts.map((h) => ({ x: h.mentions, y: h.totalPts ?? 0, r: 4 + Math.min(10, h.mentions) * 2 })),
					backgroundColor: 'rgba(167,139,250,0.55)',
				},
			],
		},
		options: {
			responsive: true,
			maintainAspectRatio: false,
			plugins: { legend: { display: false }, title: { display: true, text: 'Chat mentions vs final score' } },
			scales: {
				x: { title: { display: true, text: 'Chat mentions' }, ticks: { stepSize: 1 } },
				y: { title: { display: true, text: 'Total points' } },
			},
		},
	};

	// lurker scatter: chat msgs vs ML actions
	const actions = snap.competitors.map((c, i) => {
		const subs = snap.subs.filter((s) => s.compIdx === i).length;
		const votes = snap.votes.filter((v) => v.voterIdx === i).length;
		return { name: c.name, idx: i, acts: subs + votes, msgs: people.find((p) => p.competitorId === c.id)?.msgs ?? 0 };
	});
	const lurkerConfig = {
		type: 'scatter',
		data: {
			datasets: [
				{
					label: 'Players',
					data: actions.map((a) => ({ x: a.acts, y: a.msgs })),
					backgroundColor: actions.map((a) => personColor(a.idx)),
					pointRadius: 7,
				},
			],
		},
		options: {
			responsive: true,
			maintainAspectRatio: false,
			plugins: {
				legend: { display: false },
				tooltip: {
					callbacks: {
						label: (ctx: { dataIndex: number }) => {
							const a = actions[ctx.dataIndex];
							return `${a.name}: ${a.msgs} msgs, ${a.acts} ML actions`;
						},
					},
				},
			},
			scales: {
				x: { title: { display: true, text: 'ML actions (subs + votes)' } },
				y: { title: { display: true, text: 'Chat messages' } },
			},
		},
	};

	const scrambleTotal = chat.scramble.reduce((a, s) => a + s.count, 0);
	const scrambleByPerson = chat.scramble.reduce<Record<string, number>>((acc, s) => {
		for (const [k, v] of Object.entries(s.byKey)) acc[k] = (acc[k] ?? 0) + v;
		return acc;
	}, {});
	const scrambleRows = Object.entries(scrambleByPerson)
		.map(([k, v]) => ({ name: people.find((p) => p.key === k)?.display ?? k, v }))
		.sort((a, b) => b.v - a.v);

	// reaction quadrant — the two axes with the biggest swing across players
	const quad = chat.quadrant;
	const axisMetaA = AXIS_META[quad.axisA];
	const axisMetaB = AXIS_META[quad.axisB];
	// Each axis scores a message by its next three replies (weights 3·2·1), −1 to +1.
	const AXIS_TIPS = {
		energy: 'Energy (−1 flat → +1 hype): how excited the replies to their messages are — emoji, lmao/haha, CAPS, !!!.',
		warmth: 'Warmth (−1 spicy → +1 warm): agreeing, affectionate replies (love, great, fair, legend) versus pushback (nah, wrong, mid, trash).',
		engagement: 'Engagement (−1 ignored → +1 lights up): how fast replies come and how many different people jump in.',
		momentum: 'Momentum (−1 kills it → +1 keeps it going): how much conversation keeps going after their message — how many more messages, and for how long.',
	};
	const paddedBounds = (values: number[], minimumSpan = 0.12) => {
		if (values.length === 0) return { min: -1, max: 1 };
		const low = Math.min(...values);
		const high = Math.max(...values);
		const span = Math.max(high - low, minimumSpan);
		const midpoint = (low + high) / 2;
		return { min: midpoint - span * 0.65, max: midpoint + span * 0.65 };
	};
	const quadX = paddedBounds(quad.points.map((point) => point.x));
	const quadY = paddedBounds(quad.points.map((point) => point.y));
	const quadConfig = {
		type: 'scatter',
		data: {
			datasets: [
				{
					label: 'Players',
					data: quad.points.map((p) => ({ x: p.x, y: p.y })),
					backgroundColor: quad.points.map((p) => personColor(people.findIndex((pp) => pp.key === p.key))),
					pointRadius: 9,
				},
			],
		},
		options: {
			responsive: true,
			maintainAspectRatio: false,
			plugins: {
				legend: { display: false },
				tooltip: {
					callbacks: {
						label: (ctx: { dataIndex: number }) => {
							const p = quad.points[ctx.dataIndex];
							return `${p.display} — ${p.n} rated messages`;
						},
					},
				},
			},
			scales: {
				x: {
					min: quadX.min,
					max: quadX.max,
					title: { display: true, text: `${axisMetaA.label} — low: ${axisMetaA.low} · high: ${axisMetaA.high}` },
					grid: { color: (c: { tick: { value: number } }) => (c.tick.value === 0 ? 'rgba(148,163,184,0.45)' : 'rgba(148,163,184,0.1)') },
				},
				y: {
					min: quadY.min,
					max: quadY.max,
					title: { display: true, text: `${axisMetaB.label} — low: ${axisMetaB.low} · high: ${axisMetaB.high}` },
					grid: { color: (c: { tick: { value: number } }) => (c.tick.value === 0 ? 'rgba(148,163,184,0.45)' : 'rgba(148,163,184,0.1)') },
				},
			},
		},
	};

	// --- Jev deep ratings ------------------------------------------------------
	const deep = snap.deep;
	const deepPlayers = $derived(deep?.players.filter((p) => p.msgsRated > 0) ?? []);
	const deepScatterPlayers = (deep?.players ?? []).filter(
		(p) => p.pctHeat != null && p.pctAffection != null && p.avgHeat != null && p.avgAffection != null
	);

	const deepScatterConfig = {
		type: 'scatter',
		data: {
			datasets: [
				{
					label: 'Players',
					data: deepScatterPlayers.map((p) => ({ x: p.pctHeat, y: p.pctAffection })),
					backgroundColor: deepScatterPlayers.map((p) => personColor(people.findIndex((pp) => pp.key === p.key))),
					pointRadius: 9,
				},
			],
		},
		options: {
			responsive: true,
			maintainAspectRatio: false,
			plugins: {
				legend: { display: false },
				tooltip: {
					callbacks: {
						label: (ctx: { dataIndex: number }) => {
							const p = deepScatterPlayers[ctx.dataIndex];
							return `${p.display} — heat ${p.avgHeat?.toFixed(2)}, affection ${p.avgAffection?.toFixed(2)}`;
						},
					},
				},
			},
			scales: {
				x: { title: { display: true, text: 'Heat — relative player range' }, min: -0.05, max: 1.05 },
				y: { title: { display: true, text: 'Affection — relative player range' }, min: -0.05, max: 1.05 },
			},
		},
	};

	const tagDefs = [
		{ key: 'shareReaction', label: 'Reaction' },
		{ key: 'shareMusic', label: 'Music' },
		{ key: 'shareBanter', label: 'Banter' },
		{ key: 'shareLink', label: 'Link' },
		{ key: 'shareMedia', label: 'Media' },
		{ key: 'shareLogistics', label: 'Logistics' },
	] as const;
	const tagCounts = tagDefs.map((tag) =>
		(deep?.players ?? []).reduce((sum, player) => sum + Math.round(player[tag.key] * player.msgsRated), 0)
	);
	const tagMixByPlayerConfig = {
		type: 'bar',
		data: {
			labels: tagDefs.map((tag) => tag.label),
			datasets: (deep?.players ?? [])
				.filter((player) => player.msgsRated > 0)
				.map((player) => ({
					label: player.display,
					data: tagDefs.map((tag) => Math.round(player[tag.key] * player.msgsRated)),
					backgroundColor: personColor(people.findIndex((person) => person.key === player.key)),
				})),
		},
		options: {
			indexAxis: 'y' as const,
			responsive: true,
			maintainAspectRatio: false,
			scales: {
				x: { stacked: true, beginAtZero: true, title: { display: true, text: 'Tagged messages' } },
				y: { stacked: true },
			},
			plugins: {
				legend: { position: 'bottom' as const, labels: { boxWidth: 10, boxHeight: 10 } },
				tooltip: {
					callbacks: {
						label: (ctx: { dataset: { label?: string }; dataIndex: number; parsed: { x: number } }) => {
							const total = tagCounts[ctx.dataIndex] || 1;
							return `${ctx.dataset.label}: ${ctx.parsed.x} (${((ctx.parsed.x / total) * 100).toFixed(0)}% of this tag)`;
						},
					},
				},
			},
		},
	};

	const pullBoard = $derived(
		(deep?.players ?? [])
			.filter((p) => p.pullVsActual != null && p.msgsRated >= 5)
			.sort((a, b) => (b.pullVsActual ?? 0) - (a.pullVsActual ?? 0))
	);
</script>

<div class="space-y-6">
	{#if !omitHighlights}<ChatTalkativeness {snap} />{/if}

	<section class="grid gap-6 md:grid-cols-2">
		<div class="rounded-2xl border border-border-muted bg-surface/50 p-5">
			<h2 class="mb-4 text-lg font-semibold">🦉 Night Owl Index</h2>
			<ChartCanvas height={260} config={hourConfig} />
			<p class="mt-3 text-sm text-fg-muted">
				Late-night champ (12–4:59am): <span class="font-semibold text-fg">{nightOwl?.display}</span>
				— {nightOwl?.hourHist.slice(0, 5).reduce((x, y) => x + y, 0) ?? 0} messages after midnight.
			</p>
			<HowToRead items={[
				['Bars', 'Everyone\'s chat messages this season, grouped by the hour they were sent (Central time). Left = midnight, right = 11pm.'],
				['Late-night champ', 'Whoever sent the most messages between midnight and 4:59am.'],
			]} />
		</div>
		{#if !omitHighlights}<ChatDailyActivity {snap} />{/if}
	</section>

	{#if !omitHighlights}<ChatRoastReport {snap} />{/if}

	<section class="grid gap-6 md:grid-cols-2">
		<div class="rounded-2xl border border-border-muted bg-surface/50 p-5">
			<h2 class="mb-1 text-lg font-semibold">🚪 First In The Chat</h2>
			<p class="mb-4 text-sm text-fg-muted">Who posts first when a round drops or results land.</p>
			<ChartCanvas height={280} config={starterConfig} />
			<HowToRead items={[
				['Round drops (teal)', 'How many times this person sent the first chat message after a new round opened (within 48 hours).'],
				['Results posts (gold)', 'How many times they sent the first chat message after a round\'s results came out.'],
			]} />
		</div>
		<div class="rounded-2xl border border-border-muted bg-surface/50 p-5">
			<h2 class="mb-1 text-lg font-semibold">⏰ Deadline Scramble</h2>
			<p class="mb-4 text-sm text-fg-muted">
				Messages in the final 24h before each voting deadline ({scrambleTotal} total).
			</p>
			<div class="space-y-2">
				{#each chat.scramble as s (s.label)}
					<div class="flex items-center justify-between text-sm">
						<span class="truncate text-fg-muted" title={s.label}>{s.label}</span>
						<span class="font-mono">{s.count}</span>
					</div>
					<div class="h-1.5 overflow-hidden rounded-full bg-surface">
						<div class="h-full rounded-full bg-indigo-400" style="width: {(s.count / Math.max(...chat.scramble.map((x) => x.count), 1)) * 100}%"></div>
					</div>
				{/each}
			</div>
			<p class="mt-4 text-sm text-fg-muted">
				Scramble king: <span class="font-semibold text-fg">{scrambleRows[0]?.name}</span>
				({scrambleRows[0]?.v ?? 0} msgs, {((scrambleRows[0]?.v ?? 0) / Math.max(scrambleTotal, 1) * 100).toFixed(0)}%)
			</p>
			<HowToRead items={[
				['Each row', 'One round: chat messages sent in the 24 hours before that round\'s voting deadline. Longer bar = more last-minute chatter.'],
				['Scramble king', 'The person who sent the most of those last-24-hour messages across all rounds, with their share of the total.'],
			]} />
		</div>
	</section>

	<section class="rounded-2xl border border-border-muted bg-surface/50 p-5">
		<h2 class="mb-1 text-lg font-semibold">🧨 Conversation Bursts</h2>
		<p class="mb-4 text-sm text-fg-muted">
			A burst is a run of messages with no gap longer than 15 minutes; 15+ minutes of quiet ends it. “Ignited”
			means you sent the first message of a burst — you broke the silence.
		</p>
		<div class="grid gap-6 md:grid-cols-2">
			<div class="overflow-x-auto">
				<table class="w-full text-sm">
					<thead>
						<tr class="text-left text-fg-muted">
							<th class="px-3 py-2">Person</th>
							<th class="px-3 py-2 text-right" title="Bursts this person started — the first message after 15+ minutes of quiet.">Ignited ⓘ</th>
							<th class="px-3 py-2 text-right" title="Average number of messages in the bursts this person posted in.">Avg size ⓘ</th>
							<th class="px-3 py-2 text-right" title="The largest burst (in messages) this person posted in.">Biggest ⓘ</th>
							<th class="px-3 py-2 text-right" title="How many of their messages got enough replies to be scored on the reaction axes (needs a reply inside a burst of 3+ messages).">Rated msgs ⓘ</th>
						</tr>
					</thead>
					<tbody>
						{#each [...people].sort((a, b) => b.burstsIgnited - a.burstsIgnited).slice(0, 8) as p (p.key)}
							<tr class="border-t border-border-muted">
								<td class="px-3 py-2 font-medium" style="color: {personColor(people.indexOf(p))}">{p.display}</td>
								<td class="px-3 py-2 text-right font-mono">{p.burstsIgnited}</td>
								<td class="px-3 py-2 text-right font-mono">{p.avgBurstSize}</td>
								<td class="px-3 py-2 text-right font-mono">{p.biggestBurst}</td>
								<td class="px-3 py-2 text-right font-mono">{p.react.rated}</td>
							</tr>
						{/each}
					</tbody>
				</table>
				<p class="mt-2 text-xs text-fg-muted">
					Top eight by bursts ignited. Rated msgs: how many of their messages drew enough replies to be scored on the reaction axes (see Reaction Quadrant).
				</p>
			</div>
			<div>
				<h3 class="mb-2 font-medium">Biggest bursts</h3>
				<div class="space-y-2 text-sm">
					{#each chat.bursts.slice(0, 6) as b (b.start)}
						<div class="rounded-xl border border-border-muted p-3">
							<div class="flex justify-between text-xs text-fg-muted">
								<span>{new Date(b.start).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
								<span>{b.size} msgs · {b.people} people · {b.spanMin} min</span>
							</div>
							<div class="mt-1 line-clamp-2">“{b.snippet}”</div>
							<div class="mt-1 text-xs text-fg-muted">ignited by {b.starter}</div>
						</div>
					{/each}
				</div>
			</div>
		</div>
	</section>

	<section class="rounded-2xl border border-border-muted bg-surface/50 p-5">
		<h2 class="mb-1 text-lg font-semibold">🧭 Reaction Quadrant</h2>
		<p class="mb-4 text-sm text-fg-muted">
			Every message is rated on its next three replies (weighted 3·2·1 — the immediate reply matters most).
			The two axes with the biggest swing across the league are plotted; each player lands in a quadrant
			showing what kind of reaction their messages get.
		</p>
		<div class="relative mx-auto max-w-2xl">
			<span class="absolute -top-1 left-1/2 z-10 -translate-x-1/2 rounded-full border border-border-muted bg-surface px-2 py-0.5 text-xs text-fg-muted">
				{axisMetaA.high} + {axisMetaB.high}
			</span>
			<span class="absolute bottom-14 left-1/2 z-10 -translate-x-1/2 rounded-full border border-border-muted bg-surface px-2 py-0.5 text-xs text-fg-muted">
				{axisMetaA.low} + {axisMetaB.low}
			</span>
			<span class="absolute left-0 top-1/2 z-10 -translate-y-1/2 rounded-full border border-border-muted bg-surface px-2 py-0.5 text-xs text-fg-muted">
				{axisMetaA.low}
			</span>
			<span class="absolute right-0 top-1/2 z-10 -translate-y-1/2 rounded-full border border-border-muted bg-surface px-2 py-0.5 text-xs text-fg-muted">
				{axisMetaA.high}
			</span>
			<ChartCanvas height={420} config={quadConfig} zoomable />
		</div>
		<div class="mt-4 overflow-x-auto">
			<table class="w-full text-sm">
				<thead>
					<tr class="text-left text-fg-muted">
						<th class="px-3 py-2">Player</th>
						<th class="px-3 py-2 text-right" title={AXIS_TIPS.energy}>⚡ Energy ⓘ</th>
						<th class="px-3 py-2 text-right" title={AXIS_TIPS.warmth}>💛 Warmth ⓘ</th>
						<th class="px-3 py-2 text-right" title={AXIS_TIPS.engagement}>📣 Engagement ⓘ</th>
						<th class="px-3 py-2 text-right" title={AXIS_TIPS.momentum}>🌊 Momentum ⓘ</th>
						<th class="px-3 py-2 text-right" title="How many of their messages were scored (each needs at least one reply inside a burst of 3+ messages).">Rated ⓘ</th>
					</tr>
				</thead>
				<tbody>
					{#each [...people].sort((a, b) => b.react.rated - a.react.rated) as p (p.key)}
						<tr class="border-t border-border-muted">
							<td class="px-3 py-2 font-medium" style="color: {personColor(people.indexOf(p))}">{p.display}</td>
							<td class="px-3 py-2 text-right font-mono">{p.react.energy?.toFixed(2) ?? '—'}</td>
							<td class="px-3 py-2 text-right font-mono">{p.react.warmth?.toFixed(2) ?? '—'}</td>
							<td class="px-3 py-2 text-right font-mono">{p.react.engagement?.toFixed(2) ?? '—'}</td>
							<td class="px-3 py-2 text-right font-mono">{p.react.momentum?.toFixed(2) ?? '—'}</td>
							<td class="px-3 py-2 text-right font-mono text-fg-muted">{p.react.rated}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<HowToRead items={[
			['How a message is scored', 'Each message is judged by the next three replies, the first reply counting most (3·2·1). A message only counts if it gets a reply inside a burst of 3+ messages.'],
			['Each player\'s score', 'The average of all their scored messages, from −1 to +1. 0 is neutral.'],
			['The chart', `Plots the two axes that vary most across the league this season: ${axisMetaA.label} across, ${axisMetaB.label} up. Corner labels say what each corner means.`],
			['⚡ Energy', AXIS_TIPS.energy],
			['💛 Warmth', AXIS_TIPS.warmth],
			['📣 Engagement', AXIS_TIPS.engagement],
			['🌊 Momentum', AXIS_TIPS.momentum],
			['Rated', 'How many of their messages qualified to be scored. Small numbers = shakier scores.'],
		]} />
	</section>

	{#if deep}
		<section class="rounded-2xl border border-border-muted bg-surface/50 p-5">
			<div class="mb-1 flex flex-wrap items-center justify-between gap-2">
				<h2 class="text-lg font-semibold">🧠 Jev Deep Ratings</h2>
				<span class="text-xs text-fg-muted">
					{deep.coverage.rated.toLocaleString()} messages rated · avg confidence {(deep.coverage.avgConfidence * 100).toFixed(0)}% · ${deep.coverage.totalCost.toFixed(2)} one-time
				</span>
			</div>
			<p class="mb-4 text-sm text-fg-muted">
				Every message scored by a decision model on 48 dimensions (heat, chaos, affection, meme potential,
				predicted conversation pull, roast target, humor type…) — then joined with what actually happened
				next. Personality profile per player:
			</p>

			<div class="grid gap-6 md:grid-cols-2">
				<div>
					<h3 class="mb-2 font-medium">🔥 Heat × Affection profile</h3>
					<ChartCanvas height={340} config={deepScatterConfig} zoomable />
				</div>
				<div>
					<h3 class="mb-1 font-medium">📊 Tag mix by player</h3>
					<p class="mb-2 text-xs text-fg-muted">Each bar is one tag, stacked by who posted those messages.</p>
					<ChartCanvas height={340} config={tagMixByPlayerConfig} zoomable zoomMode="x" />
				</div>
			</div>

			<PlayerFingerprint snap={snap} />

			<div class="mt-6 grid gap-6 md:grid-cols-2">
				<div>
					<h3 class="mb-2 font-medium">🗣️ Pull vs Walk — predicted invites vs actual replies</h3>
					<p class="mb-2 text-xs text-fg-muted">
						Positive = writes messages that demand replies but doesn't get them. Negative = quiet
						posters whose messages spark more than predicted.
					</p>
					<div class="space-y-1.5">
						{#each pullBoard as p (p.key)}
							<div class="flex items-center gap-2 text-sm">
								<span class="w-28 truncate" style="color: {personColor(people.findIndex((pp) => pp.key === p.key))}">{p.display}</span>
								<div class="relative h-3 flex-1 rounded-full bg-surface">
									<div class="absolute top-0 bottom-0 left-1/2 w-px bg-fg-muted/40"></div>
									{#if (p.pullVsActual ?? 0) >= 0}
										<div class="absolute top-0 bottom-0 left-1/2 rounded-r-full bg-rose-400/70" style="width: {(p.pullVsActual ?? 0) * 50}%"></div>
									{:else}
										<div class="absolute top-0 bottom-0 rounded-l-full bg-emerald-400/70" style="width: {-(p.pullVsActual ?? 0) * 50}%; right: 50%"></div>
									{/if}
								</div>
								<span class="w-14 text-right font-mono text-xs">{(p.pullVsActual ?? 0).toFixed(2)}</span>
							</div>
						{/each}
					</div>
				</div>
				<details class="min-w-0 rounded-xl border border-border-muted p-3">
					<summary class="cursor-pointer font-medium">👤 Player profiles <span class="ml-2 text-xs font-normal text-fg-muted">Jev means, including roast counts</span></summary>
					<div class="mt-2 overflow-x-auto">
					<table class="w-full text-xs">
						<thead>
							<tr class="text-left text-fg-muted">
								<th class="px-2 py-1">Player</th>
								<th class="px-2 py-1 text-right">Heat</th>
								<th class="px-2 py-1 text-right">Chaos</th>
								<th class="px-2 py-1 text-right">Affect</th>
								<th class="px-2 py-1 text-right">MC⚡</th>
								<th class="px-2 py-1 text-right">Comm</th>
								<th class="px-2 py-1 text-right">Slop</th>
								<th class="px-2 py-1 text-right">Roasts</th>
							</tr>
						</thead>
						<tbody>
							{#each deepPlayers as p (p.key)}
								<tr class="border-t border-border-muted">
									<td class="px-2 py-1 font-medium" style="color: {personColor(people.findIndex((pp) => pp.key === p.key))}">{p.display}</td>
									<td class="px-2 py-1 text-right font-mono">{p.avgHeat?.toFixed(2) ?? '—'}</td>
									<td class="px-2 py-1 text-right font-mono">{p.avgChaos?.toFixed(2) ?? '—'}</td>
									<td class="px-2 py-1 text-right font-mono">{p.avgAffection?.toFixed(2) ?? '—'}</td>
									<td class="px-2 py-1 text-right font-mono">{p.mainCharacter?.toFixed(2) ?? '—'}</td>
									<td class="px-2 py-1 text-right font-mono">{p.commissioner?.toFixed(2) ?? '—'}</td>
									<td class="px-2 py-1 text-right font-mono">{p.slopIndex?.toFixed(2) ?? '—'}</td>
									<td class="px-2 py-1 text-right font-mono">{p.roastsGiven}</td>
								</tr>
							{/each}
						</tbody>
					</table>
					<p class="mt-2 text-xs text-fg-muted">MC⚡ = main-character energy · Comm = commissioner energy · Slop = profanity+caps rate</p>
					</div>
				</details>
			</div>

			{#if deep.spiciest.length}
				<div class="mt-6">
					<h3 class="mb-2 font-medium">🌶️ Spiciest rated messages (heat ≥ 1.8)</h3>
					<div class="space-y-2 text-sm">
						{#each deep.spiciest as s, si (si + s.ts)}
							<div class="rounded-xl border border-border-muted p-3">
								<div class="flex justify-between text-xs text-fg-muted">
									<span class="font-semibold text-fg">{s.display}</span>
									<span>heat {s.heat.toFixed(1)} · {new Date(s.ts).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
								</div>
								<div class="mt-1">“{s.text}”</div>
							</div>
						{/each}
					</div>
				</div>
			{/if}
		</section>
	{:else}
		<section class="rounded-2xl border border-dashed border-border-muted bg-surface/30 p-5 text-center text-sm text-fg-muted">
			Jev deep ratings not backfilled yet — run <code class="text-fg">scripts/backfill-chat-ratings.ts</code> (~$1.40).
		</section>
	{/if}

	<section class="grid gap-6 md:grid-cols-2">
		<div class="rounded-2xl border border-border-muted bg-surface/50 p-5">
			<h2 class="mb-1 text-lg font-semibold">📣 Chat Hype vs Votes</h2>
			<p class="mb-4 text-sm text-fg-muted">
				Songs talked about in the chat versus how they actually scored. Off the diagonal = the hype bubble.
			</p>
			<ChartCanvas height={300} config={hypeConfig} zoomable />
			<HowToRead items={[
				['Each dot', 'One song from this league that someone linked or named in the chat.'],
				['Across', 'How many times the song came up in the chat.'],
				['Up', 'The total points it finished the round with.'],
				['Reading it', 'Top-left: quiet songs that scored big. Bottom-right: songs everyone talked about that the votes didn\'t back up.'],
			]} />
		</div>
		<div class="rounded-2xl border border-border-muted bg-surface/50 p-5">
			<h2 class="mb-1 text-lg font-semibold">🫥 Lurker Index</h2>
			<p class="mb-4 text-sm text-fg-muted">How much each player talks versus how much they actually play.</p>
			<ChartCanvas height={300} config={lurkerConfig} zoomable />
			<HowToRead items={[
				['Each dot', 'One player.'],
				['Across', 'Music League actions this season: songs submitted plus votes cast.'],
				['Up', 'Group-chat messages this season.'],
				['Reading it', 'High and left: all talk, little play. Low and right: silent workhorses who vote and submit but rarely post.'],
			]} />
		</div>
	</section>

	<section class="rounded-2xl border border-border-muted bg-surface/50 p-5">
		<h2 class="mb-1 text-lg font-semibold">🫶 Self-Promo Index</h2>
		<p class="mb-4 text-sm text-fg-muted">
			Who talked up their own song in the chat before voting closed — which, since submissions are anonymous,
			is basically signing your ballot.
		</p>
		<div class="overflow-x-auto">
			<table class="w-full text-sm">
				<thead>
					<tr class="text-left text-fg-muted">
						<th class="px-3 py-2">Player</th>
						<th class="px-3 py-2 text-right">Self-promoted songs</th>
						<th class="px-3 py-2">Songs</th>
					</tr>
				</thead>
				<tbody>
					{#each chat.selfPromo as sp (sp.key)}
						<tr class="border-t border-border-muted">
							<td class="px-3 py-2 font-medium">{people.find((p) => p.key === sp.key)?.display ?? sp.key}</td>
							<td class="px-3 py-2 text-right font-mono">{sp.count}</td>
							<td class="px-3 py-2 text-fg-muted">{sp.songs.join(' · ')}</td>
						</tr>
					{:else}
						<tr><td class="px-3 py-2 text-fg-muted" colspan="3">No self-promotion detected. Yet.</td></tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>
</div>
