<script lang="ts">
	import type { StatsLeagueSummary } from '$lib/server/boarzStats/data.js';
	let { data }: { data: { leagues: StatsLeagueSummary[] } } = $props();
</script>

<svelte:head>
	<title>League Stats</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<main class="mx-auto max-w-5xl px-4 py-10">
	<p class="font-mono text-xs tracking-widest text-fg-faint uppercase">Music League</p>
	<h1 class="mt-1 text-4xl font-bold">League stats</h1>
	<p class="mt-2 max-w-2xl text-fg-muted">Choose a league, then compare one season or its full history. Every visual can be downloaded as a share-ready PNG.</p>

	<div class="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
		{#each data.leagues as league (league.slug)}
			<a href={`/stats/${league.slug}`} class="rounded-2xl border border-border-muted bg-surface/50 p-5 transition hover:-translate-y-0.5 hover:border-accent">
				<div class="text-xl font-bold">{league.name}</div>
				<div class="mt-2 text-sm text-fg-muted">
					{league.seasons.length} season{league.seasons.length === 1 ? '' : 's'} · {league.seasons.join(', ')}
				</div>
				{#if league.activeSeason != null}
					<div class="mt-3 inline-flex rounded-full border border-health/40 bg-health-bg px-2 py-1 font-mono text-[10px] tracking-wide text-health uppercase">Season {league.activeSeason} active</div>
				{/if}
			</a>
		{/each}
	</div>
</main>
