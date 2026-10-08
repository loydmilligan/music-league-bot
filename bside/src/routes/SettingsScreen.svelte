<script lang="ts">
	import PortalNav from '../lib/atoms/PortalNav.svelte';
	import { getPortalSession } from '../lib/portalSession.js';
	import type { Nav } from '../lib/types.js';
	import type { PortalJson } from '../lib/portal.js';
	import type { PlayerSettings } from '../lib/surveyApi.js';

	interface Props { nav: Nav; portal: PortalJson | null; }
	let { nav, portal }: Props = $props();
	const session = getPortalSession();

	let settings = $state<PlayerSettings | null>(null);
	let status = $state('');
	let error = $state<string | null>(null);

	const events = [
		['deadline_26h', '26 hours before a deadline'],
		['deadline_4h', '4 hours before a deadline'],
		['theme_revealed', 'Theme reveals'],
		['digest_2', 'Digest 2.0 is up'],
		['results', 'Results are in'],
		['polls', 'Theme polls'],
		['news', 'League news'],
	] as const;

	async function load() {
		if (!session.api) return;
		try {
			settings = (await session.api.settings()).settings;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Could not load settings.';
		}
	}

	$effect(() => { void load(); });

	async function save() {
		if (!session.api || !settings) return;
		status = 'Saving…';
		try {
			settings = (await session.api.saveSettings({
				ntfy: { enabled: settings.ntfy.enabled },
				whatsapp: { enabled: settings.whatsapp.enabled },
				events: settings.events,
			})).settings;
			status = 'Saved.';
		} catch (e) {
			status = '';
			error = e instanceof Error ? e.message : 'Could not save.';
		}
	}
</script>

<div class="bs-pad">
	<div class="bs-topbar">
		<PortalNav current="settings" {nav} {portal} />
		<span class="bs-mark bs-mark--sm" style="margin-left:auto;">the b/side</span>
	</div>
	<header class="bs-hero">
		<div class="bs-hero-eyebrow">{session.me?.voterName ?? 'Player'}</div>
		<h1 class="bs-hero-name">Settings</h1>
		<p class="bs-sec-sub">Reminders go out on ntfy, WhatsApp, or both. Nothing falls over to the other channel if one fails. Numbers can wait — enable WhatsApp now and Matt will attach yours.</p>
	</header>

	{#if error}<p class="err">{error}</p>{/if}
	{#if settings}
		<section class="bs-sec">
			<div class="bs-eyebrow">ntfy</div>
			<h2 class="bs-sec-title">Quiet pings</h2>
			<label class="row"><input type="checkbox" bind:checked={settings.ntfy.enabled} /> Enable ntfy</label>
			{#if settings.ntfy.enabled && settings.ntfy.topic}
				<p class="bs-sec-sub">Server <code>{settings.ntfy.server}</code> · topic <code>{settings.ntfy.topic}</code></p>
				<p class="bs-sec-sub">In the ntfy app, subscribe to that topic on our server — not ntfy.sh.</p>
			{/if}
			<ol class="how-list">
				<li>Install the ntfy app (Play Store, F-Droid, or App Store).</li>
				<li>Set the server to <code>https://ntfy.mattmariani.com</code> — not ntfy.sh.</li>
				<li>Subscribe to the topic shown above.</li>
			</ol>
			<a class="how" href="https://ntfy.mattmariani.com" target="_blank" rel="noopener">Open ntfy server →</a>
		</section>
		<section class="bs-sec">
			<div class="bs-eyebrow">WhatsApp</div>
			<h2 class="bs-sec-title">DMs from the bot</h2>
			<label class="row"><input type="checkbox" bind:checked={settings.whatsapp.enabled} /> Enable WhatsApp DMs</label>
			<p class="bs-sec-sub">
				{settings.whatsapp.linked ? 'A number is linked.' : 'No number linked yet — Matt will add yours. The toggle is ready.'}
			</p>
		</section>
		<section class="bs-sec">
			<div class="bs-eyebrow">What to ping</div>
			<h2 class="bs-sec-title">Events</h2>
			{#each events as [key, label]}
				<label class="row"><input type="checkbox" bind:checked={settings.events[key]} /> {label}</label>
			{/each}
		</section>
		<button class="bs-share-btn" onclick={save}>Save settings</button>
		{#if status}<p class="bs-sec-sub">{status}</p>{/if}
		<button class="bs-share-btn ghost" onclick={() => nav.goLogout()}>Sign out</button>
	{/if}
</div>

<style>
	.row { display: flex; gap: 10px; align-items: center; padding: 8px 0; color: var(--fg-2); font-size: 14px; }
	.err { color: var(--ember); }
	code { font-family: var(--font-mono); font-size: 12px; }
	.how { color: var(--mash-pulp); font-weight: 700; text-decoration: none; }
	.how-list { color: var(--fg-muted); font-size: 13px; padding-left: 1.2em; line-height: 1.55; }
	.ghost { background: transparent; color: var(--fg-2); border: 1px solid var(--line); margin-top: 16px; }
</style>
