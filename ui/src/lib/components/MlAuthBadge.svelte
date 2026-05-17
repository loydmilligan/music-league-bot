<!--
  MlAuthBadge — small status dot for the Music League session state.

  - green: session valid (cli probe succeeded within the last 5min)
  - red:   session expired (user needs to re-run `cli-web-musicleague auth login`)
  - amber: probe failed for a reason that isn't auth (network, timeout)
  - gray:  unknown (no probe yet)

  Click → triggers an immediate POST /api/ml-auth recheck and shows the result.
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
	let pollTimer: ReturnType<typeof setInterval> | null = null;

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

	onMount(() => {
		void fetchStatus();
		// Lightweight client poll — backend heartbeat is the real driver
		pollTimer = setInterval(fetchStatus, 60_000);
	});

	onDestroy(() => {
		if (pollTimer) clearInterval(pollTimer);
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
				? 'Music League session expired — run: cli-web-musicleague auth login'
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
	on:click={recheck}
	disabled={busy}
	{title}
	aria-label={title}
>
	<span
		class="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 {dotClass} {busy ? 'animate-pulse' : ''}"
	></span>
	<span class="font-mono uppercase tracking-wide">
		{#if auth.status === 'ok'}
			ml ok
		{:else if auth.status === 'expired'}
			ml login
		{:else if auth.status === 'cli-missing'}
			ml ?
		{:else}
			ml…
		{/if}
	</span>
</button>
