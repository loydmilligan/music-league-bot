<script lang="ts">
	import StatsExplorer from '$lib/components/boarzStats/StatsExplorer.svelte';
	import PortalStatsNav from '$lib/portal/PortalStatsNav.svelte';
	let { data } = $props();
</script>

<PortalStatsNav nav={data.nav} />
<StatsExplorer snapshot={data.snapshot} basePath="./" frozen />
