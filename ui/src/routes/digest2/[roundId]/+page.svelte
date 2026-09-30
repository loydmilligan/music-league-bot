<script lang="ts">
	import StatsExplorer from '$lib/components/boarzStats/StatsExplorer.svelte';
	let { data } = $props();
</script>

<h1 style="padding:1rem;font:600 1rem/1.3 system-ui">
	Digest 2.0 · stats embed (dev) · round {data.roundId}
</h1>

<StatsExplorer snapshot={data.snapshot} basePath={`/digest2/${data.roundId}/stats`} />
