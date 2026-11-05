<script lang="ts">
	// Header "Auto-run" popover: per-league round-end auto-run toggles, recent auto jobs, open a round's slot panel.
	import { cfGet, cfPost, JOB_LABEL, type AutoLeaguesState } from './api';

	let { onround }: { onround: (roundId: number) => void } = $props();

	let open = $state(false);
	let st = $state<AutoLeaguesState | null>(null);
	let err = $state('');
	let saving = $state('');
	let roundInput = $state('');
	let root = $state<HTMLElement | undefined>(undefined);

	const onCount = $derived(st?.leagues.filter((l) => l.on).length ?? null);

	async function load() {
		err = '';
		try {
			st = await cfGet<AutoLeaguesState>('?autoLeagues=1');
		} catch (e) {
			err = e instanceof Error ? e.message : 'could not load auto-run settings';
		}
	}

	async function toggle(slug: string, on: boolean) {
		saving = slug;
		err = '';
		try {
			st = await cfPost<AutoLeaguesState>({ action: 'auto-leagues', slug, on });
		} catch (e) {
			err = e instanceof Error ? e.message : 'could not save';
			await load();
		} finally {
			saving = '';
		}
	}

	function show(id: number) {
		open = false;
		onround(id);
	}

	function submitRound(e: SubmitEvent) {
		e.preventDefault();
		const n = Number(roundInput);
		if (Number.isInteger(n) && n > 0) show(n);
	}

	// Load once for the header count, and again on every open (fresh jobs list).
	$effect(() => {
		if (open || !st) void load();
	});

	function outside(e: MouseEvent) {
		if (open && root && !root.contains(e.target as Node)) open = false;
	}
</script>

<svelte:window onclick={outside} onkeydown={(e) => open && e.key === 'Escape' && (open = false)} />

<div class="relative" bind:this={root}>
	<button
		type="button"
		class="inline-flex items-center gap-1.5 rounded-sm border px-2 py-1 transition-colors {open ? 'border-accent/60 bg-accent-bg' : 'border-border-muted bg-surface hover:border-border'}"
		aria-expanded={open}
		aria-haspopup="dialog"
		onclick={() => (open = !open)}
	>
		<span class="font-mono text-[10px] uppercase tracking-wider text-fg-faint">Auto-run</span>
		<span class="font-mono text-[11px] text-amber">{onCount == null ? '…' : `${onCount} on`}</span>
	</button>

	{#if open}
		<div
			class="absolute right-0 top-full z-30 mt-1.5 w-80 rounded-md border border-border bg-bg-elevated p-3 text-left shadow-lg space-y-3"
			role="dialog"
			aria-label="Automatic round-end covers"
		>
			<div>
				<p class="font-mono text-[10px] uppercase tracking-wider text-fg-faint">Round-end auto covers</p>
				<p class="mt-1 text-xs text-fg-dim">When a round's digest draft is built, ON leagues get a gag cover for each medal song. $1 per round, then an ntfy asks before going to $2.</p>
			</div>
			{#if err}<p class="text-xs text-ember" role="alert">{err}</p>{/if}
			{#if !st}
				<p class="text-xs text-fg-dim">Loading…</p>
			{:else}
				<ul class="space-y-1">
					{#each st.leagues as l (l.slug)}
						<li>
							<label class="flex items-center justify-between gap-3 rounded-sm px-1.5 py-1 hover:bg-surface cursor-pointer">
								<span class="text-sm {l.on ? 'text-fg' : 'text-fg-muted'}">{l.name}</span>
								<input
									type="checkbox"
									class="h-4 w-4 accent-[var(--color-amber)]"
									checked={l.on}
									disabled={saving === l.slug}
									aria-label="Auto-run for {l.name}"
									onchange={(e) => toggle(l.slug, (e.currentTarget as HTMLInputElement).checked)}
								/>
							</label>
						</li>
					{/each}
				</ul>
				<div class="border-t border-border-muted pt-3 space-y-2">
					<p class="font-mono text-[10px] uppercase tracking-wider text-fg-faint">Rounds</p>
					{#if st.jobs.length}
						<ul class="flex flex-wrap gap-1.5">
							{#each st.jobs as j (j.round_id)}
								<li>
									<button
										type="button"
										class="inline-flex items-center gap-1.5 rounded-sm border border-border-muted bg-surface px-2 py-1 font-mono text-[10px] hover:border-border"
										title="{j.roundName ?? ''} · {j.leagueSlug ?? ''}"
										onclick={() => show(j.round_id)}
									>
										<span class="text-fg">R{j.round_id}</span>
										<span class={j.status === 'failed' ? 'text-ember' : j.status === 'done' ? 'text-health' : 'text-amber'}>{JOB_LABEL[j.status]}</span>
									</button>
								</li>
							{/each}
						</ul>
					{:else}
						<p class="text-xs text-fg-dim">No auto runs yet.</p>
					{/if}
					<form class="flex items-center gap-1.5" onsubmit={submitRound}>
						<input
							class="w-24 font-mono bg-bg border border-border rounded-md px-2 py-1 text-xs text-fg placeholder:text-fg-faint focus:border-accent focus:outline-none"
							inputmode="numeric"
							placeholder="Round #"
							aria-label="Round id"
							bind:value={roundInput}
						/>
						<button type="submit" class="rounded-md border border-border px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-fg-muted hover:text-fg hover:bg-surface-hover">Podium slots</button>
					</form>
				</div>
			{/if}
		</div>
	{/if}
</div>
