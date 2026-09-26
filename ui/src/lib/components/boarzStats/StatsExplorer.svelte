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

	let { snapshot, basePath }: { snapshot: Snapshot; basePath: string } = $props();
	const TABS = [
		{ id: 'leaderboard', label: '🏆 Leaderboard' },
		{ id: 'roundscores', label: '📈 Round Scores' },
		{ id: 'songs', label: '🎵 Songs' },
		{ id: 'artists', label: '🎤 Artists' },
		{ id: 'heatmap', label: '🔥 Vote Heatmap' },
		{ id: 'votesgiven', label: '💙 Votes Given' },
		{ id: 'playlist', label: '📍 Playlist Position' },
		{ id: 'chat', label: '💬 Chat', needsChat: true },
		{ id: 'fun', label: '✨ Fun Stats' },
		{ id: 'wrapped', label: '🎈 Wrapped' },
	] as const;
	type TabId = (typeof TABS)[number]['id'];
	const visibleTabs = $derived(TABS.filter((tab) => !('needsChat' in tab) || snapshot.capabilities.chat));
	const tabIds = $derived(visibleTabs.map((tab) => tab.id));
	const requestedTab = page.url.searchParams.get('tab') as TabId;
	let active = $state<TabId>(TABS.some((tab) => tab.id === requestedTab) ? requestedTab : 'leaderboard');

	const initialPlayers = page.url.searchParams.get('players')?.split(',').map(Number).filter(Number.isFinite) ?? [];
	let selectedPlayerIds = $state<number[]>(initialPlayers);
	const snap = $derived(filterSnapshotPlayers(snapshot, selectedPlayerIds));
	const allPlayers = $derived(selectedPlayerIds.length === 0 || selectedPlayerIds.length === snapshot.competitors.length);

	function syncUrl() {
		const url = new URL(window.location.href);
		url.searchParams.set('tab', active);
		if (allPlayers) url.searchParams.delete('players');
		else url.searchParams.set('players', selectedPlayerIds.join(','));
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

	<section class="mb-5 grid gap-3 rounded-xl border border-border-muted bg-surface/30 p-4 md:grid-cols-[minmax(12rem,18rem)_1fr]" data-noshot="1">
		<form action={basePath} method="GET" class="space-y-1.5">
			<label for="stats-season" class="block text-xs font-semibold tracking-wide text-fg-muted uppercase">Season window</label>
			<div class="flex gap-2">
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
				<input type="hidden" name="tab" value={active} />
				<button class="rounded-lg bg-fg px-3 py-2 text-sm font-semibold text-bg" type="submit">Apply</button>
			</div>
			<p class="text-xs text-fg-faint">All seasons creates a true cross-season comparison.</p>
		</form>

		<details class="group">
			<summary class="cursor-pointer list-none text-xs font-semibold tracking-wide text-fg-muted uppercase">
				Focus players · {allPlayers ? 'everyone' : `${selectedPlayerIds.length} selected`} <span class="text-fg-faint">▾</span>
			</summary>
			<div class="mt-2 flex flex-wrap gap-2">
				<button type="button" class="rounded-md border border-border-muted px-2 py-1 text-xs hover:border-accent" onclick={selectAllPlayers}>Everyone</button>
				{#each snapshot.competitors as competitor (competitor.id)}
					<label class="flex cursor-pointer items-center gap-1.5 rounded-md border border-border-muted px-2 py-1 text-xs hover:border-accent">
						<input
							type="checkbox"
							checked={allPlayers || selectedPlayerIds.includes(competitor.id)}
							onchange={(event) => togglePlayer(competitor.id, event.currentTarget.checked)}
						/>
						{competitor.name}
					</label>
				{/each}
			</div>
			<p class="mt-2 text-xs text-fg-faint">Applies to competition visuals; chat stays league-wide to preserve context.</p>
		</details>
	</section>

	<nav class="mb-6 flex flex-wrap gap-1.5" data-noshot="1">
		{#each visibleTabs as tab (tab.id)}
			<button
				type="button"
				class="rounded-lg px-3 py-1.5 text-sm transition-colors {active === tab.id ? 'bg-fg text-bg font-semibold' : 'text-fg-muted hover:bg-surface hover:text-fg'}"
				onclick={() => setTab(tab.id)}
			>
				{tab.label}
			</button>
		{/each}
	</nav>

	<div use:downloadableStats={{ prefix: `${snapshot.league.slug}-${snapshot.league.selectedSeasons.join('-')}` }}>
		{#key `${active}:${selectedPlayerIds.join(',')}`}
		{#if active === 'leaderboard'}
			<LeaderboardTab {snap} />
		{:else if active === 'roundscores'}
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
