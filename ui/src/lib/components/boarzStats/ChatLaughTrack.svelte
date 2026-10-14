<script lang="ts">
	import type { Snapshot } from '$lib/server/boarzStats/data.js';

	let { snap }: { snap: Snapshot } = $props();

	const track = $derived(snap.laughTrack);
	const people = $derived((track?.people ?? []).filter((p) => p.given > 0 || p.drawn > 0));
	const max = $derived(Math.max(1, ...people.map((p) => Math.max(p.given, p.drawn))));
	const pct = (n: number) => `${Math.round((n / max) * 100)}%`;
</script>

{#if track && people.length}
	<section class="rounded-2xl border border-border-muted bg-surface/50 p-5" data-component="laugh-track">
		<h2 class="mb-1 text-lg font-semibold">😂 Laugh Track</h2>
		<p class="mb-4 text-sm text-fg-muted">
			<b style="color:#fbbf24">Drew</b> = laughs other people sent within ten minutes of your message.
			<b style="color:#60a5fa">Gave</b> = your own 😂 🤣 💀 / haha / lol / lmao.
			{#if track.reactionLaughs > 0}Includes {track.reactionLaughs} 😂 reactions.{:else}Counted from message text; emoji reactions are tracked from next round.{/if}
		</p>
		<div class="lt-rows">
			{#each people as p (p.key)}
				<div class="lt-row">
					<span class="lt-name" title={p.display}>{p.display}</span>
					<div class="lt-bars">
						<div class="lt-bar"><i style="width:{pct(p.drawn)};background:#fbbf24"></i><span>{p.drawn}</span></div>
						<div class="lt-bar"><i style="width:{pct(p.given)};background:#60a5fa"></i><span>{p.given}</span></div>
					</div>
				</div>
			{/each}
		</div>
		{#if track.biggest && track.biggest.laughs > 1}
			<figure class="lt-biggest">
				<figcaption>Biggest laugh · {track.biggest.laughs} people</figcaption>
				<blockquote>“{track.biggest.snippet}”</blockquote>
				<p>— {track.biggest.display} · laughed: {track.biggest.laughers.join(', ')}</p>
			</figure>
		{/if}
	</section>
{/if}

<style>
	.lt-rows { display: grid; gap: 0.45rem; }
	.lt-row { display: grid; grid-template-columns: 7.5rem 1fr; gap: 0.6rem; align-items: center; }
	.lt-name { font-size: 0.82rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: right; }
	.lt-bars { display: grid; gap: 2px; }
	.lt-bar { display: flex; align-items: center; gap: 0.35rem; height: 0.7rem; }
	.lt-bar i { display: block; height: 100%; border-radius: 3px; min-width: 2px; }
	.lt-bar span { font: 600 0.7rem ui-monospace, monospace; opacity: 0.8; }
	.lt-biggest { margin: 1rem 0 0; padding: 0.75rem 0.9rem; border-left: 3px solid #fbbf24; background: rgba(251, 191, 36, 0.06); border-radius: 6px; }
	.lt-biggest figcaption { font: 700 0.7rem ui-monospace, monospace; letter-spacing: 0.06em; text-transform: uppercase; color: #fbbf24; }
	.lt-biggest blockquote { margin: 0.35rem 0; font-style: italic; }
	.lt-biggest p { margin: 0; font-size: 0.8rem; opacity: 0.75; }
</style>
