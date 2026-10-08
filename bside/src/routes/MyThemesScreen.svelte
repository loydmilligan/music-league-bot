<script lang="ts">
	import PortalNav from '../lib/atoms/PortalNav.svelte';
	import { getPortalSession } from '../lib/portalSession.js';
	import type { Nav } from '../lib/types.js';
	import type { PortalJson } from '../lib/portal.js';

	interface Props { nav: Nav; portal: PortalJson | null; }
	let { nav, portal }: Props = $props();
	const session = getPortalSession();
	const themes = $derived(session.hub?.myThemes ?? []);
</script>

<div class="bs-pad">
	<div class="bs-topbar">
		<PortalNav current="mine" {nav} {portal} />
		<span class="bs-mark bs-mark--sm" style="margin-left:auto;">the b/side</span>
	</div>
	<header class="bs-hero">
		<h1 class="bs-hero-name">My themes</h1>
	</header>
	{#each themes as theme}
		<article class="card">
			<h3>{theme.title || 'Untitled'}</h3>
			<p>{theme.description}</p>
			{#if theme.usedIn}<div class="chip">{theme.usedIn}</div>{/if}
		</article>
	{:else}
		<p class="bs-sec-sub">No themes yet. Add some on Survey.</p>
	{/each}
</div>

<style>
	.card { padding: 16px; border: 1px solid var(--line); border-radius: var(--r-5); background: var(--ink-2); margin-bottom: 11px; }
	.card h3 { margin: 0 0 8px; font-family: var(--font-display); }
	.card p { margin: 0; color: var(--fg-muted); white-space: pre-line; }
	.chip { margin-top: 10px; display: inline-block; padding: 4px 10px; border-radius: var(--r-full); background: var(--mash-pulp-soft); font-size: 12px; }
</style>
