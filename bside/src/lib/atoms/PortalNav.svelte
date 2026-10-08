<script lang="ts">
	import type { Nav, PortalTab } from '../types.js';
	import { statsHrefFor, type PortalJson } from '../portal.js';
	import { getPortalSession } from '../portalSession.js';

	interface Props {
		current: PortalTab;
		nav: Nav;
		portal: PortalJson | null;
	}
	let { current, nav, portal }: Props = $props();
	const session = getPortalSession();
	const me = $derived(session.me);
	const hub = $derived(session.hub);
	const admin = $derived(session.admin);

	const statsHref = $derived.by(() => {
		void current;
		return statsHrefFor(window.location.pathname, document.body.dataset.leagueSlug ?? '');
	});
	const showSeason = $derived(!!(portal?.seasonFeedUrl || portal?.seasonHubUrl || portal?.survey?.apiBase));
	const signedIn = $derived(me?.authenticated === true);
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
	{#if signedIn && hub?.tabs.survey}
		<button class="bs-pnav-tab" class:on={current === 'survey'} aria-current={current === 'survey' ? 'page' : undefined} onclick={() => nav.goSurvey()}>Survey</button>
	{/if}
	{#if signedIn && hub?.tabs.mine}
		<button class="bs-pnav-tab" class:on={current === 'mine'} aria-current={current === 'mine' ? 'page' : undefined} onclick={() => nav.goMine()}>My themes</button>
	{/if}
	{#if signedIn}
		<button class="bs-pnav-tab" class:on={current === 'settings'} aria-current={current === 'settings' ? 'page' : undefined} onclick={() => nav.goSettings()}>Settings</button>
	{/if}
	{#if admin}
		<button class="bs-pnav-tab" class:on={current === 'admin'} aria-current={current === 'admin' ? 'page' : undefined} onclick={() => nav.goAdmin()}>Admin</button>
	{/if}
	{#if portal?.survey?.apiBase}
		<button class="bs-pnav-tab" class:on={current === 'login'} aria-current={current === 'login' ? 'page' : undefined} onclick={() => signedIn ? nav.goSettings() : nav.goLogin()}>
			{signedIn ? me?.voterName : 'Sign in'}
		</button>
	{/if}
	{#if signedIn}
		<button class="bs-pnav-tab" class:on={current === 'logout'} aria-current={current === 'logout' ? 'page' : undefined} onclick={() => nav.goLogout()}>Sign out</button>
	{/if}
</nav>

<style>
	.bs-pnav { display: flex; flex-wrap: wrap; gap: 4px; padding: 4px; background: var(--ink-1); border: 1px solid var(--line); border-radius: var(--r-full); align-self: flex-start; max-width: 100%; }
	.bs-pnav-tab { padding: 6px 14px; border-radius: var(--r-full); border: 0; background: transparent; color: var(--fg-muted); font-family: 'Inter Tight', var(--font-body, sans-serif); font-size: 13px; font-weight: 600; cursor: pointer; text-decoration: none; }
	.bs-pnav-tab:hover { color: var(--fg); }
	.bs-pnav-tab.on { background: var(--mash-pulp); color: #fff; }
</style>
