<script lang="ts">
	import type { Nav } from '../types.js';
	import { statsHrefFor, type PortalJson } from '../portal.js';

	interface Props { current: 'home' | 'archive' | 'season' | 'profile'; nav: Nav; portal: PortalJson | null; }
	let { current, nav, portal }: Props = $props();

	const statsHref = $derived.by(() => {
		void current;
		return statsHrefFor(window.location.pathname, document.body.dataset.leagueSlug ?? '');
	});
	const showSeason = $derived(!!(portal?.seasonFeedUrl || portal?.seasonHubUrl));
</script>

<nav class="bs-pnav" aria-label="League portal">
	<button class="bs-pnav-tab" class:on={current === 'home'} aria-current={current === 'home' ? 'page' : undefined} onclick={() => nav.goHome()}>Home</button>
	<button class="bs-pnav-tab" class:on={current === 'archive'} aria-current={current === 'archive' ? 'page' : undefined} onclick={() => nav.goArchive()}>Digests</button>
	{#if portal?.stats}
		<a class="bs-pnav-tab" href={statsHref}>Stats</a>
	{/if}
	{#if showSeason}
		<button class="bs-pnav-tab" class:on={current === 'season'} aria-current={current === 'season' ? 'page' : undefined} onclick={() => nav.goSeason()}>Season</button>
	{/if}
</nav>

<style>
	.bs-pnav { display: flex; gap: 4px; padding: 4px; background: var(--ink-1); border: 1px solid var(--line); border-radius: var(--r-full); align-self: flex-start; }
	.bs-pnav-tab { padding: 6px 14px; border-radius: var(--r-full); border: 0; background: transparent; color: var(--fg-muted); font-family: 'Inter Tight', var(--font-body, sans-serif); font-size: 13px; font-weight: 600; cursor: pointer; text-decoration: none; }
	.bs-pnav-tab:hover { color: var(--fg); }
	.bs-pnav-tab.on { background: var(--mash-pulp); color: #fff; }
</style>
