<script lang="ts">
	import { onMount } from 'svelte';
	import PortalNav from '../lib/atoms/PortalNav.svelte';
	import { normalizeSeasonFeed, type SeasonFeed } from '../lib/seasonFeed.js';
	import type { PortalJson } from '../lib/portal.js';
	import type { Nav, ReadModel } from '../lib/types.js';

	interface Props { readModel: ReadModel; nav: Nav; portal: PortalJson | null; }
	let { readModel, nav, portal }: Props = $props();

	let feed = $state<SeasonFeed | null>(null);
	let loading = $state(true);

	function safeHttps(value: string | null | undefined): string | null {
		if (!value) return null;
		try { return new URL(value).protocol === 'https:' ? value : null; }
		catch { return null; }
	}

	const fallbackHub = $derived(safeHttps(portal?.seasonHubUrl));
	const hubUrl = $derived(feed?.links.hub ?? fallbackHub);

	function dateTime(value: string | null): string | null {
		if (!value) return null;
		const d = new Date(value);
		if (Number.isNaN(d.getTime())) return null;
		return new Intl.DateTimeFormat(undefined, {
			month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
		}).format(d);
	}

	function resultWidth(votes: number, max: number): string {
		return `${max > 0 ? Math.max(4, (votes / max) * 100) : 0}%`;
	}

	onMount(() => {
		const url = safeHttps(portal?.seasonFeedUrl);
		if (!url) { loading = false; return; }
		fetch(url, { credentials: 'omit', signal: AbortSignal.timeout(8000) })
			.then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<unknown>; })
			.then((raw) => { feed = normalizeSeasonFeed(raw); })
			.catch(() => { feed = null; })
			.finally(() => { loading = false; });
	});
</script>

<div class="bs-pad">
	<div class="bs-topbar">
		<PortalNav current="season" {nav} {portal} />
		<span class="bs-mark bs-mark--sm" style="margin-left:auto;">the b/side</span>
	</div>

	{#if loading}
		<div class="season-status">Loading the season…</div>
	{:else if !feed}
		{#if fallbackHub}
			<a class="season-fallback" href={fallbackHub}>
				<span>Season details live on the league hub.</span>
				<strong>Open the season hub →</strong>
			</a>
		{/if}
	{:else}
		<header class="bs-hero season-hero">
			<div class="bs-hero-eyebrow">Season {feed.season}</div>
			<h1 class="bs-hero-name">{feed.leagueName || readModel.league.name}</h1>
			{#if feed.surveyOpen && feed.links.survey}
				<a class="season-primary" href={feed.links.survey}>Add themes →</a>
			{/if}
		</header>

		{#if feed.pollsOpen.length}
			<section class="bs-sec">
				<div class="bs-eyebrow">Open now</div>
				<h2 class="bs-sec-title">Vote in the polls</h2>
				<div class="season-stack">
					{#each feed.pollsOpen as poll}
						<article class="season-card poll-card">
							<div class="season-kicker">{poll.round ? `Round ${poll.round}` : 'Season poll'}</div>
							<h3>{poll.question}</h3>
							{#if poll.blurb}<p>{poll.blurb}</p>{/if}
							<ul class="poll-options">
								{#each poll.options as option}
									<li><strong>{option.label}</strong>{#if option.description}<span>{option.description}</span>{/if}</li>
								{/each}
							</ul>
							<div class="season-actions">
								{#if dateTime(poll.closesAt)}<span>Closes {dateTime(poll.closesAt)}</span>{/if}
								{#if feed.links.polls}<a href={feed.links.polls}>Vote →</a>{/if}
							</div>
						</article>
					{/each}
				</div>
			</section>
		{/if}

		<section class="bs-sec">
			<div class="bs-eyebrow">The lineup</div>
			<h2 class="bs-sec-title">Season {feed.season} rounds</h2>
			<div class="season-stack">
				{#each feed.lineup as round}
					<article class:teaser={round.status === 'teaser'} class="season-card round-card">
						<div class="round-head">
							<span class="round-number">{round.round}</span>
							<div>
								<div class="season-kicker">Round {round.round}</div>
								<h3>{round.title}</h3>
							</div>
						</div>
						{#if round.description}<p>{round.description}</p>{/if}
						{#if round.status === 'revealed'}
							{#if round.commentRule}
								<div class="comment-chip">
									Comment {round.commentRule.level}: {round.commentRule.prompt}
									{#if round.commentRule.hiddenUntilVotingEnds}<small>Hidden until voting ends</small>{/if}
								</div>
							{/if}
							{#if round.credit.length}<div class="theme-credit">Theme by {round.credit.join(', ')}</div>{/if}
						{:else if dateTime(round.revealAt)}
							<div class="locked">🔒 Revealed {dateTime(round.revealAt)}</div>
						{/if}
						<div class="round-dates">
							{#if dateTime(round.songsDue)}<span><b>Songs due</b>{dateTime(round.songsDue)}</span>{/if}
							{#if dateTime(round.votesDue)}<span><b>Votes due</b>{dateTime(round.votesDue)}</span>{/if}
						</div>
					</article>
				{/each}
			</div>
		</section>

		{#if feed.pollsClosed.length}
			<section class="bs-sec">
				<div class="bs-eyebrow">Poll results</div>
				<h2 class="bs-sec-title">The votes are in</h2>
				<div class="season-stack">
					{#each feed.pollsClosed as poll}
						{@const maxVotes = Math.max(0, ...poll.results.map((r) => r.votes))}
						<article class="season-card poll-card">
							<div class="season-kicker">{poll.round ? `Round ${poll.round}` : 'Season poll'}</div>
							<h3>{poll.question}</h3>
							{#if poll.blurb}<p>{poll.blurb}</p>{/if}
							<div class="poll-results">
								{#each poll.results as result}
									<div class="poll-result">
										<div class="result-label"><span>{result.label}</span><b>{result.votes}</b></div>
										<div class="result-track"><span style:width={resultWidth(result.votes, maxVotes)}></span></div>
									</div>
								{/each}
							</div>
							{#if poll.winner}<div class="winner-chip">Winner · {poll.winner}</div>{/if}
						</article>
					{/each}
				</div>
			</section>
		{/if}

		{#if hubUrl}
			<a class="season-fallback" href={hubUrl}>
				<span>Submit themes, vote, and manage your season profile.</span>
				<strong>Open the season hub →</strong>
			</a>
		{/if}
	{/if}
</div>

<style>
	.season-status { padding: 22px; border: 1px solid var(--line); border-radius: var(--r-5); color: var(--fg-muted); background: var(--ink-1); }
	.season-hero { padding-bottom: 4px; }
	.season-primary { align-self: flex-start; padding: 10px 17px; border-radius: var(--r-full); background: var(--mash-pulp); color: white; font-family: var(--font-mono); font-size: 12px; font-weight: 700; text-decoration: none; }
	.season-primary:hover { background: var(--mash-pulp-deep); }
	.season-stack { display: flex; flex-direction: column; gap: 11px; }
	.season-card { display: flex; flex-direction: column; gap: 11px; padding: 16px; border: 1px solid var(--line); border-radius: var(--r-5); background: var(--ink-2); }
	.season-card.teaser { border-style: dashed; background: var(--ink-1); }
	.season-card h3 { margin: 0; color: var(--fg); font-family: var(--font-display); font-size: 18px; line-height: 1.18; }
	.season-card p { margin: 0; color: var(--fg-muted); font-size: 13px; line-height: 1.55; }
	.season-kicker { color: var(--mash-pulp); font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; }
	.round-head { display: flex; align-items: center; gap: 12px; }
	.round-number { display: grid; place-items: center; width: 39px; height: 39px; flex: 0 0 auto; border-radius: 12px; background: var(--ink-3); color: var(--fg); font-family: var(--font-display); font-size: 20px; font-weight: 800; }
	.comment-chip, .locked, .winner-chip { align-self: flex-start; padding: 6px 10px; border: 1px solid #ff5b2e55; border-radius: var(--r-full); background: var(--mash-pulp-soft); color: var(--fg-2); font-size: 11px; }
	.comment-chip small { display: block; margin-top: 2px; color: var(--fg-quiet); }
	.locked { border-color: var(--line); background: var(--ink-2); color: var(--fg-muted); }
	.theme-credit { color: var(--fg-muted); font-size: 12px; font-style: italic; }
	.round-dates { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
	.round-dates span { padding: 9px 10px; border-radius: var(--r-3); background: var(--ink-1); color: var(--fg-muted); font-size: 11px; }
	.round-dates b { display: block; margin-bottom: 2px; color: var(--fg-2); font-family: var(--font-mono); font-size: 9px; letter-spacing: .06em; text-transform: uppercase; }
	.poll-options { display: flex; flex-direction: column; gap: 7px; margin: 0; padding: 0; list-style: none; }
	.poll-options li { padding: 10px 12px; border: 1px solid var(--line); border-radius: var(--r-3); background: var(--ink-1); color: var(--fg-2); font-size: 13px; }
	.poll-options span { display: block; margin-top: 3px; color: var(--fg-quiet); font-size: 11px; }
	.season-actions { display: flex; align-items: center; justify-content: space-between; gap: 12px; color: var(--fg-quiet); font-family: var(--font-mono); font-size: 10px; }
	.season-actions a { padding: 7px 12px; border-radius: var(--r-full); background: var(--mash-pulp); color: white; font-size: 11px; font-weight: 700; text-decoration: none; }
	.poll-results { display: flex; flex-direction: column; gap: 10px; }
	.result-label { display: flex; justify-content: space-between; gap: 12px; color: var(--fg-2); font-size: 12px; }
	.result-track { height: 7px; margin-top: 4px; overflow: hidden; border-radius: var(--r-full); background: var(--ink-4); }
	.result-track span { display: block; height: 100%; border-radius: inherit; background: var(--mash-pulp); }
	.winner-chip { color: var(--fg); font-weight: 700; }
	.season-fallback { display: flex; flex-direction: column; gap: 7px; padding: 18px; border: 1px solid #ff5b2e55; border-radius: var(--r-5); background: linear-gradient(135deg, var(--mash-pulp-soft), var(--ink-1)); color: var(--fg-muted); font-size: 13px; text-decoration: none; }
	.season-fallback strong { color: var(--fg); font-family: var(--font-display); font-size: 17px; }
	.season-fallback:hover { border-color: var(--mash-pulp); }
	@media (max-width: 390px) { .round-dates { grid-template-columns: 1fr; } }
</style>
