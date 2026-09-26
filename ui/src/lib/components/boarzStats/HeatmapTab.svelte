<script lang="ts">
	import type { Snapshot } from '$lib/server/boarzStats/data.js';

	let { snap }: { snap: Snapshot } = $props();

	type Mode = 'raw' | 'norm';
	let mode = $state<Mode>('norm');

	const comps = snap.competitors;
	const colors = snap.colors;

	const maxRaw = $derived(Math.max(...snap.heat.raw.flat(), 1));
	const maxNorm = $derived(
		Math.max(...snap.heat.norm.flat().map((v) => v ?? 0), 1)
	);

	function rawTitle(a: number, b: number): string {
		return `${comps[a].name} → ${comps[b].name}: ${snap.heat.raw[a][b]} total pts`;
	}
	function normTitle(a: number, b: number): string {
		const v = snap.heat.norm[a][b];
		const co = snap.heat.both[a][b];
		return `${comps[a].name} → ${comps[b].name}: ${v == null ? 'no votes' : v.toFixed(2) + ' pts/round'} over ${co} co-active rounds`;
	}
</script>

<div class="space-y-6">
	<section class="rounded-2xl border border-border-muted bg-surface/50 p-5">
		<div class="mb-3 flex flex-wrap items-center justify-between gap-2">
			<h2 class="text-lg font-semibold">🔥 Vote Heatmap</h2>
			<div class="flex gap-1 rounded-lg border border-border-muted p-1">
				<button
					type="button"
					class="rounded-md px-3 py-1 text-sm {mode === 'norm' ? 'bg-fg text-bg font-semibold' : 'text-fg-muted'}"
					onclick={() => (mode = 'norm')}
				>
					Per-round avg
				</button>
				<button
					type="button"
					class="rounded-md px-3 py-1 text-sm {mode === 'raw' ? 'bg-fg text-bg font-semibold' : 'text-fg-muted'}"
					onclick={() => (mode = 'raw')}
				>
					Raw totals
				</button>
			</div>
		</div>
		<p class="mb-4 text-sm text-fg-muted">
			{#if mode === 'norm'}
				Average points per round, counting only rounds where <em>both</em> players were active — missed
				rounds don't skew the colors.
			{:else}
				Total points given across every round. Heavy voters/submitters accumulate more — switch to
				<em>Per-round avg</em> for the fair version.
			{/if}
		</p>

		<div class="overflow-x-auto">
			<table class="border-separate text-xs" style="border-spacing: 2px">
				<thead>
					<tr>
						<th class="sticky-left p-1 text-left text-fg-muted">voter ↓ / gets →</th>
						{#each comps as c, j (c.id)}
							<th class="p-1 font-medium" title={c.name}>
								<span style="writing-mode: vertical-rl; transform: rotate(180deg); max-height: 88px; display: inline-block; overflow: hidden;">
									{c.name}
								</span>
							</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each comps as c, i (c.id)}
						<tr>
							<th class="whitespace-nowrap p-1 text-right font-medium" style="color: {colors[i % colors.length]}" title={c.name}>
								{c.name}
							</th>
							{#each comps as _, j (j)}
								{@const v = mode === 'raw' ? snap.heat.raw[i][j] : snap.heat.norm[i][j]}
								{@const co = snap.heat.both[i][j]}
								{@const cellData = i === j
									? { bg: 'transparent', label: '—', title: 'own songs' }
									: mode === 'raw' && v === 0
										? { bg: 'transparent', label: '·', title: rawTitle(i, j) }
										: mode === 'norm' && v == null
											? { bg: 'transparent', label: '—', title: normTitle(i, j) }
											: mode === 'raw'
												? { bg: (v as number) < 0
														? `rgba(251,113,133,${(0.15 + Math.min(1, Math.abs(v as number) / maxRaw) * 0.75).toFixed(2)})`
														: `rgba(167,139,250,${(0.12 + Math.min(1, (v as number) / maxRaw) * 0.75).toFixed(2)})`, label: String(v), title: rawTitle(i, j) }
												: { bg: `rgba(167,139,250,${(0.12 + Math.min(1, (v as number) / maxNorm) * 0.75).toFixed(2)})`, label: (v as number).toFixed(1), title: normTitle(i, j) }}
								<td
									class="rounded-md p-1 text-center font-mono tabular-nums"
									style="background: {cellData.bg}; min-width: 34px"
									title={cellData.title}
								>
									{cellData.label}
								</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>

	<details class="rounded-2xl border border-border-muted bg-surface/50 p-5">
		<summary class="cursor-pointer list-none text-lg font-semibold">Full breakdown {mode === 'norm' ? '(per-round avg)' : '(raw totals)'} <span class="ml-2 text-xs font-normal text-fg-muted">Show top recipient values</span></summary>
		<div class="overflow-x-auto">
			<table class="w-full text-sm">
				<thead>
					<tr class="text-left text-fg-muted">
						<th class="px-3 py-2">Voter</th>
						<th class="px-3 py-2">→ Top recipient</th>
						<th class="px-3 py-2 text-right">{mode === 'norm' ? 'Avg pts/round' : 'Total pts'}</th>
						<th class="px-3 py-2 text-right">Co-active rounds</th>
					</tr>
				</thead>
				<tbody>
					{#each comps as c, i (c.id)}
						{@const pairs = comps.map((_, j) => ({ j, v: mode === 'raw' ? snap.heat.raw[i][j] : (snap.heat.norm[i][j] ?? -Infinity), co: snap.heat.both[i][j] }))}
						{@const best = pairs.filter((p) => p.j !== i).sort((a, b) => b.v - a.v)[0]}
						<tr class="border-t border-border-muted">
							<td class="px-3 py-2 font-medium" style="color: {colors[i % colors.length]}">{c.name}</td>
							<td class="px-3 py-2" style="color: {colors[best.j % colors.length]}">{comps[best.j].name}</td>
							<td class="px-3 py-2 text-right font-mono">
								{mode === 'raw' ? best.v : best.v === -Infinity ? '—' : (best.v as number).toFixed(2)}
							</td>
							<td class="px-3 py-2 text-right font-mono text-fg-muted">{best.co}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</details>
</div>
