<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { page } from '$app/state';
	import { replaceState } from '$app/navigation';
	import SectionLabel from '$lib/components/SectionLabel.svelte';
	import StatusChip from '$lib/components/StatusChip.svelte';
	import CoverPicker from '$lib/coverFactory/CoverPicker.svelte';
	import SubjectCard from '$lib/coverFactory/SubjectCard.svelte';
	import VersionCard from '$lib/coverFactory/VersionCard.svelte';
	import {
		ApiFailure,
		cfGet,
		cfPost,
		cfUpload,
		exportUrl,
		mediaUrl,
		reasonText,
		shortModel,
		usd,
		type Breakdown,
		type HomeState,
		type Player,
		type Project,
		type ProjectState,
		type RatingKey,
		type Treatment,
		type Version,
	} from '$lib/coverFactory/api';
	import { jobOptionLabel, modelsForJob, type JobModel } from '$lib/models/jobs';

	let { data } = $props();

	let home = $state<HomeState | null>((data as { initial: HomeState | null }).initial);
	let ps = $state<ProjectState | null>(null);
	let bd = $state<Breakdown | null>(null);
	let tr = $state<Treatment[]>([]);
	// Read ?project= during SSR too, so a deep link never flashes the cover picker.
	const initialProject = (() => {
		const n = Number(page.url.searchParams.get('project'));
		return Number.isInteger(n) && n > 0 ? n : null;
	})();
	let selectedId = $state<number | null>(initialProject);
	let loadingProject = $state(initialProject !== null);
	let creating = $state(false);

	let busy = $state('');
	let startedAt = $state(0);
	let now = $state(0);
	let notice = $state<{ tone: 'ember' | 'warn' | 'health'; text: string } | null>(
		(data as { error?: string | null }).error ? { tone: 'ember', text: (data as { error: string }).error } : null,
	);
	let paused = $state(false);

	let models = $state<(JobModel & { id: number })[]>([]);
	let genModel = $state('');
	let promptOpen = $state(false);
	let promptText = $state('');
	let promptEdited = $state(false);
	let promptLoading = $state(false);

	let share = $state<{ stillUrl: string; gifUrl: string } | null>(null);
	let copied = $state('');
	let gifReady = $state(false);
	let quickSlug = $state('');

	const leagues = $derived(home?.leagues ?? []);
	const projects = $derived(home?.projects ?? []);
	const project = $derived(ps?.project ?? null);
	const players = $derived<Player[]>(ps?.players ?? []);
	// A player in several leagues appears once per league; the quick picker needs each person once.
	const uniquePlayers = $derived(
		[...new Map(players.map((p) => [p.slug, p])).values()].sort((a, b) => a.name.localeCompare(b.name)),
	);
	const versionsNewest = $derived([...(ps?.versions ?? [])].sort((a, b) => b.try_no - a.try_no));
	const keeper = $derived(ps?.versions.find((v) => v.id === project?.keeper_version_id) ?? null);
	const generators = $derived(modelsForJob(models, 'generator'));
	const pinnedGenerator = $derived(home?.models.generator ?? null);
	const elapsed = $derived(busy && startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0);

	const playerTreatments = $derived(tr.filter((t) => t.mode === 'player'));
	const generateBlocker = $derived.by(() => {
		if (!bd) return 'Read the cover first.';
		if (!playerTreatments.length) return 'Set at least one subject to Player.';
		const noPick = playerTreatments.find((t) => !t.playerSlug);
		if (noPick) return `Pick a player for ${noPick.label}.`;
		const missing = playerTreatments
			.map((t) => players.find((p) => p.slug === t.playerSlug))
			.find((p) => p?.missing);
		if (missing) return `Upload a headshot for ${missing.name}.`;
		return '';
	});

	$effect(() => {
		if (!busy) return;
		now = Date.now();
		const t = setInterval(() => (now = Date.now()), 250);
		return () => clearInterval(t);
	});

	// Opening the preview builds it once; later rebuilds happen on save or on request.
	$effect(() => {
		if (promptOpen && bd && project && !untrack(() => promptText || promptLoading)) untrack(() => void loadPreview());
	});

	onMount(async () => {
		if (initialProject) void openProject(initialProject);
		else if (!projects.length) creating = true;
		try {
			const r = await fetch('/api/models');
			if (r.ok) models = await r.json();
		} catch {
			/* model list is optional; the pinned generator still works */
		}
	});

	const plain = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

	function syncTreatments(b: Breakdown | null, saved: Treatment[]): Treatment[] {
		if (!b) return [];
		return b.subjects.map((s) => saved.find((t) => t.label === s.label) ?? { label: s.label, mode: 'keep' });
	}

	function fail(e: unknown, fallback: string) {
		if (e instanceof ApiFailure && e.status === 409 && e.reason === 'paused') {
			paused = true;
			notice = { tone: 'warn', text: e.message };
			return;
		}
		notice = { tone: 'ember', text: e instanceof Error ? e.message : fallback };
	}

	function begin(what: string) {
		busy = what;
		startedAt = Date.now();
		notice = null;
	}

	async function refreshHome() {
		try {
			home = await cfGet<HomeState>('');
		} catch {
			/* keep the stale list */
		}
	}

	async function loadProject(id: number) {
		const j = await cfGet<ProjectState>(`?project=${id}`);
		if (selectedId !== id) return;
		ps = j;
		bd = j.breakdown ? plain(j.breakdown) : null;
		tr = syncTreatments(bd, plain(j.treatments));
		const sub = j.submitter && j.players.some((p) => p.slug === j.submitter!.slug) ? j.submitter.slug : '';
		if (!quickSlug || !j.players.some((p) => p.slug === quickSlug)) quickSlug = sub;
	}

	async function openProject(id: number) {
		selectedId = id;
		creating = false;
		share = null;
		gifReady = false;
		promptOpen = false;
		promptText = '';
		promptEdited = false;
		quickSlug = '';
		notice = null;
		loadingProject = true;
		try {
			await loadProject(id);
			replaceState(`?project=${id}`, {});
		} catch (e) {
			fail(e, 'could not load project');
			ps = null;
		} finally {
			loadingProject = false;
		}
	}

	function newCover() {
		creating = true;
		selectedId = null;
		ps = null;
		bd = null;
		tr = [];
		notice = null;
		replaceState('?', {});
	}

	async function onCreated(p: Project) {
		await refreshHome();
		await openProject(p.id);
		if (!bd) void readCover();
	}

	async function readCover() {
		if (!project) return;
		begin('read');
		try {
			const r = await cfPost<{ breakdown: Breakdown; treatments: Treatment[] }>({ action: 'read', projectId: project.id });
			bd = plain(r.breakdown);
			tr = syncTreatments(bd, plain(r.treatments));
			await loadProject(project.id);
			promptText = '';
			promptEdited = false;
			if (promptOpen) void loadPreview(); // fresh breakdown: rebuild the open preview
		} catch (e) {
			fail(e, 'cover read failed');
		} finally {
			busy = '';
		}
	}

	async function save() {
		if (!project || !bd) return;
		const body: Record<string, unknown> = { action: 'save', projectId: project.id, breakdown: $state.snapshot(bd) };
		// The API rejects player treatments without a player; hold those until one is picked.
		if (tr.every((t) => t.mode !== 'player' || t.playerSlug)) body.treatments = $state.snapshot(tr);
		try {
			await cfPost(body);
			if (promptOpen && !promptEdited) void loadPreview();
		} catch (e) {
			fail(e, 'save failed');
		}
	}

	function renameSubject(oldLabel: string, next: string) {
		if (!bd) return;
		if (bd.subjects.some((s) => s.label === next)) {
			notice = { tone: 'warn', text: `Another subject is already called "${next}".` };
			return;
		}
		const s = bd.subjects.find((x) => x.label === oldLabel);
		const t = tr.find((x) => x.label === oldLabel);
		if (s) s.label = next;
		if (t) t.label = next;
		void save();
	}

	function addSubject() {
		if (!bd) return;
		let n = bd.subjects.length + 1;
		while (bd.subjects.some((s) => s.label === `Person ${n}`)) n++;
		const label = `Person ${n}`;
		bd.subjects.push({
			label, kind: 'person', role: bd.subjects.length ? 'secondary' : 'main', position: '', pose: '', gaze: '',
			clothing: '', expression: '', color_treatment: '', focus: '',
		});
		bd.no_subjects = false;
		tr.push({ label, mode: 'keep' });
		void save();
	}

	function assign(scope: 'main' | 'all') {
		if (!bd) return;
		const p = players.find((x) => x.slug === quickSlug);
		if (!p) return;
		const living = (k: string) => k === 'person' || k === 'animal';
		const targets =
			scope === 'all'
				? bd.subjects.filter((s) => s.kind === 'person')
				: [bd.subjects.find((s) => s.role === 'main' && living(s.kind)) ?? bd.subjects.find((s) => s.kind === 'person')].filter(
						(s): s is Breakdown['subjects'][number] => !!s,
					);
		if (!targets.length) {
			notice = { tone: 'warn', text: scope === 'all' ? 'No people on this cover.' : 'No main person on this cover.' };
			return;
		}
		for (const s of targets) {
			const t = tr.find((x) => x.label === s.label);
			if (t) Object.assign(t, { mode: 'player', playerSlug: p.slug, playerName: p.name });
		}
		void save();
	}

	async function uploadHeadshot(slug: string, file: File) {
		if (!project || !ps) return;
		begin(`upload:${slug}`);
		try {
			const r = await cfUpload<{ players: Player[] }>({ action: 'upload-headshot', projectId: String(project.id), slug, file });
			ps.players = r.players;
			notice = { tone: 'health', text: 'Headshot uploaded. Its identity description will be rebuilt on the next generate.' };
		} catch (e) {
			fail(e, 'headshot upload failed');
		} finally {
			busy = '';
		}
	}

	async function loadPreview() {
		if (!project || !bd) return;
		promptLoading = true;
		try {
			const r = await cfPost<{ prompt: string }>({ action: 'preview-prompt', projectId: project.id, treatments: $state.snapshot(tr) });
			promptText = r.prompt;
			promptEdited = false;
		} catch (e) {
			promptText = '';
			fail(e, 'prompt preview failed');
		} finally {
			promptLoading = false;
		}
	}

	async function generate() {
		if (!project || generateBlocker) return;
		const id = project.id;
		await save();
		begin('generate');
		try {
			const r = await cfPost<{ version: Version }>({
				action: 'generate',
				projectId: id,
				treatments: $state.snapshot(tr),
				...(genModel ? { modelId: genModel } : {}),
				...(promptEdited && promptText.trim() ? { promptOverride: promptText } : {}),
			});
			await loadProject(id);
			void refreshHome();
			if (r.version.status === 'failed') {
				notice = { tone: 'ember', text: `Try ${r.version.try_no} failed: ${reasonText(r.version.error_reason)}` };
			}
		} catch (e) {
			fail(e, 'generation failed');
			try {
				await loadProject(id);
			} catch {
				/* keep what we have */
			}
		} finally {
			busy = '';
		}
	}

	function patchVersion(v: Version) {
		if (!ps) return;
		const i = ps.versions.findIndex((x) => x.id === v.id);
		if (i >= 0) ps.versions[i] = { ...ps.versions[i], ...v };
	}

	async function rate(v: Version, key: RatingKey, value: number | null) {
		try {
			const r = await cfPost<{ version: Version }>({ action: 'rate', versionId: v.id, ratings: { [key]: value } });
			patchVersion(r.version);
		} catch (e) {
			fail(e, 'rating failed');
		}
	}

	async function note(v: Version, text: string) {
		try {
			const r = await cfPost<{ version: Version }>({ action: 'rate', versionId: v.id, ratings: {}, note: text.trim() || null });
			patchVersion(r.version);
		} catch (e) {
			fail(e, 'note failed');
		}
	}

	async function makeKeeper(v: Version) {
		if (!ps) return;
		begin('keeper');
		try {
			const r = await cfPost<{ project: Project }>({ action: 'keeper', projectId: ps.project.id, versionId: v.id });
			ps.project = { ...ps.project, ...r.project };
			share = null;
			gifReady = false;
			void refreshHome();
		} catch (e) {
			fail(e, 'could not set keeper');
		} finally {
			busy = '';
		}
	}

	async function createShare() {
		if (!ps) return;
		begin('share');
		try {
			share = await cfPost<{ stillUrl: string; gifUrl: string }>({ action: 'share', projectId: ps.project.id });
			await loadProject(ps.project.id);
		} catch (e) {
			fail(e, 'share failed');
		} finally {
			busy = '';
		}
	}

	async function copy(text: string, key: string) {
		try {
			await navigator.clipboard.writeText(text);
			copied = key;
			setTimeout(() => copied === key && (copied = ''), 1500);
		} catch {
			notice = { tone: 'warn', text: 'Clipboard blocked; select the link and copy it manually.' };
		}
	}

	const card = 'bg-surface border border-border rounded-md';
	const field =
		'w-full font-sans bg-bg border border-border rounded-md px-2.5 py-2 text-sm text-fg placeholder:text-fg-faint focus:border-accent focus:outline-none';
	const lbl = 'flex flex-col gap-1 text-[10px] font-mono uppercase tracking-wider text-fg-faint';
	const btn =
		'inline-flex items-center justify-center gap-2 rounded-md border border-accent-deep bg-accent-bg text-accent font-mono text-xs uppercase tracking-wider px-3 py-2 hover:bg-accent-bg-strong transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
	const btnSolid =
		'inline-flex items-center justify-center gap-2 rounded-md bg-accent text-bg font-mono text-xs font-bold uppercase tracking-wider px-4 py-2.5 hover:bg-accent-strong transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
	const btnGhost =
		'inline-flex items-center justify-center gap-2 rounded-md border border-border text-fg-muted font-mono text-xs uppercase tracking-wider px-3 py-2 hover:text-fg hover:bg-surface-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
	const noticeTone = {
		ember: 'border-ember/40 bg-ember-bg text-fg',
		warn: 'border-warn/40 bg-warn/10 text-warn',
		health: 'border-health/40 bg-health-bg text-health',
	};
</script>

<svelte:head>
	<title>Cover Factory</title>
</svelte:head>

{#snippet step(n: string, title: string, sub?: string)}
	<div class="flex items-baseline gap-3">
		<span class="font-mono text-xs text-accent">{n}</span>
		<h2 class="font-display text-xl text-fg">{title}</h2>
		{#if sub}<span class="text-xs text-fg-dim">{sub}</span>{/if}
	</div>
{/snippet}

{#snippet spinner()}
	<span class="inline-block h-3 w-3 rounded-full border-2 border-current border-r-transparent animate-spin" aria-hidden="true"></span>
{/snippet}

<div class="max-w-6xl mx-auto px-4 py-8 space-y-6">
	<header class="flex flex-wrap items-end justify-between gap-4">
		<div>
			<SectionLabel>Admin</SectionLabel>
			<h1 class="font-display text-3xl mt-1">Cover Factory</h1>
			<p class="text-sm text-fg-muted mt-1">Slip a player into an album cover. Reads the cover, swaps the subject, keeps the style.</p>
		</div>
		<div class="flex flex-col items-end gap-1.5 text-right">
			<div class="flex flex-wrap justify-end gap-1.5">
				<a href="/settings/models" class="group inline-flex items-center gap-1.5 rounded-sm border border-border-muted bg-surface px-2 py-1 hover:border-border" title="Reader model: {home?.models.reader ?? 'none pinned'}">
					<span class="font-mono text-[10px] uppercase tracking-wider text-fg-faint">Reader</span>
					<span class="font-mono text-[11px] {home?.models.reader ? 'text-sky' : 'text-ember'}">{shortModel(home?.models.reader)}</span>
				</a>
				<a href="/settings/models" class="group inline-flex items-center gap-1.5 rounded-sm border border-border-muted bg-surface px-2 py-1 hover:border-border" title="Generator model: {pinnedGenerator ?? 'none pinned'}">
					<span class="font-mono text-[10px] uppercase tracking-wider text-fg-faint">Generator</span>
					<span class="font-mono text-[11px] {pinnedGenerator ? 'text-accent' : 'text-ember'}">{shortModel(pinnedGenerator)}</span>
				</a>
			</div>
			{#if ps}
				<span class="font-mono text-[10px] text-fg-dim">
					this cover · {usd(ps.stats.spendUsd)} spent · {ps.stats.tries} {ps.stats.tries === 1 ? 'try' : 'tries'}{ps.stats.failures ? ` · ${ps.stats.failures} failed` : ''}{ps.stats.triesToKeeper ? ` · keeper on try ${ps.stats.triesToKeeper}` : ''}
				</span>
			{:else}
				<span class="font-mono text-[10px] text-fg-dim">{projects.length} {projects.length === 1 ? 'cover' : 'covers'} in progress</span>
			{/if}
		</div>
	</header>

	{#if paused}
		<div class="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn" role="status">
			Image generation is paused. Reading, rating, keeper and share still work.
		</div>
	{/if}
	{#if notice}
		<div class="flex items-start justify-between gap-3 rounded-md border px-3 py-2 text-sm {noticeTone[notice.tone]}" role={notice.tone === 'ember' ? 'alert' : 'status'}>
			<span>{notice.text}</span>
			<button type="button" class="font-mono text-xs opacity-70 hover:opacity-100" aria-label="Dismiss" onclick={() => (notice = null)}>✕</button>
		</div>
	{/if}

	<section class="grid md:grid-cols-[200px_minmax(0,1fr)] gap-6 items-start">
		<!-- Left rail: recent projects -->
		<aside class="space-y-3 md:sticky md:top-4">
			<button type="button" class="{btn} w-full" onclick={newCover} aria-pressed={creating}>+ New cover</button>
			<SectionLabel>Recent ({projects.length})</SectionLabel>
			{#if projects.length}
				<ul class="flex flex-col gap-1 max-h-[70vh] overflow-auto pr-1">
					{#each projects as p (p.id)}
						{@const active = p.id === selectedId}
						<li>
							<button
								type="button"
								class="w-full text-left flex items-center gap-2.5 p-1.5 rounded-sm border transition-colors {active
									? 'border-accent/60 bg-accent-bg'
									: 'border-transparent hover:bg-surface'}"
								aria-current={active ? 'true' : undefined}
								onclick={() => openProject(p.id)}
							>
								<img src={mediaUrl(p.keeper_rel ?? p.cover_rel)} alt="" loading="lazy" class="w-11 h-11 shrink-0 rounded-sm object-cover bg-surface" />
								<span class="flex-1 min-w-0">
									<span class="block text-sm leading-tight line-clamp-2 {active ? 'text-accent' : 'text-fg'}">{p.title}</span>
									<span class="mt-0.5 flex items-center gap-1.5 font-mono text-[10px] text-fg-dim">
										{p.version_count} {p.version_count === 1 ? 'try' : 'tries'}
										{#if p.keeper_version_id}<span class="text-health">● keeper</span>{/if}
									</span>
								</span>
							</button>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="text-xs text-fg-dim">No covers yet. Start one from a round song, a Spotify link or an upload.</p>
			{/if}
		</aside>

		<div class="space-y-6 min-w-0">
			{#if creating || (!selectedId && !loadingProject)}
				<section class="{card} p-4 space-y-4" aria-labelledby="step1">
					<div id="step1">{@render step('01', 'Cover', 'Pick the album art to rework')}</div>
					<CoverPicker {leagues} oncreated={onCreated} />
				</section>
			{:else if loadingProject && !ps}
				<div class="{card} p-4 space-y-4 animate-pulse" aria-busy="true">
					<div class="h-6 w-1/3 rounded-sm bg-surface-hover"></div>
					<div class="grid lg:grid-cols-[300px_1fr] gap-5">
						<div class="aspect-square rounded-md bg-surface-hover"></div>
						<div class="space-y-3">
							<div class="h-20 rounded-md bg-surface-hover"></div>
							<div class="h-20 rounded-md bg-surface-hover"></div>
						</div>
					</div>
				</div>
			{:else if ps && project}
				<!-- Step 2: read & subjects -->
				<section class="{card} p-4 space-y-4" aria-labelledby="step2">
					<div class="flex flex-wrap items-start justify-between gap-3">
						<div class="min-w-0 space-y-1">
							<div id="step2">{@render step('02', 'Read & subjects')}</div>
							<p class="text-sm text-fg-muted line-clamp-1" title={project.title}>
								{project.title}
								<span class="font-mono text-[10px] uppercase tracking-wider text-fg-faint ml-1">{project.source}{project.league_slug ? ` · ${project.league_slug}` : ''}</span>
							</p>
						</div>
						{#if bd}
							<button type="button" class={btnGhost} disabled={!!busy} onclick={readCover}>
								{#if busy === 'read'}{@render spinner()} Reading… {elapsed}s{:else}Re-read cover{/if}
							</button>
						{/if}
					</div>

					<div class="grid lg:grid-cols-[260px_minmax(0,1fr)] gap-5 items-start">
						<figure class="space-y-2 lg:sticky lg:top-4">
							<img src={mediaUrl(project.cover_rel)} alt="Original cover: {project.title}" class="w-full aspect-square object-cover rounded-md border border-border bg-bg" />
							<figcaption class="font-mono text-[10px] uppercase tracking-wider text-fg-faint">Original</figcaption>
						</figure>

						{#if !bd}
							<div class="rounded-md border border-dashed border-border p-6 text-center space-y-3 min-h-60 grid place-items-center">
								<div class="space-y-3">
									<p class="text-sm text-fg-muted">The reader describes the style, layout, text and every subject so the generator can rebuild the cover faithfully.</p>
									<button type="button" class={btnSolid} disabled={!!busy || !home?.models.reader} onclick={readCover}>
										{#if busy === 'read'}{@render spinner()} Reading cover… {elapsed}s{:else}Read cover{/if}
									</button>
									{#if !home?.models.reader}
										<p class="text-xs text-ember">No reader model pinned. <a class="underline" href="/settings/models">Pin one in Models</a>.</p>
									{/if}
								</div>
							</div>
						{:else}
							<div class="space-y-4 min-w-0" class:opacity-60={busy === 'read'}>
								<div class="grid gap-3 sm:grid-cols-2">
									<label class="{lbl} sm:col-span-2">Style<textarea class="{field} field-sizing-content min-h-14 max-h-48" bind:value={bd.style} onchange={save}></textarea></label>
									<label class={lbl}>Composition<textarea class="{field} field-sizing-content min-h-16 max-h-48" bind:value={bd.composition} onchange={save}></textarea></label>
									<label class={lbl}>Palette & lighting<textarea class="{field} field-sizing-content min-h-16 max-h-48" bind:value={bd.palette_lighting} onchange={save}></textarea></label>
									<label class="{lbl} sm:col-span-2">
										Text elements · one per line
										<textarea
											class="{field} field-sizing-content min-h-12 max-h-48 font-mono text-xs"
											value={bd.text_elements.join('\n')}
											onchange={(e) => {
												if (!bd) return;
												bd.text_elements = (e.currentTarget as HTMLTextAreaElement).value.split('\n').map((s) => s.trim()).filter(Boolean);
												void save();
											}}
										></textarea>
									</label>
								</div>

								<div class="flex flex-wrap items-end justify-between gap-3 border-t border-border-muted pt-4">
									<SectionLabel>Subjects ({bd.subjects.length})</SectionLabel>
									<div class="flex flex-wrap items-end gap-2">
										<label class={lbl}>
											Swap in
											<select class="{field} py-1.5 min-w-44" bind:value={quickSlug}>
												<option value="">Choose…</option>
												{#each uniquePlayers as p (p.slug)}
													<option value={p.slug}>{p.name}{ps.submitter?.slug === p.slug ? ' (submitter)' : ''}</option>
												{/each}
											</select>
										</label>
										<button type="button" class={btnGhost} disabled={!quickSlug} onclick={() => assign('main')}>
											{quickSlug && quickSlug === ps.submitter?.slug ? 'Submitter replaces main' : 'Replaces main'}
										</button>
										<button type="button" class={btnGhost} disabled={!quickSlug} onclick={() => assign('all')}>
											{quickSlug && quickSlug === ps.submitter?.slug ? 'Submitter replaces ALL people' : 'Replaces ALL people'}
										</button>
									</div>
								</div>

								{#if !bd.subjects.length}
									<p class="rounded-md border border-dashed border-border px-3 py-4 text-sm text-fg-dim">
										The reader found no subjects on this cover. Add one to place a player into the scene.
									</p>
								{/if}
								<div class="space-y-3">
									{#each bd.subjects as _, i (i)}
										{#if tr[i]}
											<SubjectCard
												bind:subject={bd.subjects[i]}
												bind:treatment={tr[i]}
												{players}
												index={i}
												uploading={busy === `upload:${tr[i].playerSlug}`}
												onchange={save}
												onlabel={renameSubject}
												onupload={uploadHeadshot}
											/>
										{/if}
									{/each}
								</div>
								<button type="button" class={btnGhost} onclick={addSubject}>+ Add subject</button>
							</div>
						{/if}
					</div>
				</section>

				<!-- Step 3: generate -->
				<section class="{card} p-4 space-y-4" aria-labelledby="step3">
					<div id="step3">{@render step('03', 'Generate', 'Each try is a new version; nothing is overwritten')}</div>

					<div class="flex flex-wrap items-end gap-3">
						<label class="{lbl} min-w-72 flex-1">
							Generator model
							<select class={field} bind:value={genModel} disabled={busy === 'generate'}>
								<option value="">Pinned · {pinnedGenerator ?? 'none'}</option>
								{#each generators.filter((m) => m.model_id !== pinnedGenerator) as m (m.model_id)}
									<option value={m.model_id}>{jobOptionLabel(m)}</option>
								{/each}
							</select>
						</label>
						<div class="flex flex-col items-start gap-1">
							<button type="button" class="{btnSolid} min-w-44" disabled={!!busy || !!generateBlocker || paused} onclick={generate} aria-describedby="gen-hint">
								{#if busy === 'generate'}{@render spinner()} Generating… {elapsed}s{:else}Generate{ps.versions.length ? ' another' : ''}{/if}
							</button>
						</div>
					</div>
					<p id="gen-hint" class="text-xs min-h-4 {generateBlocker ? 'text-warn' : 'text-fg-dim'}">
						{#if busy === 'generate'}
							Usually 10–20 s. Keep this tab open.
						{:else if generateBlocker}
							{generateBlocker}
						{:else}
							{playerTreatments.length} {playerTreatments.length === 1 ? 'subject' : 'subjects'} swapped · roughly $0.07 a try on the pinned model
						{/if}
					</p>

					<details
						class="rounded-md border border-border-muted bg-bg-elevated"
						bind:open={promptOpen}
					>
						<summary class="cursor-pointer select-none px-3 py-2 font-mono text-[11px] uppercase tracking-wider text-fg-dim hover:text-fg flex items-center justify-between">
							<span>Prompt preview{promptEdited ? ' · edited, will be sent as-is' : ''}</span>
							<span class="text-fg-faint normal-case tracking-normal">{promptOpen ? 'hide' : 'show'}</span>
						</summary>
						<div class="px-3 pb-3 space-y-2">
							<textarea
								class="{field} min-h-56 font-mono text-xs leading-relaxed"
								aria-label="Generation prompt"
								placeholder={promptLoading ? 'Building prompt…' : bd ? '' : 'Read the cover first.'}
								bind:value={promptText}
								oninput={() => (promptEdited = true)}
							></textarea>
							<div class="flex items-center gap-2">
								<button type="button" class={btnGhost} disabled={promptLoading || !bd} onclick={loadPreview}>
									{promptEdited ? 'Discard edits' : 'Rebuild'}
								</button>
								<span class="text-xs text-fg-dim">Rebuilds from the breakdown and treatments. Identity text fills in from the headshot on first generate.</span>
							</div>
						</div>
					</details>

					<div class="space-y-2">
						<SectionLabel>Versions ({ps.versions.length})</SectionLabel>
						{#if busy === 'generate' || versionsNewest.length}
							<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
								{#if busy === 'generate'}
									<div class="rounded-md border border-accent-deep bg-surface overflow-hidden" aria-live="polite">
										<div class="relative aspect-square bg-bg grid place-items-center">
											<img src={mediaUrl(project.cover_rel)} alt="" class="absolute inset-0 w-full h-full object-cover opacity-25 blur-[2px]" />
											<div class="relative text-center space-y-2">
												<span class="inline-block h-8 w-8 rounded-full border-2 border-accent border-r-transparent animate-spin" aria-hidden="true"></span>
												<p class="font-mono text-sm text-accent">{elapsed}s</p>
												<p class="font-mono text-[10px] uppercase tracking-wider text-fg-dim">Try {(ps.stats.tries ?? 0) + 1} · {shortModel(genModel || pinnedGenerator)}</p>
											</div>
										</div>
										<div class="p-3 space-y-2">
											<div class="h-3 w-1/2 rounded-sm bg-surface-hover animate-pulse"></div>
											<div class="h-16 rounded-sm bg-surface-hover animate-pulse"></div>
										</div>
									</div>
								{/if}
								{#each versionsNewest as v (v.id)}
									<VersionCard
										{v}
										coverRel={project.cover_rel}
										isKeeper={v.id === project.keeper_version_id}
										busy={busy === 'keeper'}
										onrate={(k, val) => rate(v, k, val)}
										onnote={(t) => note(v, t)}
										onkeeper={() => makeKeeper(v)}
									/>
								{/each}
							</div>
						{:else}
							<p class="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-fg-dim">
								No versions yet. Set who goes where above, then generate.
							</p>
						{/if}
					</div>
				</section>

				<!-- Output: keeper -->
				<section class="{card} p-4 space-y-4" aria-labelledby="step4">
					<div id="step4">{@render step('04', 'Output', keeper ? `Keeper is try ${keeper.try_no}` : undefined)}</div>
					{#if keeper}
						<div class="grid md:grid-cols-[minmax(0,360px)_1fr] gap-5 items-start">
							<figure class="space-y-2">
								<div class="relative aspect-square rounded-md border border-border bg-bg overflow-hidden">
									{#if !gifReady}
										<div class="absolute inset-0 grid place-items-center text-center">
											<div class="space-y-2">
												{@render spinner()}
												<p class="font-mono text-[10px] uppercase tracking-wider text-fg-dim">Rendering wipe GIF…</p>
											</div>
										</div>
									{/if}
									{#key keeper.id}
										<img
											src={exportUrl(keeper.id, 'gif')}
											alt="Wipe from the original cover to try {keeper.try_no}"
											class="w-full h-full object-cover transition-opacity {gifReady ? 'opacity-100' : 'opacity-0'}"
											onload={() => (gifReady = true)}
											onerror={() => {
												gifReady = true;
												notice = { tone: 'ember', text: 'Wipe GIF failed to render.' };
											}}
										/>
									{/key}
								</div>
								<figcaption class="font-mono text-[10px] uppercase tracking-wider text-fg-faint">Wipe preview · 456 px · loops</figcaption>
							</figure>
							<div class="space-y-4">
								<div class="flex flex-wrap gap-2">
									<a class={btnGhost} href={exportUrl(keeper.id, 'jpg')} download>Download still</a>
									<a class={btnGhost} href={exportUrl(keeper.id, 'gif')} download>Download GIF</a>
								</div>
								<div class="space-y-2 border-t border-border-muted pt-4">
									<p class="text-sm text-fg-muted">
										A share link publishes the still and the GIF under an unguessable public URL, ready for a digest or the group chat.
									</p>
									{#if share}
										<ul class="space-y-2">
											{#each [{ k: 'still', label: 'Still', url: share.stillUrl }, { k: 'gif', label: 'GIF', url: share.gifUrl }] as s (s.k)}
												<li class="flex flex-wrap items-center gap-1.5">
													<span class="w-full font-mono text-[10px] uppercase tracking-wider text-fg-faint">{s.label}</span>
													<input class="{field} flex-1 min-w-0 w-auto py-1.5 font-mono text-xs" readonly value={s.url} aria-label="{s.label} share URL" onfocus={(e) => (e.currentTarget as HTMLInputElement).select()} />
													<button type="button" class="{btnGhost} px-2.5" onclick={() => copy(s.url, s.k)}>{copied === s.k ? 'Copied' : 'Copy'}</button>
													<a class="{btnGhost} px-2.5" href={s.url} target="_blank" rel="noopener" aria-label="Open {s.label} share URL">↗</a>
												</li>
											{/each}
										</ul>
									{:else}
										<button type="button" class={btn} disabled={!!busy} onclick={createShare}>
											{#if busy === 'share'}{@render spinner()} Publishing…{:else if project.share_dir && project.share_version_id === keeper.id}Show share links{:else}Create share link{/if}
										</button>
									{/if}
								</div>
							</div>
						</div>
					{:else}
						<p class="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-fg-dim">
							Mark a version as the keeper to preview the wipe GIF, download it, or share it.
						</p>
					{/if}
				</section>
			{/if}
		</div>
	</section>
</div>
