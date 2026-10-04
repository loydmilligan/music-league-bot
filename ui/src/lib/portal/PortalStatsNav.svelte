<script lang="ts">
	import type { StatsNav } from './statsNav.js';
	let { nav }: { nav: StatsNav } = $props();
</script>

<svelte:head>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&family=Inter+Tight:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
</svelte:head>

<nav class="pn" aria-label="Portal">
	<div class="pn-top">
		<span class="pn-name">{nav.leagueName}</span>
		<div class="pn-tabs">
			<a href={nav.homeHref} data-sveltekit-reload>Home</a>
			<a href={nav.digestsHref} data-sveltekit-reload>Digests</a>
			<a class="active" href="./" aria-current="page" data-sveltekit-reload>Stats</a>
			<a href={nav.seasonHref} data-sveltekit-reload>Season</a>
		</div>
	</div>
	{#if nav.seasons.length > 1}
		<div class="pn-seasons">
			{#each nav.seasons as s (s.number)}
				<a class="pill" class:sel={s.selected} href={s.href} data-sveltekit-reload>S{s.number}{s.current ? ' · current' : ''}</a>
			{/each}
		</div>
	{/if}
</nav>

<style>
	.pn { background: #0d1116; color: #c2cad3; font-family: 'Inter Tight', ui-sans-serif, system-ui, sans-serif; padding: 10px 16px; border-bottom: 1px solid #283039; }
	.pn-top { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
	.pn-name { font-family: 'Bricolage Grotesque', ui-sans-serif, system-ui, sans-serif; font-weight: 800; font-size: 18px; color: #fff; }
	.pn-tabs { display: flex; gap: 4px; }
	a { color: #c2cad3; text-decoration: none; padding: 6px 12px; border-radius: 6px; font-weight: 600; font-size: 14px; }
	a:hover { background: #1c232c; }
	.pn-tabs a.active { color: #ff5b2e; background: #ff5b2e22; }
	.pn-seasons { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
	.pill { border: 1px solid #283039; font-size: 12px; padding: 3px 10px; border-radius: 999px; }
	.pill.sel { border-color: #ff5b2e; color: #ff5b2e; }
</style>
