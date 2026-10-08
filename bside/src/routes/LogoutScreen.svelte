<script lang="ts">
	import PortalNav from '../lib/atoms/PortalNav.svelte';
	import { getPortalSession } from '../lib/portalSession.js';
	import type { Nav } from '../lib/types.js';
	import type { PortalJson } from '../lib/portal.js';

	interface Props { nav: Nav; portal: PortalJson | null; }
	let { nav, portal }: Props = $props();
	const session = getPortalSession();

	let done = $state(false);
	let error = $state<string | null>(null);
	let started = false;

	$effect(() => {
		if (started) return;
		started = true;
		void (async () => {
			try {
				if (session.api && session.me?.authenticated) {
					await session.api.logout();
					await session.refresh();
				}
			} catch (e) {
				error = e instanceof Error ? e.message : 'Could not sign out.';
			} finally {
				done = true;
			}
		})();
	});
</script>

<div class="bs-pad">
	<div class="bs-topbar">
		<PortalNav current="logout" {nav} {portal} />
		<span class="bs-mark bs-mark--sm" style="margin-left:auto;">the b/side</span>
	</div>
	<header class="bs-hero">
		<div class="bs-hero-eyebrow">Session</div>
		<h1 class="bs-hero-name">Signed out</h1>
		{#if !done}
			<p class="bs-sec-sub">Signing you out…</p>
		{:else if error}
			<p class="bs-error-inline">{error}</p>
		{:else}
			<p class="bs-sec-sub">This browser is signed out of the player portal. Admin access is cleared too — the next admin visit needs a new OTP.</p>
		{/if}
	</header>
	{#if done}
		<div class="row">
			<button class="bs-share-btn" onclick={() => nav.goLogin()}>Sign in</button>
			<button class="bs-share-btn ghost" onclick={() => nav.goHome()}>Home</button>
		</div>
	{/if}
</div>

<style>
	.bs-error-inline { color: var(--ember); font-size: 13px; }
	.row { display: flex; flex-wrap: wrap; gap: 10px; }
	.ghost { background: transparent; color: var(--fg-2); border: 1px solid var(--line); }
</style>
