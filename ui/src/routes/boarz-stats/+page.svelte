<script lang="ts">
	import type { Snapshot } from '$lib/server/boarzStats/data.js';
	import StatsExplorer from '$lib/components/boarzStats/StatsExplorer.svelte';
	let { data }: { data: { snapshot: Snapshot } } = $props();
</script>

<StatsExplorer snapshot={data.snapshot} basePath="/boarz-stats" />
