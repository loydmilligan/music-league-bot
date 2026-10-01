<script lang="ts">
	import type { Snapshot } from '$lib/server/boarzStats/data.js';
	import { page } from '$app/state';
	import { downloadableStats } from '$lib/boarzStats/downloadableStats.js';
	import { filterSnapshotPlayers } from '$lib/boarzStats/filterSnapshot.js';
	import LeaderboardTab from './LeaderboardTab.svelte';
	import RoundScoresTab from './RoundScoresTab.svelte';
	import SongsTab from './SongsTab.svelte';
	import ArtistsTab from './ArtistsTab.svelte';
	import HeatmapTab from './HeatmapTab.svelte';
	import VotesGivenTab from './VotesGivenTab.svelte';
	import PlaylistTab from './PlaylistTab.svelte';
	import FunStatsTab from './FunStatsTab.svelte';
	import ChatTab from './ChatTab.svelte';
	import WrappedTab from './WrappedTab.svelte';
	import { computeVisibleTabIds } from '$lib/boarzStats/visibleTabs.js';

	let { snapshot, basePath, omitTabs = [], omitLeaderboardRace = false }:
		{ snapshot: Snapshot; basePath: string; omitTabs?: readonly string[]; omitLeaderboardRace?: boolean } = $props();
	const TABS = [
		{ id: 'leaderboard', label: '🏆 Standings & Scores', title: 'Standings, cumulative race, points by round, and round winners', seasonOnly: true },
		{ id: 'songs', label: '🎵 Songs', title: 'Song performance and submission details' },
		{ id: 'artists', label: '🎤 Artists', title: 'Artist performance across submissions' },
		{ id: 'heatmap', label: '🔥 Vote Heatmap', title: 'How players voted for one another' },
		{ id: 'votesgiven', label: '💙 Votes Given', title: 'Voting patterns by player' },
		{ id: 'playlist', label: '📍 Playlist Position', title: 'How playlist order relates to results' },
		{ id: 'chat', label: '💬 Chat', title: 'League chat activity', needsChat: true },
		{ id: 'fun', label: '✨ Fun Stats', title: 'Additional league superlatives' },
		{ id: 'wrapped', label: '🎈 Wrapped', title: 'Season highlights', seasonOnly: true },
	] as const;
	type TabId = (typeof TABS)[number]['id'];
	const isAllSeasons = $derived(snapshot.league.selectedSeasons.length > 1);
	let crossSeasonView = $state<'combined' | 'hide-season'>(page.url.searchParams.get('seasonView') === 'hide-season' ? 'hide-season' : 'combined');
	let activeOnly = $state(page.url.searchParams.get('activeOnly') === '1');
	const visibleTabIdSet = $derived(new Set(computeVisibleTabIds(
		TABS,
		{ hasChat: snapshot.capabilities.chat, isAllSeasons, crossSeasonView, omitTabs }
	)));
	const visibleTabs = $derived(TABS.filter((tab) => visibleTabIdSet.has(tab.id)));
	const tabIds = $derived(visibleTabs.map((tab) => tab.id));
	const requestedTab = page.url.searchParams.get('tab') as TabId;
	let active = $state<TabId>(TABS.some((tab) => tab.id === requestedTab) ? requestedTab : 'leaderboard');
	$effect(() => {
		if (!visibleTabs.some((tab) => tab.id === active)) active = visibleTabs[0]?.id ?? 'songs';
	});

	const initialPlayers = page.url.searchParams.get('players')?.split(',').map(Number).filter(Number.isFinite) ?? [];
	let selectedPlayerIds = $state<number[]>(initialPlayers);
	let draftPlayerIds = $state<number[]>(initialPlayers);
	let playerSearch = $state('');
	let filterOpen = $state(false);
	const mostRecentSeason = $derived(Math.max(...snapshot.rounds.map((round) => round.seasonNumber)));
	const activePlayerIds = $derived([...new Set(snapshot.subs.filter((sub) => snapshot.rounds[sub.roundIdx]?.seasonNumber === mostRecentSeason).map((sub) => snapshot.competitors[sub.compIdx]?.id).filter((id): id is number => id != null))]);
	const basePlayerIds = $derived(activeOnly ? activePlayerIds : snapshot.competitors.map((competitor) => competitor.id));
	const effectivePlayerIds = $derived((selectedPlayerIds.length ? selectedPlayerIds : basePlayerIds).filter((id) => basePlayerIds.includes(id)));
	const snap = $derived(filterSnapshotPlayers(snapshot, effectivePlayerIds));
	const allPlayers = $derived(selectedPlayerIds.length === 0 || selectedPlayerIds.length === snapshot.competitors.length);

	function syncUrl() {
		const url = new URL(window.location.href);
		url.searchParams.set('tab', active);
		if (allPlayers) url.searchParams.delete('players');
		else url.searchParams.set('players', selectedPlayerIds.join(','));
		if (activeOnly) url.searchParams.set('activeOnly', '1'); else url.searchParams.delete('activeOnly');
		if (isAllSeasons && crossSeasonView !== 'combined') url.searchParams.set('seasonView', crossSeasonView); else url.searchParams.delete('seasonView');
		window.history.replaceState({}, '', url);
	}

	function setTab(tab: TabId) {
		active = tab;
		syncUrl();
	}

	function togglePlayer(id: number, checked: boolean) {
		const current = allPlayers ? snapshot.competitors.map((competitor) => competitor.id) : selectedPlayerIds;
		selectedPlayerIds = checked
			? [...new Set([...current, id])]
			: current.filter((value) => value !== id);
		if (selectedPlayerIds.length === snapshot.competitors.length) selectedPlayerIds = [];
		syncUrl();
	}

	function selectAllPlayers() {
		selectedPlayerIds = [];
		draftPlayerIds = [];
		syncUrl();
	}

	function applyPlayerFilter() {
		selectedPlayerIds = draftPlayerIds.length === snapshot.competitors.length ? [] : [...draftPlayerIds];
		filterOpen = false;
		syncUrl();
	}
	function resetFilters() {
		selectedPlayerIds = [];
		draftPlayerIds = [];
		activeOnly = false;
		crossSeasonView = 'combined';
		playerSearch = '';
		syncUrl();
	}

	async function copyLink() {
		syncUrl();
		await navigator.clipboard.writeText(window.location.href);
	}
</script>

<svelte:head>
	<title>{snapshot.league.name} — Stats</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="mx-auto max-w-6xl px-4 py-6">
	<header class="mb-4 flex flex-wrap items-end justify-between gap-3">
		<div>
			<a href="/stats" class="mb-1 inline-block font-mono text-xs tracking-widest text-fg-faint uppercase hover:text-accent">← All league stats</a>
			<h1 class="text-3xl font-bold text-fg">{snapshot.league.name}</h1>
			<p class="text-sm text-fg-muted">
				{snapshot.league.season} · {snapshot.rounds.length} rounds · stats generated
				{new Date(snapshot.generatedAt).toLocaleString()}
			</p>
		</div>
		<button
			type="button"
			class="rounded-lg border border-border-muted px-3 py-1.5 text-sm text-fg-muted transition-colors hover:bg-surface hover:text-fg"
			onclick={copyLink}
		>
			🔗 Copy filtered link
		</button>
	</header>

	<section class="mb-5 rounded-xl border border-border-muted bg-surface/30 p-4" data-noshot="1">
		<form action={basePath} method="GET" class="space-y-1.5">
			<div class="flex flex-wrap items-end gap-2">
				<div class="min-w-48 flex-1">
				<label for="stats-season" class="mb-1 block text-xs font-semibold tracking-wide text-fg-muted uppercase">Season view</label>
				<select id="stats-season" name="season" class="min-w-0 flex-1 rounded-lg border border-border-muted bg-bg-elevated px-3 py-2 text-sm text-fg">
					{#each snapshot.league.seasons as season (season.id)}
						<option value={season.number} selected={snapshot.league.selectedSeasons.length === 1 && snapshot.league.selectedSeasons[0] === season.number}>
							Season {season.number}{season.status === 'active' ? ' · active' : ''}
						</option>
					{/each}
					{#if snapshot.league.seasons.length > 1}
						<option value="all" selected={snapshot.league.selectedSeasons.length > 1}>All seasons</option>
					{/if}
				</select>
				</div>
				<input type="hidden" name="tab" value={active} />
				{#if selectedPlayerIds.length}<input type="hidden" name="players" value={selectedPlayerIds.join(',')} />{/if}
				{#if activeOnly}<input type="hidden" name="activeOnly" value="1" />{/if}
				{#if crossSeasonView !== 'combined'}<input type="hidden" name="seasonView" value={crossSeasonView} />{/if}
				<button class="rounded-full bg-fg px-4 py-2 text-sm font-semibold text-bg" type="submit">Apply season</button>
				<div class="relative">
					<button type="button" class="control-pill" aria-expanded={filterOpen} onclick={() => { filterOpen = !filterOpen; draftPlayerIds = effectivePlayerIds.length === snapshot.competitors.length ? [] : [...effectivePlayerIds]; }}>
						<span aria-hidden="true">☷</span> Filters <span class="pill-count">{activeOnly || effectivePlayerIds.length < snapshot.competitors.length ? 'On' : 'All players'}</span>
					</button>
					{#if filterOpen}
						<div class="filter-popover">
							<div class="flex items-center justify-between gap-3"><h2 class="font-semibold text-fg">Player filters</h2><button type="button" class="text-xs text-fg-muted underline" onclick={selectAllPlayers}>Everyone</button></div>
							<label class="mt-3 flex items-center gap-2 text-sm text-fg"><input type="checkbox" bind:checked={activeOnly} /> Only players active in Season {mostRecentSeason}</label>
							<input class="mt-3 w-full rounded-lg border border-border-muted bg-bg-elevated px-3 py-2 text-sm" type="search" bind:value={playerSearch} placeholder="Search players" aria-label="Search players" />
							<div class="mt-2 max-h-56 overflow-y-auto space-y-1">
								{#each snapshot.competitors.filter((competitor) => competitor.name.toLowerCase().includes(playerSearch.toLowerCase()) && basePlayerIds.includes(competitor.id)) as competitor (competitor.id)}
									<label class="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-surface"><input type="checkbox" checked={draftPlayerIds.length === 0 ? true : draftPlayerIds.includes(competitor.id)} onchange={(event) => { const current = draftPlayerIds.length === 0 ? [...basePlayerIds] : draftPlayerIds; draftPlayerIds = event.currentTarget.checked ? [...new Set([...current, competitor.id])] : current.filter((id) => id !== competitor.id); }} />{competitor.name}</label>
								{/each}
							</div>
							<div class="mt-4 flex justify-end gap-2 border-t border-border-muted pt-3"><button type="button" class="control-pill" onclick={resetFilters}>Reset</button><button type="button" class="control-pill primary" onclick={applyPlayerFilter}>Apply filters</button></div>
						</div>
					{/if}
				</div>
				{#if isAllSeasons}
					<label class="min-w-56"><span class="mb-1 block text-xs font-semibold tracking-wide text-fg-muted uppercase">All season panels</span><select class="w-full rounded-lg border border-border-muted bg-bg-elevated px-3 py-2 text-sm" bind:value={crossSeasonView} onchange={syncUrl}><option value="combined">Combine rounds where comparable</option><option value="hide-season">Hide season-specific panels</option></select></label>
				{/if}
				<button type="button" class="px-3 py-2 text-sm text-fg-muted underline" onclick={resetFilters}>Reset all</button>
			</div>
			<p class="mt-2 text-xs text-fg-faint">Showing {snapshot.league.selectedSeasons.length > 1 ? `Seasons ${snapshot.league.selectedSeasons.join(', ')}` : `Season ${snapshot.league.selectedSeasons[0]}`} · {activeOnly ? `active in Season ${mostRecentSeason}` : `${effectivePlayerIds.length || snapshot.competitors.length} players`} · {isAllSeasons ? crossSeasonView === 'combined' ? 'combined cross-season view' : 'season-specific panels hidden' : 'season view'}.</p>
		</form>
	</section>

	<nav class="mb-6 flex flex-wrap gap-1.5" data-noshot="1">
		{#each visibleTabs as tab (tab.id)}
			<button
				type="button"
				class="rounded-full px-3 py-1.5 text-sm transition-colors {active === tab.id ? 'bg-fg text-bg font-semibold' : 'text-fg-muted hover:bg-surface hover:text-fg'}"
				title={tab.title}
				onclick={() => setTab(tab.id)}
			>
				{tab.label}
			</button>
		{/each}
	</nav>

	<div use:downloadableStats={{ prefix: `${snapshot.league.slug}-${snapshot.league.selectedSeasons.join('-')}` }}>
		{#key `${active}:${selectedPlayerIds.join(',')}`}
		{#if active === 'leaderboard'}
			<LeaderboardTab {snap} omitRace={omitLeaderboardRace} />
			<RoundScoresTab {snap} />
		{:else if active === 'songs'}
			<SongsTab {snap} />
		{:else if active === 'artists'}
			<ArtistsTab {snap} />
		{:else if active === 'heatmap'}
			<HeatmapTab {snap} />
		{:else if active === 'votesgiven'}
			<VotesGivenTab {snap} />
		{:else if active === 'playlist'}
			<PlaylistTab {snap} />
		{:else if active === 'chat' && snapshot.capabilities.chat}
			<ChatTab snap={snapshot} />
		{:else if active === 'fun'}
			<FunStatsTab {snap} />
		{:else if active === 'wrapped'}
			<WrappedTab {snap} />
		{/if}
		{/key}
	</div>

	<footer class="mt-10 border-t border-border-muted pt-4 text-center text-xs text-fg-muted">
		Every visual has a PNG download. Stable tab, season, player, and card identifiers are ready for digest embeds.
	</footer>
</div>

<style>
	.control-pill { display:inline-flex; align-items:center; gap:.5rem; border:1px solid var(--color-border-muted); border-radius:999px; padding:.5rem .85rem; color:var(--color-fg); font-size:.875rem; background:var(--color-surface); }
	.control-pill:hover { border-color:var(--color-fg-muted); }
	.control-pill.primary { background:var(--color-fg); color:var(--color-bg); font-weight:600; }
	.pill-count { color:var(--color-fg-muted); font-size:.75rem; }
	.filter-popover { position:absolute; right:0; top:calc(100% + .5rem); z-index:30; width:min(22rem,calc(100vw - 2rem)); border:1px solid var(--color-border-muted); border-radius:1rem; background:var(--color-bg-elevated); padding:1rem; box-shadow:0 14px 45px #0005; }
</style>
