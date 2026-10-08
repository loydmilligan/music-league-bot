<script lang="ts">
	import PortalNav from '../lib/atoms/PortalNav.svelte';
	import { getPortalSession } from '../lib/portalSession.js';
	import { SurveyApiError } from '../lib/surveyApi.js';
	import type { Nav } from '../lib/types.js';
	import type { PortalJson } from '../lib/portal.js';

	interface Props { nav: Nav; portal: PortalJson | null; }
	let { nav, portal }: Props = $props();
	const session = getPortalSession();

	let names = $state<string[]>([]);
	let error = $state<string | null>(null);
	let code = $state('');
	let needCode = $state(false);
	let pendingName = $state('');
	let loading = $state(true);

	$effect(() => {
		const api = session.api;
		if (!api) { loading = false; return; }
		api.roster().then((r) => { names = r.names; }).catch((e: unknown) => {
			error = e instanceof Error ? e.message : 'Could not load the roster.';
		}).finally(() => { loading = false; });
	});

	async function pick(name: string) {
		if (!session.api) return;
		error = null;
		pendingName = name;
		try {
			await session.api.select(name, needCode ? code : undefined);
			needCode = false;
			code = '';
			await session.refresh();
			nav.goHome();
		} catch (e) {
			if (e instanceof SurveyApiError && e.code === 'forbidden') {
				const body = e.body as { codeRequired?: boolean };
				if (body?.codeRequired) {
					needCode = true;
					error = e.message;
					try { await session.api.switchRequest(name); } catch { /* admin will see it */ }
					return;
				}
			}
			error = e instanceof Error ? e.message : 'Could not sign in.';
		}
	}

</script>

<div class="bs-pad">
	<div class="bs-topbar">
		<PortalNav current="login" {nav} {portal} />
		<span class="bs-mark bs-mark--sm" style="margin-left:auto;">the b/side</span>
	</div>
	<header class="bs-hero">
		<div class="bs-hero-eyebrow">Who are you?</div>
		<h1 class="bs-hero-name">Sign in</h1>
		<p class="bs-sec-sub">Pick your name. First pick on a device is free. Switching later needs Matt to Activate a code.</p>
	</header>
	{#if session.me?.authenticated}
		<p class="bs-sec-sub">Signed in as <b>{session.me.voterName}</b>.</p>
		<button class="bs-share-btn" onclick={() => nav.goLogout()}>Not you? Sign out</button>
	{/if}
	{#if loading}
		<div class="season-status">Loading the roster…</div>
	{:else}
		{#if error}<p class="bs-error-inline">{error}</p>{/if}
		{#if needCode}
			<label class="bs-field">
				<span>Switch code for {pendingName}</span>
				<input bind:value={code} inputmode="numeric" maxlength="6" placeholder="000000" />
			</label>
			<button class="bs-share-btn" onclick={() => pick(pendingName)}>Continue</button>
			<p class="bs-sec-sub">Ask an admin to Activate your request. Codes stay inactive until they do.</p>
		{/if}
		<div class="bs-players">
			{#each names as name}
				<button class="bs-player" onclick={() => pick(name)}>
					<span class="bs-player-name">{name}</span>
				</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.bs-error-inline { color: var(--ember); font-size: 13px; }
	.bs-field { display: flex; flex-direction: column; gap: 6px; font-size: 13px; }
	.bs-field input { padding: 10px 12px; border-radius: var(--r-3); border: 1px solid var(--line); background: var(--ink-1); color: var(--fg); font-size: 16px; }
	.season-status { padding: 22px; border: 1px solid var(--line); border-radius: var(--r-5); color: var(--fg-muted); background: var(--ink-1); }
</style>
