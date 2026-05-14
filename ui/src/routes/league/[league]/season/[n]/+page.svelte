<script lang="ts">
	import type { PageData } from './$types.js';
	let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>{data.league.name} S{data.season.seasonNumber}</title></svelte:head>

<div class="text-sm text-slate-400 mb-6">
	<a href="/" class="hover:text-purple-400">Home</a> › {data.league.name} › Season {data.season.seasonNumber}
	<span
		class="ml-2 text-xs px-2 py-0.5 rounded font-bold"
		class:bg-cyan-900={data.season.status === 'active'}
		class:text-cyan-300={data.season.status === 'active'}
		class:bg-slate-700={data.season.status === 'complete'}
		class:text-slate-300={data.season.status === 'complete'}
	>
		{data.season.status.toUpperCase()}
	</span>
</div>

<h1 class="text-2xl font-bold mb-8">{data.league.name} — Season {data.season.seasonNumber}</h1>

<div class="flex flex-col gap-3">
	{#each data.rounds as r (r.id)}
		<a
			href="/league/{data.league.slug}/season/{data.season.seasonNumber}/round/{r.id}"
			class="block rounded-xl p-4 border border-slate-700 hover:border-purple-500 hover:bg-slate-800 transition-colors bg-slate-800/50"
		>
			<div class="flex items-start justify-between gap-4">
				<div class="flex-1 min-w-0">
					<div class="font-semibold text-slate-100">{r.name}</div>
					{#if r.description}
						<div class="text-sm text-slate-400 mt-0.5 truncate">{r.description}</div>
					{/if}
				</div>
				<div class="text-right flex-shrink-0 text-xs text-slate-500">
					<div>{r.songCount} songs</div>
					{#if r.researchCount}
						<div class="text-purple-400">🔬 {r.researchCount} researched</div>
					{/if}
				</div>
			</div>
		</a>
	{/each}
	{#if !data.rounds.length}
		<p class="text-slate-500">No rounds imported yet. Upload an export ZIP in Settings.</p>
	{/if}
</div>
