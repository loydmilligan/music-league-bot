<script lang="ts">
	import '$lib/digest/digest.css';
	import StatsExplorer from '$lib/components/boarzStats/StatsExplorer.svelte';
	import AlbumPodium from '$lib/digest/AlbumPodium.svelte';
	import ChatMoments from '$lib/digest/ChatMoments.svelte';
	import StorylinesCast from '$lib/digest/StorylinesCast.svelte';
	let { data } = $props();

	// villain / coinage have no dedicated visual component — render simple cards.
	const villain = $derived(
		data.story.blocks.find((b: { kind: string }) => b.kind === 'villain')?.content as
			| { title?: string; body?: string }
			| undefined
	);
	const coinage = $derived(data.story.coinage as { term?: string; meta?: string; gloss?: string } | null);
</script>

<h1 style="padding:1rem;font:600 1rem/1.3 system-ui">
	Digest 2.0 (dev) · round {data.roundId}
</h1>

<div style="max-width:720px;margin:0 auto;padding:0 1rem">
	{#each data.story.blocks as block (block.kind)}
		{#if block.kind === 'podium'}
			<AlbumPodium kind="podium" content={block.content} variant="both" />
		{:else if block.kind === 'chat'}
			<ChatMoments kind="chat" content={block.content} variant="both" />
		{:else if block.kind === 'storylines'}
			<StorylinesCast kind="storylines" content={block.content} variant="both" />
		{/if}
	{/each}

	{#if villain}
		<section style="margin:1.5rem 0">
			<h2>{villain.title ?? 'The Villain'}</h2>
			<p>{villain.body ?? ''}</p>
		</section>
	{/if}

	{#if coinage}
		<section style="margin:1.5rem 0">
			<h2>The Coinage — {coinage.term ?? ''}</h2>
			{#if coinage.meta}<p style="opacity:.7">{coinage.meta}</p>{/if}
			{#if coinage.gloss}<p>{coinage.gloss}</p>{/if}
		</section>
	{/if}
</div>

<h2 style="padding:1rem;font:600 1rem/1.3 system-ui">Stats</h2>
<StatsExplorer snapshot={data.snapshot} basePath={`/digest2/${data.roundId}/stats`} />
