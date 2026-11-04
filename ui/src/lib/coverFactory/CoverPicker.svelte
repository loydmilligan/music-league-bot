<script lang="ts">
	import { cfGet, cfPost, cfUpload, type Project, type RoundSong } from './api';

	let {
		leagues,
		oncreated,
	}: { leagues: { slug: string; name: string }[]; oncreated: (p: Project) => void } = $props();

	type Tab = 'round' | 'spotify' | 'upload';
	const TABS: { id: Tab; label: string }[] = [
		{ id: 'round', label: 'Round song' },
		{ id: 'spotify', label: 'Spotify link' },
		{ id: 'upload', label: 'Upload' },
	];
	const preferred = ['boarz-ii-men', 'second-best', 'hip-jammers'];

	let tab = $state<Tab>('round');
	let busy = $state('');
	let err = $state('');

	let league = $state(
		leagues.find((l) => l.slug === preferred[0])?.slug ?? leagues[0]?.slug ?? '',
	);
	let rounds = $state<{ id: number; name: string; number: number; songCount: number }[]>([]);
	let roundId = $state<number | null>(null);
	let songs = $state<RoundSong[]>([]);
	let loadingRounds = $state(false);
	let loadingSongs = $state(false);

	let spotifyUrl = $state('');
	let uploadFile = $state<File | null>(null);
	let uploadTitle = $state('');
	let uploadLeague = $state('');

	const sortedLeagues = $derived(
		[...leagues].sort((a, b) => {
			const ia = preferred.indexOf(a.slug), ib = preferred.indexOf(b.slug);
			return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.name.localeCompare(b.name);
		}),
	);

	async function loadRounds(slug: string) {
		const stale = () => league !== slug;
		loadingRounds = true;
		err = '';
		rounds = [];
		songs = [];
		roundId = null;
		try {
			const r = await cfGet<{ rounds: typeof rounds }>(`?league=${encodeURIComponent(slug)}`);
			if (stale()) return; // league changed while this request was in flight
			rounds = r.rounds;
			const first = rounds.find((r) => r.songCount > 0) ?? rounds[0];
			if (first) await loadSongs(first.id);
		} catch (e) {
			if (!stale()) err = e instanceof Error ? e.message : 'could not load rounds';
		} finally {
			if (!stale()) loadingRounds = false;
		}
	}

	async function loadSongs(id: number) {
		roundId = id;
		loadingSongs = true;
		err = '';
		songs = [];
		try {
			const r = await cfGet<{ songs: RoundSong[] }>(`?league=${encodeURIComponent(league)}&round=${id}`);
			if (roundId === id) songs = r.songs;
		} catch (e) {
			err = e instanceof Error ? e.message : 'could not load songs';
		} finally {
			loadingSongs = false;
		}
	}

	function onTabKey(e: KeyboardEvent) {
		const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
		if (!dir) return;
		e.preventDefault();
		const i = TABS.findIndex((t) => t.id === tab);
		const next = TABS[(i + dir + TABS.length) % TABS.length];
		tab = next.id;
		document.getElementById(`cp-tab-${next.id}`)?.focus();
	}

	$effect(() => {
		if (tab === 'round' && league) void loadRounds(league);
	});

	async function create(body: Record<string, unknown>, key: string) {
		busy = key;
		err = '';
		try {
			const r = await cfPost<{ project: Project }>({ action: 'create', ...body });
			oncreated(r.project);
		} catch (e) {
			err = e instanceof Error ? e.message : 'could not create project';
		} finally {
			busy = '';
		}
	}

	async function upload() {
		if (!uploadFile) return;
		busy = 'upload';
		err = '';
		try {
			const r = await cfUpload<{ project: Project }>({
				action: 'upload-cover',
				file: uploadFile,
				title: uploadTitle,
				leagueSlug: uploadLeague,
			});
			oncreated(r.project);
		} catch (e) {
			err = e instanceof Error ? e.message : 'upload failed';
		} finally {
			busy = '';
		}
	}

	const field = 'font-sans bg-bg border border-border rounded-md px-2.5 py-2 text-sm text-fg focus:border-accent focus:outline-none';
	const lbl = 'flex flex-col gap-1 text-[10px] font-mono uppercase tracking-wider text-fg-faint';
	const btn =
		'inline-flex items-center justify-center gap-2 rounded-md border border-accent-deep bg-accent-bg text-accent font-mono text-xs uppercase tracking-wider px-3 py-2 hover:bg-accent-bg-strong transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
</script>

<div class="space-y-4">
	<div class="flex gap-1 border-b border-border-muted" role="tablist" aria-label="Cover source">
		{#each TABS as t (t.id)}
			<button
				type="button"
				role="tab"
				id="cp-tab-{t.id}"
				aria-selected={tab === t.id}
				aria-controls="cp-panel"
				tabindex={tab === t.id ? 0 : -1}
				onkeydown={onTabKey}
				class="px-3 py-2 -mb-px border-b-2 font-mono text-xs uppercase tracking-wider transition-colors {tab === t.id
					? 'border-accent text-accent'
					: 'border-transparent text-fg-dim hover:text-fg'}"
				onclick={() => (tab = t.id)}>{t.label}</button
			>
		{/each}
	</div>

	{#if err}
		<p class="rounded-md border border-ember/40 bg-ember-bg px-3 py-2 text-sm text-fg" role="alert">{err}</p>
	{/if}

	<div id="cp-panel" role="tabpanel" aria-labelledby="cp-tab-{tab}" class="space-y-4">
	{#if tab === 'round'}
		<div class="flex flex-wrap gap-3 items-end">
			<label class={lbl}>
				League
				<select class="{field} min-w-48" bind:value={league}>
					{#each sortedLeagues as l (l.slug)}
						<option value={l.slug}>{l.name}</option>
					{/each}
				</select>
			</label>
			<label class={lbl}>
				Round
				<select
					class="{field} min-w-72"
					value={roundId ?? ''}
					disabled={loadingRounds || !rounds.length}
					onchange={(e) => loadSongs(Number((e.currentTarget as HTMLSelectElement).value))}
				>
					{#if loadingRounds}<option value="">Loading…</option>{/if}
					{#each rounds as r (r.id)}
						<option value={r.id}>R{r.number} · {r.name}{r.songCount ? ` · ${r.songCount} songs` : ' · no songs yet'}</option>
					{/each}
				</select>
			</label>
		</div>
		<div class="min-h-48">
			{#if loadingSongs || loadingRounds}
				<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3" aria-busy="true">
					{#each Array(8) as _, i (i)}
						<div class="rounded-md border border-border-muted bg-bg p-2 space-y-2 animate-pulse">
							<div class="aspect-square rounded-sm bg-surface-hover"></div>
							<div class="h-3 w-3/4 rounded-sm bg-surface-hover"></div>
							<div class="h-2 w-1/2 rounded-sm bg-surface-hover"></div>
						</div>
					{/each}
				</div>
			{:else if songs.length}
				<ul class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
					{#each songs as s (s.submissionId)}
						<li>
							<button
								type="button"
								class="group w-full text-left rounded-md border border-border-muted bg-bg p-2 space-y-2 hover:border-accent-deep hover:bg-accent-bg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
								disabled={!!busy || !s.artUrl}
								title={s.artUrl ? `Use this cover` : 'No album art for this submission'}
								onclick={() => create({ source: 'round', roundId, submissionId: s.submissionId }, `s${s.submissionId}`)}
							>
								<div class="relative aspect-square overflow-hidden rounded-sm bg-surface">
									{#if s.artUrl}
										<img src={s.artUrl} alt="" loading="lazy" class="h-full w-full object-cover" />
									{:else}
										<span class="absolute inset-0 grid place-items-center font-mono text-[10px] text-fg-faint">no art</span>
									{/if}
									{#if busy === `s${s.submissionId}`}
										<span class="absolute inset-0 grid place-items-center bg-black/60 font-mono text-xs text-accent">Fetching…</span>
									{/if}
								</div>
								<span class="block text-sm text-fg leading-tight line-clamp-1">{s.title}</span>
								<span class="block text-xs text-fg-dim line-clamp-1">{s.artists}</span>
								<span class="block font-mono text-[10px] uppercase tracking-wider text-fg-faint line-clamp-1">
									{s.playerName ?? 'unknown submitter'}
								</span>
							</button>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="py-10 text-center text-sm text-fg-dim">
					{err ? 'Songs could not be loaded.' : rounds.length ? 'No submissions in this round yet.' : 'No rounds for this league.'}
				</p>
			{/if}
		</div>
	{:else if tab === 'spotify'}
		<form
			class="flex flex-wrap gap-3 items-end"
			onsubmit={(e) => {
				e.preventDefault();
				if (spotifyUrl.trim()) create({ source: 'spotify', url: spotifyUrl.trim() }, 'spotify');
			}}
		>
			<label class="{lbl} flex-1 min-w-72">
				Spotify track or album link
				<input class={field} type="url" placeholder="https://open.spotify.com/track/…" bind:value={spotifyUrl} />
			</label>
			<button type="submit" class={btn} disabled={!!busy || !spotifyUrl.trim()}>
				{busy === 'spotify' ? 'Fetching cover…' : 'Use this cover'}
			</button>
		</form>
		<p class="text-xs text-fg-dim">Pulls the album art at full resolution. Players come from all three leagues.</p>
	{:else}
		<form
			class="grid gap-3 sm:grid-cols-[1fr_1fr_auto] items-end"
			onsubmit={(e) => {
				e.preventDefault();
				void upload();
			}}
		>
			<label class={lbl}>
				Cover image
				<input
					class="{field} file:mr-3 file:rounded-sm file:border-0 file:bg-surface-strong file:px-2 file:py-1 file:text-xs file:text-fg"
					type="file"
					accept="image/*"
					onchange={(e) => (uploadFile = (e.currentTarget as HTMLInputElement).files?.[0] ?? null)}
				/>
			</label>
			<label class={lbl}>
				Title (optional)
				<input class={field} placeholder="Album — Artist" bind:value={uploadTitle} />
			</label>
			<button type="submit" class={btn} disabled={!!busy || !uploadFile}>
				{busy === 'upload' ? 'Uploading…' : 'Upload cover'}
			</button>
			<label class={lbl}>
				Player league
				<select class={field} bind:value={uploadLeague}>
					<option value="">All leagues</option>
					{#each sortedLeagues as l (l.slug)}
						<option value={l.slug}>{l.name}</option>
					{/each}
				</select>
			</label>
		</form>
	{/if}
	</div>
</div>
