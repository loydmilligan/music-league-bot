<script lang="ts">
	import type { Snapshot } from '$lib/server/boarzStats/data.js';

	let { snap }: { snap: Snapshot } = $props();

	type View = 'forecast' | 'drew' | 'gave';
	let view = $state<View>('forecast');

	const track = $derived(snap.laughTrack);
	const people = $derived((track?.people ?? []).filter((p) => p.given > 0 || p.drawn > 0));
	const maxGiven = $derived(Math.max(1, ...people.map((p) => p.given)));
	const maxDrawn = $derived(Math.max(1, ...people.map((p) => p.drawn)));
	const maxAny = $derived(Math.max(maxGiven, maxDrawn));
	const sorted = $derived(
		[...people].sort((a, b) =>
			view === 'gave' ? b.given - a.given || b.drawn - a.drawn : b.drawn - a.drawn || b.given - a.given,
		),
	);

	// Quadrant split at the midpoint of each axis's range, so the four corners
	// stay meaningful whatever the round's volume.
	const W = 560;
	const H = 380;
	const PAD = { l: 44, r: 16, t: 16, b: 40 };
	// 20% headroom so the top/right-most people aren't pinned to the frame.
	const x = (v: number) => PAD.l + (v / (maxGiven * 1.2)) * (W - PAD.l - PAD.r);
	const y = (v: number) => H - PAD.b - (v / (maxDrawn * 1.2)) * (H - PAD.t - PAD.b);
	const midX = $derived(x(maxGiven / 2));
	const midY = $derived(y(maxDrawn / 2));
	// (quadrant split stays at half the observed max, not half the padded axis)
	const quadrant = (p: { given: number; drawn: number }) => {
		const highDraw = p.drawn >= maxDrawn / 2;
		const highGive = p.given >= maxGiven / 2;
		return highDraw ? (highGive ? '⛈️ Monsoon' : '🌧️ Rainmaker') : highGive ? '💧 Leaky Roof' : '☀️ Drought';
	};
	// Labels: flip left of the dot in the right third; nudge down when a label
	// would sit on top of one already placed.
	const labels = $derived.by(() => {
		const placed: { x: number; y: number }[] = [];
		return people
			.map((p) => ({ p, cx: x(p.given), cy: y(p.drawn) }))
			.sort((a, b) => a.cy - b.cy || a.cx - b.cx)
			.map(({ p, cx, cy }) => {
				const width = p.display.length * 6.3;
				const dots = people.filter((o) => o.key !== p.key).map((o) => ({ ox: x(o.given), oy: y(o.drawn) }));
				const coversDot = dots.some(({ ox, oy }) => ox > cx && ox < cx + 12 + width && Math.abs(oy - cy) < 10);
				const left = cx > W * 0.66 || (coversDot && cx - width > PAD.l + 4);
				let ly = cy + 4;
				while (placed.some((q) => Math.abs(q.y - ly) < 13 && Math.abs(q.x - cx) < 110)) ly += 13;
				placed.push({ x: cx, y: ly });
				return { p, cx, cy, lx: left ? cx - 9 : cx + 9, ly, anchor: left ? 'end' : 'start' };
			});
	});
	const ratio = (p: { given: number; drawn: number }) => (p.given ? (p.drawn / p.given).toFixed(1) : p.drawn ? '∞' : '—');
</script>

{#if track && people.length}
	<section class="rounded-2xl border border-border-muted bg-surface/50 p-5" data-component="laugh-track">
		<h2 class="mb-1 text-lg font-semibold">😂 Tear Forecast</h2>
		<p class="mb-3 text-sm text-fg-muted">
			Tears measured as precipitation. <b style="color:#fbbf24">Made it rain</b> = laughs other people sent within ten
			minutes of your message. <b style="color:#60a5fa">Shed tears</b> = your own 😂 🤣 💀 / haha / lol / lmao.
			{#if track.reactionLaughs > 0}Includes {track.reactionLaughs} 😂 reactions.{:else}Counted from message text; 😂 reactions are tracked from next round.{/if}
		</p>

		<div class="lt-pills" role="tablist" aria-label="Tear Forecast view">
			<button role="tab" aria-selected={view === 'forecast'} class:on={view === 'forecast'} onclick={() => (view = 'forecast')}>Forecast</button>
			<button role="tab" aria-selected={view === 'drew'} class:on={view === 'drew'} onclick={() => (view = 'drew')}>Made it rain</button>
			<button role="tab" aria-selected={view === 'gave'} class:on={view === 'gave'} onclick={() => (view = 'gave')}>Shed tears</button>
		</div>

		{#if view === 'forecast'}
			<svg viewBox="0 0 {W} {H}" class="lt-quad" role="img" aria-label="Tears shed versus tears drawn, per person">
				<rect x={PAD.l} y={PAD.t} width={midX - PAD.l} height={midY - PAD.t} class="q q-rain" />
				<rect x={midX} y={PAD.t} width={W - PAD.r - midX} height={midY - PAD.t} class="q q-monsoon" />
				<rect x={PAD.l} y={midY} width={midX - PAD.l} height={H - PAD.b - midY} class="q q-drought" />
				<rect x={midX} y={midY} width={W - PAD.r - midX} height={H - PAD.b - midY} class="q q-leak" />
				<text x={PAD.l + 8} y={PAD.t + 18} class="ql">🌧️ Rainmaker</text>
				<text x={W - PAD.r - 8} y={PAD.t + 18} class="ql" text-anchor="end">⛈️ Monsoon</text>
				<text x={PAD.l + 8} y={H - PAD.b - 10} class="ql">☀️ Drought</text>
				<text x={W - PAD.r - 8} y={H - PAD.b - 10} class="ql" text-anchor="end">💧 Leaky Roof</text>
				<line x1={PAD.l} y1={H - PAD.b} x2={W - PAD.r} y2={H - PAD.b} class="axis" />
				<line x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={H - PAD.b} class="axis" />
				<text x={(PAD.l + W - PAD.r) / 2} y={H - 10} class="al" text-anchor="middle">tears shed →</text>
				<text x={14} y={(PAD.t + H - PAD.b) / 2} class="al" text-anchor="middle" transform="rotate(-90 14 {(PAD.t + H - PAD.b) / 2})">tears drawn →</text>
				{#each labels as { p, cx, cy, lx, ly, anchor } (p.key)}
					<g>
						<circle {cx} {cy} r="6" class="pt" />
						<text x={lx} y={ly} class="pl" text-anchor={anchor}>{p.display}</text>
						<title>{p.display}: drew {p.drawn}, shed {p.given} · {quadrant(p)}</title>
					</g>
				{/each}
			</svg>
			<p class="lt-foot">Rain ratio (drawn ÷ shed): {#each [...people].sort((a, b) => b.drawn / Math.max(b.given, 0.5) - a.drawn / Math.max(a.given, 0.5)) as p, i (p.key)}{i ? ' · ' : ''}<b>{p.display}</b> {ratio(p)}{/each}</p>
		{:else}
			<div class="lt-rows">
				{#each sorted as p (p.key)}
					{@const v = view === 'gave' ? p.given : p.drawn}
					<div class="lt-row">
						<span class="lt-name" title={p.display}>{p.display}</span>
						<div class="lt-bar">
							<i style="width:{Math.round((v / maxAny) * 100)}%;background:{view === 'gave' ? '#60a5fa' : '#fbbf24'}"></i>
							<span>{v}</span>
						</div>
					</div>
				{/each}
			</div>
		{/if}

		{#if track.biggest && track.biggest.laughs > 1}
			<figure class="lt-biggest">
				<figcaption>Heaviest downpour · {track.biggest.laughs} people</figcaption>
				<blockquote>“{track.biggest.snippet}”</blockquote>
				<p>— {track.biggest.display} · cried: {track.biggest.laughers.join(', ')}</p>
			</figure>
		{/if}
	</section>
{/if}

<style>
	.lt-pills { display: flex; gap: 0.4rem; margin-bottom: 0.9rem; flex-wrap: wrap; }
	.lt-pills button { border: 1px solid #2a2a2a; background: none; color: inherit; border-radius: 999px; padding: 0.3rem 0.8rem; font: 600 0.78rem system-ui; cursor: pointer; opacity: 0.75; }
	.lt-pills button.on { background: #1e293b; border-color: #60a5fa; opacity: 1; }
	.lt-quad { width: 100%; height: auto; display: block; }
	.q { opacity: 0.08; }
	.q-rain { fill: #fbbf24; }
	.q-monsoon { fill: #a78bfa; }
	.q-drought { fill: #f97316; opacity: 0.04; }
	.q-leak { fill: #60a5fa; }
	.ql { font: 700 12px system-ui; fill: currentColor; opacity: 0.6; }
	.al { font: 600 11px system-ui; fill: currentColor; opacity: 0.5; }
	.axis { stroke: currentColor; opacity: 0.25; }
	.pt { fill: #fbbf24; stroke: #111; stroke-width: 1.5; }
	.pl { font: 600 11px system-ui; fill: currentColor; }
	.lt-foot { margin: 0.5rem 0 0; font-size: 0.78rem; opacity: 0.75; line-height: 1.5; }
	.lt-rows { display: grid; gap: 0.45rem; }
	.lt-row { display: grid; grid-template-columns: 7.5rem 1fr; gap: 0.6rem; align-items: center; }
	.lt-name { font-size: 0.82rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: right; }
	.lt-bar { display: flex; align-items: center; gap: 0.35rem; height: 0.85rem; }
	.lt-bar i { display: block; height: 100%; border-radius: 3px; min-width: 2px; }
	.lt-bar span { font: 600 0.72rem ui-monospace, monospace; opacity: 0.8; }
	.lt-biggest { margin: 1rem 0 0; padding: 0.75rem 0.9rem; border: 1px solid rgba(251, 191, 36, 0.25); background: rgba(251, 191, 36, 0.06); border-radius: 10px; }
	.lt-biggest figcaption { font: 700 0.7rem ui-monospace, monospace; letter-spacing: 0.06em; text-transform: uppercase; color: #fbbf24; }
	.lt-biggest blockquote { margin: 0.35rem 0; font-style: italic; }
	.lt-biggest p { margin: 0; font-size: 0.8rem; opacity: 0.75; }
</style>
