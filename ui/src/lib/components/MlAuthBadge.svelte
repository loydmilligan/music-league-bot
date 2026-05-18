<!--
  MlAuthBadge — small status dot for the Music League session state.

  Click behaviour:
    - green/unknown: recheck status (fast probe)
    - red (expired): POST to host login trigger → terminal pops up on host,
      then we auto-poll status every 8s for up to 5min until it flips green.
    - amber (cli-missing): recheck only — login trigger lives outside the
      container too, so it'd still be unreachable.
-->
<script lang="ts">
	import { onMount, onDestroy } from 'svelte';

	type State = {
		status: 'ok' | 'expired' | 'unknown' | 'cli-missing';
		lastCheckedAt: string | null;
		lastOkAt: string | null;
		message: string | null;
	};

	let auth: State = $state({
		status: 'unknown',
		lastCheckedAt: null,
		lastOkAt: null,
		message: null
	});
	let busy = $state(false);
	let waitingForLogin = $state(false);
	let loginNote = $state<string | null>(null);
	let pollTimer: ReturnType<typeof setInterval> | null = null;
	let loginPollTimer: ReturnType<typeof setInterval> | null = null;

	async function fetchStatus() {
		try {
			const res = await fetch('/api/ml-auth');
			if (res.ok) auth = (await res.json()) as State;
		} catch {
			// ignore — keep prior state
		}
	}

	async function recheck() {
		if (busy) return;
		busy = true;
		try {
			const res = await fetch('/api/ml-auth', { method: 'POST' });
			if (res.ok) auth = (await res.json()) as State;
		} finally {
			busy = false;
		}
	}

	async function triggerLogin() {
		if (busy) return;
		busy = true;
		loginNote = null;
		try {
			const res = await fetch('/api/ml-auth/login', { method: 'POST' });
			const body = (await res.json().catch(() => ({}))) as {
				ok?: boolean;
				terminal?: string;
				message?: string;
				error?: string;
			};
			if (res.ok && body.ok) {
				loginNote = `Spawned ${body.terminal ?? 'terminal'} on the host. Complete Spotify OAuth and press Enter in that window.`;
				waitingForLogin = true;
				startLoginWatch();
			} else {
				loginNote = body.error ?? 'Could not reach the host login trigger.';
			}
		} catch (err) {
			loginNote = err instanceof Error ? err.message : 'Network error';
		} finally {
			busy = false;
		}
	}

	function startLoginWatch() {
		// Poll the status endpoint every 8s for up to 5min after firing the trigger.
		// Stops on first ok or after timeout.
		if (loginPollTimer) clearInterval(loginPollTimer);
		const startedAt = Date.now();
		const TIMEOUT_MS = 5 * 60 * 1000;
		loginPollTimer = setInterval(async () => {
			if (Date.now() - startedAt > TIMEOUT_MS) {
				clearInterval(loginPollTimer!);
				loginPollTimer = null;
				waitingForLogin = false;
				loginNote = 'Still expired after 5min. Click again to retry.';
				return;
			}
			try {
				const res = await fetch('/api/ml-auth', { method: 'POST' });
				if (res.ok) {
					auth = (await res.json()) as State;
					if (auth.status === 'ok') {
						clearInterval(loginPollTimer!);
						loginPollTimer = null;
						waitingForLogin = false;
						loginNote = null;
					}
				}
			} catch {
				// keep trying
			}
		}, 8_000);
	}

	function onClick() {
		if (auth.status === 'expired') return triggerLogin();
		return recheck();
	}

	onMount(() => {
		void fetchStatus();
		pollTimer = setInterval(fetchStatus, 60_000);
	});

	onDestroy(() => {
		if (pollTimer) clearInterval(pollTimer);
		if (loginPollTimer) clearInterval(loginPollTimer);
	});

	const dotClass = $derived(
		auth.status === 'ok'
			? 'bg-health'
			: auth.status === 'expired'
				? 'bg-accent'
				: auth.status === 'cli-missing'
					? 'bg-warn'
					: 'bg-fg-faint'
	);

	const title = $derived(
		auth.status === 'ok'
			? `Music League session OK (checked ${formatTime(auth.lastCheckedAt)})`
			: auth.status === 'expired'
				? waitingForLogin
					? 'Waiting for you to complete Spotify OAuth on the host…'
					: 'Click to launch Spotify login on the host'
				: auth.status === 'cli-missing'
					? `cli-web-musicleague not on PATH: ${auth.message ?? ''}`
					: auth.message
					  ? `Unknown — ${auth.message}`
					  : 'Music League session: not yet checked'
	);

	function formatTime(iso: string | null): string {
		if (!iso) return 'never';
		const d = new Date(iso);
		const ago = Math.round((Date.now() - d.getTime()) / 1000);
		if (ago < 60) return `${ago}s ago`;
		if (ago < 3600) return `${Math.round(ago / 60)}m ago`;
		return d.toLocaleTimeString();
	}
</script>

<button
	type="button"
	class="flex items-center gap-1.5 text-xs text-fg-muted hover:text-fg-default transition-colors disabled:opacity-50"
	onclick={onClick}
	disabled={busy}
	{title}
	aria-label={title}
>
	<span
		class="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 {dotClass} {busy || waitingForLogin ? 'animate-pulse' : ''}"
	></span>
	<span class="font-mono uppercase tracking-wide">
		{#if auth.status === 'ok'}
			ml ok
		{:else if auth.status === 'expired'}
			{waitingForLogin ? 'ml waiting…' : 'ml login'}
		{:else if auth.status === 'cli-missing'}
			ml ?
		{:else}
			ml…
		{/if}
	</span>
</button>

{#if loginNote}
	<div class="mt-1 text-[10px] text-fg-muted leading-tight max-w-[200px]">{loginNote}</div>
{/if}
