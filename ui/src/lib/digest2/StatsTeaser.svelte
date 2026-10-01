<script lang="ts">
	import type { Snapshot } from '$lib/server/boarzStats/data.js';
	import LeaderboardRaceChart from '$lib/components/boarzStats/LeaderboardRaceChart.svelte';
	let { snapshot, onOpenStats }: { snapshot: Snapshot; onOpenStats: () => void } = $props();
</script>

<section style="margin:1.75rem 0 1rem">
	<div style="display:flex;align-items:baseline;justify-content:space-between;gap:.75rem;margin-bottom:.4rem">
		<h2 style="font:700 1rem system-ui;margin:0">The race so far</h2>
		<button
			type="button"
			onclick={onOpenStats}
			title="Powered by ML Stats — open the Stats tab for the full set of charts and graphs like this one."
			style="background:none;border:none;color:#8ab4ff;cursor:pointer;font:600 .85rem system-ui;white-space:nowrap"
		>League stats →</button>
	</div>
	<LeaderboardRaceChart snap={snapshot} />
	<p style="margin:.5rem 0 0;font:.8rem system-ui;color:#888">
		A peek from <button type="button" onclick={onOpenStats} style="background:none;border:none;padding:0;color:#8ab4ff;cursor:pointer;font:inherit;text-decoration:underline">ML Stats</button> — the Stats tab has the full season in charts.
	</p>
</section>
