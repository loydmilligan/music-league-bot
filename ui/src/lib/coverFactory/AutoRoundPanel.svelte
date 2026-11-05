<script lang="ts">
	// One round's automatic podium covers: job status, spend, each medal slot, and "Run auto now".
	import StatusChip from '$lib/components/StatusChip.svelte';
	import { cfGet, cfPost, jobActive, JOB_LABEL, SLOT_TONE, usd, type AutoRoundState } from './api';

	let {
		roundId,
		currentProjectId = null,
		onopen,
		onclose,
	}: {
		roundId: number;
		currentProjectId?: number | null;
		onopen: (projectId: number) => void;
		onclose: () => void;
	} = $props();

	let st = $state<AutoRoundState | null>(null);
	let err = $state('');
	let running = $state(false);
	let loadedFor = $state(0);

	async function load(id = roundId) {
		try {
			const r = await cfGet<AutoRoundState>(`?autoRound=${id}`);
			if (id !== roundId) return;
			st = r;
			loadedFor = id;
			err = '';
		} catch (e) {
			if (id !== roundId) return;
			err = e instanceof Error ? e.message : 'could not load the round';
			st = null;
			loadedFor = id;
		}
	}

	$effect(() => {
		const id = roundId;
		st = null;
		err = '';
		void load(id);
	});

	// Keep polling while the queue is working the round (the server poller ticks every few seconds).
	const active = $derived(jobActive(st?.job?.status) || !!st?.slots.some((s) => s.status === 'running'));
	$effect(() => {
		if (!active) return;
		const t = setInterval(() => void load(), 4000);
		return () => clearInterval(t);
	});

	async function runNow() {
		running = true;
		err = '';
		try {
			await cfPost({ action: 'run-auto', roundId });
			await load();
		} catch (e) {
			err = e instanceof Error ? e.message : 'run failed';
		} finally {
			running = false;
		}
	}

	const btn =
		'inline-flex items-center justify-center gap-2 rounded-md border border-accent-deep bg-accent-bg text-accent font-mono text-xs uppercase tracking-wider px-3 py-2 hover:bg-accent-bg-strong transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
	const btnGhost =
		'inline-flex items-center justify-center gap-2 rounded-md border border-border text-fg-muted font-mono text-xs uppercase tracking-wider px-3 py-2 hover:text-fg hover:bg-surface-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
	const medal = (rank: number) => (rank === 1 ? 'Gold' : rank === 2 ? 'Silver' : rank === 3 ? 'Bronze' : `#${rank}`);
</script>

<section class="bg-surface border border-amber/40 rounded-md p-4 space-y-3" aria-label="Podium covers for round {roundId}">
	<div class="flex flex-wrap items-start justify-between gap-3">
		<div class="min-w-0 space-y-1">
			<div class="flex items-baseline gap-3">
				<span class="font-mono text-xs text-amber">AUTO</span>
				<h2 class="font-display text-xl text-fg">Podium covers · R{roundId}</h2>
			</div>
			{#if st}
				<p class="text-sm text-fg-muted">
					{st.round.name}
					<span class="font-mono text-[10px] uppercase tracking-wider text-fg-faint ml-1">{st.round.leagueSlug}{st.round.autoOn ? '' : ' · auto-run off'}</span>
				</p>
			{/if}
		</div>
		<div class="flex flex-wrap items-center gap-2">
			{#if st?.job}<StatusChip label={JOB_LABEL[st.job.status]} tone={st.job.status === 'failed' ? 'ember' : st.job.status === 'done' ? 'health' : 'amber'} />{/if}
			{#if st}<span class="font-mono text-[10px] text-fg-dim">{usd(st.spendUsd)} spent{st.job ? ` · cap ${usd(st.job.cap_usd, 2)}` : ''}</span>{/if}
			<button type="button" class={btn} disabled={running || !st || !st.round.autoOn || active} onclick={runNow} title={st && !st.round.autoOn ? 'Turn auto-run on for this league first' : undefined}>
				{#if running}<span class="inline-block h-3 w-3 rounded-full border-2 border-current border-r-transparent animate-spin" aria-hidden="true"></span> Queuing…{:else if active}Running…{:else}Run auto now{/if}
			</button>
			<button type="button" class="{btnGhost} px-2.5" aria-label="Close round panel" onclick={onclose}>✕</button>
		</div>
	</div>

	{#if err}<p class="rounded-md border border-ember/40 bg-ember-bg px-3 py-2 text-sm text-fg" role="alert">{err}</p>{/if}

	{#if !st && loadedFor !== roundId}
		<div class="h-16 rounded-md bg-surface-hover animate-pulse" aria-busy="true"></div>
	{:else if st && !st.slots.length}
		<p class="rounded-md border border-dashed border-border px-3 py-4 text-sm text-fg-dim">
			No podium slots yet. {st.round.autoOn ? '"Run auto now" reads the active draft\'s podium and queues its medal songs.' : 'Auto-run is off for this league.'}
		</p>
	{:else if st}
		<ul class="divide-y divide-border-muted rounded-md border border-border-muted">
			{#each st.slots as s (s.id)}
				<li class="flex flex-wrap items-center gap-3 px-3 py-2 {s.project_id != null && s.project_id === currentProjectId ? 'bg-accent-bg' : ''}">
					<span class="w-14 font-mono text-[10px] uppercase tracking-wider text-fg-faint">{medal(s.rank)}</span>
					<span class="flex-1 min-w-40">
						<span class="block text-sm text-fg line-clamp-1" title={s.title}>{s.title}</span>
						{#if s.note}<span class="block font-mono text-[11px] text-amber">{s.note}</span>{/if}
					</span>
					<StatusChip label={s.status} tone={SLOT_TONE[s.status]} />
					{#if s.project_id != null}
						<button type="button" class="{btnGhost} px-2.5 py-1.5" disabled={s.project_id === currentProjectId} onclick={() => onopen(s.project_id!)}>
							{s.project_id === currentProjectId ? 'Showing' : 'Open project'}
						</button>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</section>
