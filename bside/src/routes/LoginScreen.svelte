<script lang="ts">
	import PortalNav from '../lib/atoms/PortalNav.svelte';
	import { getPortalSession } from '../lib/portalSession.js';
	import { SurveyApiError, type LoginCodeRequest } from '../lib/surveyApi.js';
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
	// WhatsApp login-code flow (league setting loginCode: notify | approve).
	let codeRequest = $state<LoginCodeRequest | null>(null);
	let busy = $state(false);
	const codeLogin = $derived((session.me?.loginCode ?? 'off') !== 'off');

	const FAIL_TEXT: Record<string, string> = {
		no_number: 'No WhatsApp number on file for you. Ask Matt.',
		unknown_player: 'No WhatsApp number on file for you. Ask Matt.',
		rate_limited: 'Too many codes this hour. Try again later.',
		send_failed: "Couldn't send the code. Matt's been notified.",
	};

	$effect(() => {
		const api = session.api;
		if (!api) { loading = false; return; }
		api.roster().then((r) => { names = r.names; }).catch((e: unknown) => {
			error = e instanceof Error ? e.message : 'Could not load the roster.';
		}).finally(() => { loading = false; });
	});

	// While an approve-mode request waits on Matt, poll its status.
	$effect(() => {
		const req = codeRequest;
		const api = session.api;
		if (!req || req.status !== 'pending' || !api) return;
		const timer = setInterval(async () => {
			try {
				const r = await api.codeStatus(req.id);
				if (r.request.status !== 'pending') codeRequest = r.request;
			} catch { /* keep polling */ }
		}, 3000);
		return () => clearInterval(timer);
	});

	async function pick(name: string) {
		if (!session.api) return;
		if (codeLogin) return requestCode(name);
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

	async function requestCode(name: string) {
		if (!session.api || busy) return;
		error = null;
		code = '';
		pendingName = name;
		busy = true;
		try {
			codeRequest = (await session.api.requestCode(name)).request;
		} catch (e) {
			codeRequest = null;
			error = e instanceof Error ? e.message : 'Could not request a code.';
		} finally {
			busy = false;
		}
	}

	async function verify() {
		if (!session.api || busy) return;
		error = null;
		busy = true;
		try {
			await session.api.verifyCode(pendingName, code.trim());
			codeRequest = null;
			code = '';
			await session.refresh();
			nav.goHome();
		} catch (e) {
			const left = e instanceof SurveyApiError ? (e.body as { attemptsLeft?: number })?.attemptsLeft : undefined;
			error = (e instanceof Error ? e.message : 'Could not sign in.')
				+ (typeof left === 'number' ? ` (${left} ${left === 1 ? 'try' : 'tries'} left)` : '');
		} finally {
			busy = false;
		}
	}

	function cancelCode() {
		codeRequest = null;
		code = '';
		error = null;
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
		{#if codeLogin}
			<p class="bs-sec-sub">Pick your name and the bot will WhatsApp you a 6-digit code.</p>
		{:else}
			<p class="bs-sec-sub">Pick your name. First pick on a device is free. Switching later needs Matt to Activate a code.</p>
		{/if}
	</header>
	{#if session.me?.authenticated}
		<p class="bs-sec-sub">Signed in as <b>{session.me.voterName}</b>.</p>
		<button class="bs-share-btn" onclick={() => nav.goLogout()}>Not you? Sign out</button>
	{/if}
	{#if loading}
		<div class="season-status">Loading the roster…</div>
	{:else if codeLogin && codeRequest}
		{#if error}<p class="bs-error-inline">{error}</p>{/if}
		{#if codeRequest.status === 'pending'}
			<div class="season-status">Waiting for Matt to approve your sign-in, {pendingName}. Your code will arrive on WhatsApp once he does.</div>
		{:else if codeRequest.status === 'sent'}
			<label class="bs-field">
				<span>Code sent to {pendingName}'s WhatsApp</span>
				<input bind:value={code} inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000" />
			</label>
			<button class="bs-share-btn" disabled={busy || code.trim().length !== 6} onclick={verify}>Sign in</button>
		{:else if codeRequest.status === 'denied'}
			<p class="bs-error-inline">That sign-in request was denied.</p>
		{:else if codeRequest.status === 'expired'}
			<p class="bs-error-inline">That request expired. Ask for a new code.</p>
		{:else}
			<p class="bs-error-inline">{FAIL_TEXT[codeRequest.reason ?? 'send_failed'] ?? FAIL_TEXT.send_failed}</p>
		{/if}
		<div class="bs-code-actions">
			{#if codeRequest.status !== 'pending'}
				<button class="bs-share-btn" disabled={busy} onclick={() => requestCode(pendingName)}>Send a new code</button>
			{/if}
			<button class="bs-share-btn" onclick={cancelCode}>Not {pendingName}?</button>
		</div>
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
				<button class="bs-player" disabled={busy} onclick={() => pick(name)}>
					<span class="bs-player-name">{name}</span>
				</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.bs-error-inline { color: var(--ember); font-size: 13px; }
	.bs-field { display: flex; flex-direction: column; gap: 6px; font-size: 13px; }
	.bs-field input { padding: 10px 12px; border-radius: var(--r-3); border: 1px solid var(--line); background: var(--ink-1); color: var(--fg); font-size: 16px; letter-spacing: 0.3em; }
	.bs-code-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
	.season-status { padding: 22px; border: 1px solid var(--line); border-radius: var(--r-5); color: var(--fg-muted); background: var(--ink-1); }
</style>
