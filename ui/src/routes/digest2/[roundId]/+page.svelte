<script lang="ts">
	import '$lib/digest/digest.css';
	import StatsExplorer from '$lib/components/boarzStats/StatsExplorer.svelte';
	import AlbumPodium from '$lib/digest/AlbumPodium.svelte';
	import ChatMoments from '$lib/digest/ChatMoments.svelte';
	import StorylinesCast from '$lib/digest/StorylinesCast.svelte';
	import StandingsChart from '$lib/digest/StandingsChart.svelte';
	import NextRoundPreview from '$lib/digest/NextRoundPreview.svelte';
	import TastemakerSection from '$lib/digest/TastemakerSection.svelte';
	import GuesserLeaderboard from '$lib/digest/GuesserLeaderboard.svelte';
	import ReelSection from '$lib/digest/ReelSection.svelte';
	import DigestInsights from '$lib/digest/DigestInsights.svelte';
	import StatsTeaser from '$lib/digest2/StatsTeaser.svelte';
	import DigestChatStats from '$lib/digest2/DigestChatStats.svelte';
	import BallotSongs from '$lib/digest2/BallotSongs.svelte';
	import BallotGrid from '$lib/digest2/BallotGrid.svelte';
	import AmaSection from '$lib/digest2/AmaSection.svelte';
	import { DIGEST2_SECTION_ORDER } from '$lib/digest2/sectionOrder.js';
	import AdminBar from '$lib/digest2/AdminBar.svelte';
	import { page } from '$app/state';
	let { data } = $props();

	// villain has no dedicated visual component — render a simple card. Coinage
	// reuses the 1.0 dictionary card (DigestInsights, coinageOnly).
	const villain = $derived(
		data.story.blocks.find((b: { kind: string }) => b.kind === 'villain')?.content as
			| { title?: string; body?: string }
			| undefined
	);
	const coinage = $derived(data.story.coinage as { term?: string } | null);

	// Top-level Digest / Stats tabs, seeded from ?view= and synced to the URL.
	let view = $state<'digest' | 'stats'>(page.url.searchParams.get('view') === 'stats' ? 'stats' : 'digest');
	function setView(v: 'digest' | 'stats') {
		view = v;
		const url = new URL(window.location.href);
		if (v === 'digest') url.searchParams.delete('view');
		else url.searchParams.set('view', v);
		window.history.replaceState({}, '', url);
	}
</script>

<div style="max-width:720px;margin:0 auto;padding:1rem 1rem 0">
	{#if data.admin}
		<AdminBar roundId={data.roundId} admin={data.admin} />
	{/if}
	<h1 style="font:600 1rem/1.3 system-ui;margin-bottom:.5rem">{data.meta.leagueName} · {data.meta.roundName}</h1>
	<div role="tablist" style="display:flex;gap:.25rem;border-bottom:1px solid #2a2a2a">
		<button
			role="tab"
			aria-selected={view === 'digest'}
			onclick={() => setView('digest')}
			style="padding:.5rem .9rem;background:none;border:none;border-bottom:2px solid {view === 'digest' ? '#fff' : 'transparent'};color:{view === 'digest' ? '#fff' : '#888'};cursor:pointer;font:600 .9rem system-ui"
		>Digest</button>
		<button
			role="tab"
			aria-selected={view === 'stats'}
			onclick={() => setView('stats')}
			style="padding:.5rem .9rem;background:none;border:none;border-bottom:2px solid {view === 'stats' ? '#fff' : 'transparent'};color:{view === 'stats' ? '#fff' : '#888'};cursor:pointer;font:600 .9rem system-ui"
		>Stats</button>
	</div>
</div>

{#if view === 'digest'}
<div style="max-width:720px;margin:0 auto;padding:0 1rem">
	{#each DIGEST2_SECTION_ORDER as key (key)}
		{#if key === 'story'}
			{#each data.story.blocks as block (block.kind)}
				{#if block.kind === 'podium'}
					<AlbumPodium kind="podium" content={block.content} variant="both" />
				{:else if block.kind === 'chat'}
					<ChatMoments kind="chat" content={block.content} variant="both" />
					{#if data.snapshot.capabilities.chat}
						<DigestChatStats snapshot={data.snapshot} fromDay={data.roundStartDay} />
					{/if}
				{:else if block.kind === 'storylines'}
					<StorylinesCast kind="storylines" content={block.content} variant="both" />
				{/if}
			{/each}
		{:else if key === 'ama' && data.oneoffs?.ama}
			<AmaSection content={data.oneoffs.ama} />
		{:else if key === 'ballot' && data.ballot}
			<BallotSongs ballot={data.ballot} />
		{:else if key === 'ballotGrid' && data.ballot}
			<BallotGrid ballot={data.ballot} />
		{:else if key === 'villain' && villain}
			<section id="villain" style="margin:1.5rem 0">
				<h2>{villain.title ?? 'The Villain'}</h2>
				<p>{villain.body ?? ''}</p>
			</section>
		{:else if key === 'coinage' && coinage}
			<DigestInsights kind="stats" content={{ phrase: coinage }} coinageOnly />
		{:else if key === 'standings' && data.structural.standings}
			<StandingsChart kind="standings" content={{}} data={data.structural.standings} variant="visual" />
		{:else if key === 'tastemaker' && data.structural.tastemaker}
			<TastemakerSection kind="discoverability" content={{}} data={data.structural.tastemaker} variant="visual" />
		{:else if key === 'guesser' && data.structural.guesser}
			<GuesserLeaderboard kind="guesser" content={{}} data={data.structural.guesser} variant="visual" />
		{:else if key === 'reel' && data.structural.reel}
			<ReelSection kind="reel" content={data.structural.reel} variant="visual" />
		{:else if key === 'statsTeaser'}
			<StatsTeaser snapshot={data.snapshot} onOpenStats={() => setView('stats')} />
		{:else if key === 'nextRound' && data.structural.nextRound}
			<NextRoundPreview kind="nextRound" content={{}} data={data.structural.nextRound} variant="visual" />
		{/if}
	{/each}
</div>
{:else}
	<StatsExplorer snapshot={data.snapshot} basePath={`/digest2/${data.roundId}/stats`} omitLeaderboardRace omitTabs={['chat']} frozen={data.share} />
{/if}
