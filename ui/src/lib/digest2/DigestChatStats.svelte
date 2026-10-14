<script lang="ts">
	import type { Snapshot } from '$lib/server/boarzStats/data.js';
	import ChatTalkativeness from '$lib/components/boarzStats/ChatTalkativeness.svelte';
	import ChatDailyActivity from '$lib/components/boarzStats/ChatDailyActivity.svelte';
	import ChatRoastReport from '$lib/components/boarzStats/ChatRoastReport.svelte';
	import ChatLaughTrack from '$lib/components/boarzStats/ChatLaughTrack.svelte';
	import ChatTab from '$lib/components/boarzStats/ChatTab.svelte';
	let { snapshot }: { snapshot: Snapshot } = $props();
	let showMore = $state(false);
</script>

<section style="margin:1.5rem 0">
	<h2 style="font:700 1rem system-ui;margin:0 0 .5rem">Chat, by the numbers</h2>
	<div class="space-y-6">
		<ChatTalkativeness snap={snapshot} />
		<ChatDailyActivity snap={snapshot} />
		<ChatRoastReport snap={snapshot} />
		<ChatLaughTrack snap={snapshot} />
	</div>
	<button
		type="button"
		onclick={() => (showMore = !showMore)}
		style="margin:1rem 0;background:none;border:1px solid #2a2a2a;border-radius:8px;padding:.5rem .9rem;color:#8ab4ff;cursor:pointer;font:600 .85rem system-ui"
	>{showMore ? '▾ Hide extra chat stats' : '▸ More chat stats'}</button>
	{#if showMore}
		<div class="space-y-6"><ChatTab snap={snapshot} omitHighlights /></div>
	{/if}
</section>
