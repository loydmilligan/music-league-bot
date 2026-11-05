<script lang="ts">
	import { untrack } from 'svelte';
	import { cfPost, type AltCover, type AlternatesResult, type Project } from './api';

	let {
		project,
		noPeople = false,
		disabled = false,
		open = $bindable(false),
		onchanged,
	}: {
		project: Project;
		/** The read found no people: open the panel with a hint (another edition may have some). */
		noPeople?: boolean;
		disabled?: boolean;
		open?: boolean;
		/** The cover was switched or restored. The page clears the read and asks for a re-read. */
		onchanged: (p: Project, to: 'alternate' | 'original') => void;
	} = $props();

	let alternates = $state<AltCover[]>([]);
	let currentId = $state<string | null>(null);
	let loaded = $state(false);
	let loading = $state(false);
	let message = $state('');
	let error = $state('');
	let switching = $state('');
	let q = $state('');
	// The search the shown list came from, so a refresh asks the same question.
	let lastQ = '';

	const hasTerms = $derived(!!(project.song_title && project.song_artist));
	const switched = $derived(!!project.original_cover_rel && project.cover_rel !== project.original_cover_rel);
	const showSearch = $derived(!hasTerms || (loaded && !alternates.length));

	// A primitive: a refreshed project object with the same id must not re-run the effects below.
	const pid = $derived(project.id);

	// A different project starts collapsed with nothing loaded.
	$effect(() => {
		void pid;
		untrack(() => {
			open = false;
			alternates = [];
			currentId = null;
			loaded = false;
			message = '';
			error = '';
			q = '';
			lastQ = '';
		});
	});

	// The cover changed from outside this panel too (a pitched alternate concept): re-list
	// (song-keyed cache hit, free) so the "Current" badge and the hidden-original edition follow it.
	const coverKey = $derived(`${project.cover_rel}|${project.original_cover_rel ?? ''}`);
	let seenCover = '';
	$effect(() => {
		const k = coverKey;
		untrack(() => {
			const changed = seenCover !== '' && seenCover !== k;
			seenCover = k;
			if (changed && loaded && !loading && (hasTerms || lastQ)) void load(lastQ || undefined);
		});
	});

	// No people on the cover: open the panel (and list, which is free) without being asked.
	$effect(() => {
		void pid; // runs after the reset above, so a new no-people project opens too
		if (noPeople && !untrack(() => open)) untrack(() => toggle());
	});

	function toggle() {
		open = !open;
		if (open && !loaded && !loading && hasTerms) void load();
	}

	async function load(search?: string) {
		loading = true;
		error = '';
		message = '';
		try {
			const r = await cfPost<AlternatesResult>({ action: 'alternates', projectId: project.id, ...(search ? { q: search } : {}) });
			// Busy / no match: keep what is on screen (the server kept it too).
			if (!r.message) {
				alternates = r.alternates;
				lastQ = search ?? '';
			}
			currentId = r.currentId;
			message = r.message ?? '';
			loaded = true;
		} catch (e) {
			error = e instanceof Error ? e.message : 'could not list alternate covers';
		} finally {
			loading = false;
		}
	}

	function search(e: SubmitEvent) {
		e.preventDefault();
		if (q.trim()) void load(q.trim());
	}

	async function use(a: AltCover) {
		switching = a.id;
		error = '';
		try {
			const r = await cfPost<{ project: Project; unchanged?: boolean }>({ action: 'use-alternate', projectId: project.id, alternateId: a.id });
			currentId = a.id;
			if (!r.unchanged) onchanged(r.project, 'alternate');
		} catch (e) {
			error = e instanceof Error ? e.message : 'could not switch the cover';
		} finally {
			switching = '';
		}
	}

	async function restore() {
		switching = 'original';
		error = '';
		try {
			const r = await cfPost<{ project: Project }>({ action: 'restore-original', projectId: project.id });
			currentId = null;
			onchanged(r.project, 'original');
		} catch (e) {
			error = e instanceof Error ? e.message : 'could not restore the original';
		} finally {
			switching = '';
		}
	}

	const meta = (a: AltCover) => [a.kind, a.date?.slice(0, 4), a.country].filter(Boolean).join(' · ');

	const btnGhost =
		'inline-flex items-center justify-center gap-2 rounded-md border border-border text-fg-muted font-mono text-[10px] uppercase tracking-wider px-2.5 py-1.5 hover:text-fg hover:bg-surface-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
</script>

<section class="rounded-md border border-border-muted bg-bg-elevated p-2.5 space-y-2.5" aria-labelledby="alt-h" aria-busy={loading}>
	<div class="flex flex-wrap items-center justify-between gap-2">
		<button
			type="button"
			id="alt-h"
			class="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-fg-dim hover:text-fg"
			aria-expanded={open}
			aria-controls="alt-body"
			onclick={toggle}
		>
			<span aria-hidden="true" class="inline-block w-2 transition-transform {open ? 'rotate-90' : ''}">›</span>
			Alternate covers{loaded && alternates.length ? ` (${alternates.length})` : ''}
		</button>
		{#if switched}
			<button type="button" class={btnGhost} disabled={disabled || !!switching} onclick={restore}>
				{switching === 'original' ? 'Restoring…' : 'Back to original'}
			</button>
		{/if}
	</div>

	{#if open}
		<div id="alt-body" class="space-y-2.5">
			{#if noPeople}
				<p class="text-xs text-warn">No people on this cover. Another edition of the song may have someone to swap.</p>
			{:else}
				<p class="text-xs text-fg-dim">Other editions of this song (singles, reissues, other countries). Listing is free.</p>
			{/if}

			{#if showSearch}
				<form class="flex gap-1.5" onsubmit={search}>
					<input
						class="min-w-0 flex-1 bg-bg border border-border rounded-md px-2 py-1.5 text-xs text-fg placeholder:text-fg-faint focus:border-accent focus:outline-none"
						placeholder="Song — Artist"
						aria-label="Search alternate covers as song — artist"
						bind:value={q}
						disabled={loading}
					/>
					<button type="submit" class={btnGhost} disabled={loading || !q.trim()}>Search</button>
				</form>
			{/if}

			{#if error}
				<p class="rounded-md border border-ember/40 bg-ember-bg px-2 py-1.5 text-xs text-fg" role="alert">{error}</p>
			{/if}
			{#if message}
				<div class="flex items-center justify-between gap-2 rounded-md border border-warn/40 bg-warn/10 px-2 py-1.5 text-xs text-warn" role="status">
					<span>{message}</span>
					{#if hasTerms || q.trim()}
						<button type="button" class="font-mono text-[10px] uppercase tracking-wider underline" disabled={loading} onclick={() => load(q.trim() || undefined)}>Retry</button>
					{/if}
				</div>
			{/if}

			{#if loading}
				<p class="flex items-center gap-2 font-mono text-[10px] text-fg-dim">
					<span class="inline-block h-3 w-3 rounded-full border-2 border-current border-r-transparent animate-spin" aria-hidden="true"></span>
					Asking MusicBrainz… (up to ~10 s)
				</p>
				{#if !alternates.length}
					<div class="grid grid-cols-2 gap-2" aria-hidden="true">
						{#each [0, 1, 2, 3] as k (k)}
							<div class="aspect-square rounded-sm bg-surface-hover animate-pulse"></div>
						{/each}
					</div>
				{/if}
			{:else if loaded && !alternates.length && !message}
				<p class="text-xs text-fg-dim">No alternate covers found.</p>
			{/if}

			{#if alternates.length}
				<ul class="grid grid-cols-2 gap-2" class:opacity-60={loading}>
					{#each alternates as a (a.id)}
						{@const current = a.id === currentId}
						<li class="flex flex-col gap-1 rounded-sm border p-1 {current ? 'border-accent/60 bg-accent-bg' : 'border-border-muted bg-surface'}">
							<div class="relative">
								<img src={a.thumbUrl} alt="{a.title} ({meta(a)})" loading="lazy" class="w-full aspect-square object-cover rounded-sm bg-bg" />
								{#if current}
									<span class="absolute left-1 top-1 rounded-sm bg-accent px-1 font-mono text-[9px] font-bold uppercase tracking-wider text-bg">Current</span>
								{/if}
							</div>
							<span class="text-[11px] leading-tight text-fg line-clamp-1" title={a.title}>{a.title}</span>
							<span class="font-mono text-[9px] text-fg-dim line-clamp-1" title={meta(a)}>{meta(a) || 'undated'}</span>
							<button
								type="button"
								class="mt-auto rounded-sm border border-accent-deep bg-accent-bg px-1.5 py-1 font-mono text-[9px] uppercase tracking-wider text-accent hover:bg-accent-bg-strong transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
								disabled={disabled || current || !!switching}
								onclick={() => use(a)}
							>
								{switching === a.id ? 'Switching…' : current ? 'In use' : 'Use this cover'}
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/if}
</section>
