<script lang="ts">
	import { untrack } from 'svelte';
	import { cfPost, type Breakdown, type Concept, type ConceptMove, type Player, type Treatment } from './api';

	let {
		projectId,
		players,
		submitterSlug = null,
		noSubjects = false,
		disabled = false,
		onapplied,
		onspent,
	}: {
		projectId: number;
		/** One entry per person. */
		players: Player[];
		submitterSlug?: string | null;
		noSubjects?: boolean;
		disabled?: boolean;
		onapplied: (r: { breakdown: Breakdown; treatments: Treatment[] }, c: Concept) => void | Promise<void>;
		/** A paid call finished (ok or not): refresh the spend line. */
		onspent: () => void;
	} = $props();

	const MOVE: Record<ConceptMove, { label: string; tone: string; hint: string }> = {
		morph: { label: 'Morph', tone: 'text-sky border-sky/40 bg-sky-bg', hint: 'Something on the cover becomes the player' },
		signature: { label: 'Signature', tone: 'text-amber border-amber/40 bg-amber/10', hint: "The player's known thing, placed in the scene" },
		recast: { label: 'Recast', tone: 'text-accent border-accent-deep bg-accent-bg', hint: 'The player takes an unexpected role' },
	};

	let picked = $state<string[]>([]);
	let addSlug = $state('');
	let concepts = $state<Concept[]>([]);
	let loading = $state(false);
	let applying = $state('');
	let applied = $state('');
	let error = $state('');
	let startedAt = $state(0);
	let now = $state(0);
	const elapsed = $derived(loading ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0);

	// Default the cast to the submitter whenever the project (and so the submitter) changes.
	// Only projectId is tracked: a player-list refresh (headshot upload, post-apply reload) must not wipe the pitches.
	$effect(() => {
		void projectId;
		untrack(() => {
			picked = submitterSlug && players.some((p) => p.slug === submitterSlug) ? [submitterSlug] : [];
			concepts = [];
			applied = '';
			error = '';
		});
	});

	$effect(() => {
		if (!loading) return;
		now = Date.now();
		const t = setInterval(() => (now = Date.now()), 250);
		return () => clearInterval(t);
	});

	const nameOf = (slug: string) => players.find((p) => p.slug === slug)?.name ?? slug;
	const addable = $derived(players.filter((p) => !picked.includes(p.slug)));

	function add(slug: string) {
		if (slug && !picked.includes(slug)) picked = [...picked, slug];
		addSlug = '';
	}

	async function pitch() {
		if (!picked.length || loading) return;
		loading = true;
		startedAt = Date.now();
		error = '';
		applied = '';
		try {
			const r = await cfPost<{ concepts: Concept[] }>({ action: 'pitch', projectId, playerSlugs: picked });
			concepts = r.concepts;
		} catch (e) {
			error = e instanceof Error ? e.message : 'pitch failed';
		} finally {
			loading = false;
			onspent();
		}
	}

	async function use(c: Concept) {
		applying = c.id;
		error = '';
		try {
			// Sent exactly as pitched: the concept id makes re-applying idempotent.
			const r = await cfPost<{ breakdown: Breakdown; treatments: Treatment[] }>({ action: 'apply-concept', projectId, concept: $state.snapshot(c) });
			await onapplied(r, c);
			applied = c.id;
		} catch (e) {
			error = e instanceof Error ? e.message : 'could not apply concept';
		} finally {
			applying = '';
		}
	}

	function summary(c: Concept): string {
		const swaps = c.treatments.filter((t) => t.mode === 'player').length;
		const removes = c.treatments.filter((t) => t.mode === 'remove').length;
		return [
			c.addSubjects.length ? `adds ${c.addSubjects.length} subject${c.addSubjects.length === 1 ? '' : 's'}` : '',
			swaps ? `${swaps} swap${swaps === 1 ? '' : 's'}` : '',
			removes ? `removes ${removes}` : '',
		]
			.filter(Boolean)
			.join(' · ');
	}

	const btn =
		'inline-flex items-center justify-center gap-2 rounded-md border border-accent-deep bg-accent-bg text-accent font-mono text-xs uppercase tracking-wider px-3 py-2 hover:bg-accent-bg-strong transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
	const btnSolid =
		'inline-flex items-center justify-center gap-2 rounded-md bg-accent text-bg font-mono text-xs font-bold uppercase tracking-wider px-4 py-2.5 hover:bg-accent-strong transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
</script>

<section class="@container rounded-md border border-border-muted bg-bg-elevated p-3 space-y-3" aria-labelledby="pitch-h" aria-busy={loading}>
	<div class="flex flex-wrap items-start justify-between gap-3">
		<div class="space-y-0.5 min-w-0">
			<h3 id="pitch-h" class="font-mono text-[11px] uppercase tracking-wider text-fg-dim">Concept pitches</h3>
			<p class="text-xs {noSubjects ? 'text-warn' : 'text-fg-dim'}">
				{noSubjects ? 'No people on this cover — pitch a gag.' : 'Gag plans from the players’ profiles: morph, signature or recast.'}
			</p>
		</div>
		<button type="button" class={noSubjects ? btnSolid : btn} disabled={disabled || loading || !picked.length} onclick={pitch}>
			{#if loading}
				<span class="inline-block h-3 w-3 rounded-full border-2 border-current border-r-transparent animate-spin" aria-hidden="true"></span>
				Pitching… {elapsed}s
			{:else}
				{concepts.length ? 'Pitch again' : 'Pitch me concepts'}
			{/if}
		</button>
	</div>

	<div class="flex flex-wrap items-center gap-1.5">
		<span class="font-mono text-[10px] uppercase tracking-wider text-fg-faint mr-1">Starring</span>
		{#each picked as slug (slug)}
			<span class="inline-flex items-center gap-1 rounded-sm border border-border bg-surface pl-2 pr-1 py-0.5 text-xs text-fg">
				{nameOf(slug)}{slug === submitterSlug ? ' (submitter)' : ''}
				<button
					type="button"
					class="px-1 font-mono text-[10px] text-fg-faint hover:text-fg"
					aria-label="Remove {nameOf(slug)}"
					disabled={loading}
					onclick={() => (picked = picked.filter((s) => s !== slug))}>✕</button
				>
			</span>
		{/each}
		{#if !picked.length}<span class="text-xs text-warn">Choose at least one player.</span>{/if}
		<select
			class="bg-bg border border-border-muted rounded-sm px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-fg-dim focus:border-accent focus:outline-none"
			aria-label="Add a player to the pitch"
			bind:value={addSlug}
			disabled={loading || !addable.length}
			onchange={() => add(addSlug)}
		>
			<option value="">+ Add player</option>
			{#each addable as p (p.slug)}
				<option value={p.slug}>{p.name}</option>
			{/each}
		</select>
	</div>

	{#if error}
		<p class="rounded-md border border-ember/40 bg-ember-bg px-2.5 py-1.5 text-xs text-fg" role="alert">{error}</p>
	{/if}

	{#if loading && !concepts.length}
		<div class="grid gap-2 @lg:grid-cols-2" aria-hidden="true">
			{#each [0, 1] as k (k)}
				<div class="h-24 rounded-md bg-surface-hover animate-pulse"></div>
			{/each}
		</div>
	{:else if concepts.length}
		<ul class="grid gap-2 @lg:grid-cols-2" class:opacity-60={loading}>
			{#each concepts as c (c.id)}
				{@const m = MOVE[c.move]}
				{@const isApplied = applied === c.id}
				<li class="flex flex-col gap-2 rounded-md border bg-surface p-2.5 {isApplied ? 'border-health/50' : 'border-border-muted'}">
					<div class="flex items-center gap-2">
						<span class="rounded-sm border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider {m.tone}" title={m.hint}>{m.label}</span>
						<h4 class="text-sm font-medium text-fg leading-tight line-clamp-2" title={c.title}>{c.title}</h4>
					</div>
					<p class="text-sm text-fg-muted leading-snug">{c.plan}</p>
					<div class="mt-auto flex items-center justify-between gap-2">
						<span class="font-mono text-[10px] text-fg-faint">{summary(c)}</span>
						<button
							type="button"
							class="shrink-0 rounded-md border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors disabled:opacity-50 disabled:cursor-not-allowed {isApplied
								? 'border-health/40 bg-health-bg text-health'
								: 'border-accent-deep bg-accent-bg text-accent hover:bg-accent-bg-strong'}"
							disabled={disabled || loading || !!applying}
							onclick={() => use(c)}
						>
							{applying === c.id ? 'Applying…' : isApplied ? 'Applied ✓' : 'Use this'}
						</button>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</section>
