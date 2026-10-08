<script lang="ts">
	import Avatar from '../lib/atoms/Avatar.svelte';
	import { icons } from '../lib/icons.js';
	import { bsAcc, accentIcon } from '../lib/accents.js';
	import { onMount } from 'svelte';
	import PortalNav from '../lib/atoms/PortalNav.svelte';
	import { digestsFor, roundLinksFor, type PortalJson } from '../lib/portal.js';
	import { currentRound, latestDigest, latestNews, openPolls, sectionsEnabled, upNext } from '../lib/homeCards.js';
	import { normalizeSeasonFeed, type SeasonFeed } from '../lib/seasonFeed.js';
	import { getPortalSession } from '../lib/portalSession.js';
	import type { NewsItem } from '../lib/surveyApi.js';
	import type { ReadModel, Nav, SharePayload } from '../lib/types.js';

	interface Props { readModel: ReadModel; nav: Nav; portal: PortalJson | null; }
	let { readModel, nav, portal }: Props = $props();
	const session = getPortalSession();

	const digests = $derived(digestsFor(readModel, portal));
	const digestCard = $derived(latestDigest(digests));
	const latestDigestUrl = $derived(digestCard?.digestUrl ?? null);

	let feed = $state<SeasonFeed | null>(null);
	let news = $state<NewsItem[] | null>(null);
	const nextRound = $derived(upNext(feed));
	const cur = $derived(currentRound(feed));
	const roundLinks = $derived(cur ? roundLinksFor(portal, cur.round.round) : null);
	const hasSurvey = $derived(Boolean(feed?.surveyOpen));
	const polls = $derived(openPolls(feed));
	const newsCard = $derived(latestNews(news));

	// Section + card gates from portal.json's display config.
	// Default-on: a missing/stale `sections` block changes nothing.
	const secThisWeek = $derived(sectionsEnabled(portal, 'thisWeek'));
	const secByNumbers = $derived(sectionsEnabled(portal, 'byNumbers'));
	const secPulse = $derived(sectionsEnabled(portal, 'pulse'));
	const secYearbook = $derived(sectionsEnabled(portal, 'yearbook'));
	const secFamily = $derived(sectionsEnabled(portal, 'family'));
	const secMoments = $derived(sectionsEnabled(portal, 'moments'));
	const cardsCfg = $derived(portal?.sections?.thisWeek?.cards ?? null);
	const linksCfg = $derived(portal?.sections?.thisWeek?.links ?? null);
	const showDigestCard = $derived(cardsCfg?.latestDigest ?? true);
	const showCurCard = $derived(cardsCfg?.currentRound ?? true);
	const showPollCards = $derived(cardsCfg?.openPolls ?? true);
	const showSurveyCard = $derived(cardsCfg?.themeSurvey ?? true);
	const showSpotify = $derived(linksCfg?.spotify ?? true);
	const showYtm = $derived(linksCfg?.ytm ?? true);
	const showYoutube = $derived(linksCfg?.youtube ?? true);
	const showMusicLeague = $derived(linksCfg?.musicLeague ?? true);

	// KPI + member filtering (portal config, present-only so stale files show all).
	const kpiIds = $derived(portal?.sections?.byNumbers?.kpis ?? null);
	const kpis = $derived(
		kpiIds !== null ? readModel.kpis.filter((k) => k.id && kpiIds.includes(k.id)) : readModel.kpis
	);
	const excludedMembers = $derived(portal?.sections?.family?.excluded ?? null);
	const members = $derived(
		excludedMembers ? readModel.members.filter((m) => !excludedMembers.includes(m.id)) : readModel.members
	);

	const league = $derived(readModel.league);

	const momentRows = $derived(readModel.moments ? [
		{ key: 'mostLoved',    icon: icons.heart, accent: 'moss'  as const, kicker: 'Most loved',    d: readModel.moments.mostLoved },
		{ key: 'mostDivisive', icon: icons.bolt,  accent: 'amber' as const, kicker: 'Most divisive', d: readModel.moments.mostDivisive },
		{ key: 'biggestUpset', icon: icons.spark, accent: 'sky'   as const, kicker: 'Biggest upset', d: readModel.moments.biggestUpset },
	] : []);

	function openLeagueShare() {
		const payload: SharePayload = {
			award: `${league.name} · Season ${league.season}`,
			blurb: `${league.memberCount} members · Round ${league.round}`,
			who: 'Share the league',
			hue: 'oklch(0.72 0.15 25)',
			initials: league.name.slice(0, 2).toUpperCase(),
			accent: 'pulp',
		};
		nav.openShare(payload);
	}

	function openReelShare(item: ReadModel['reel'][number]) {
		const member = readModel.members.find((m) => m.id === item.winner);
		if (!member) return;
		const payload: SharePayload = {
			award: item.award,
			blurb: item.blurb,
			who: member.name,
			hue: member.hue,
			initials: member.initials,
			accent: item.accent,
		};
		nav.openShare(payload);
	}

	onMount(async () => {
		const url = portal?.seasonFeedUrl;
		if (url) {
			try {
				const parsed = new URL(url);
				if (parsed.protocol === 'https:') {
					const r = await fetch(url, { credentials: 'omit' });
					if (r.ok) feed = normalizeSeasonFeed(await r.json());
				}
			} catch { /* cards stay empty */ }
		}
		if (session.api) {
			try { news = (await session.api.news()).items; } catch { news = null; }
		}
	});
</script>

<div class="bs-pad">

	<!-- Masthead -->
	<div class="bs-topbar">
		<PortalNav current="home" {nav} {portal} />
		<span class="bs-mini-mark">b/s</span>
		<button class="bs-icon-btn" onclick={openLeagueShare} aria-label="Share this league"
			style="margin-left:auto">
			{@html icons.share}
		</button>
	</div>

	<!-- League hero -->
	<header class="bs-hero">
		<div class="bs-hero-eyebrow">{league.name} · Season {league.season} · Round {league.round}</div>
		<h1 class="bs-hero-name">{league.name}</h1>
		<span class="bs-fresh"><span class="bs-pulse"></span>Updated {league.updated}</span>
	</header>

	{#if secThisWeek && ((showDigestCard && digestCard) || (showPollCards && polls.length) || (showCurCard && (cur || nextRound)) || (showSurveyCard && hasSurvey) || newsCard)}
		<section class="bs-sec">
			<div class="bs-eyebrow bs-acc-pulp"><span class="bs-acc-dot"></span>Now</div>
			<div class="bs-sec-title">This week</div>
			<div class="bs-home-cards">
				{#if showDigestCard && digestCard?.digestUrl}
					<a class="bs-home-card" href={digestCard.digestUrl}>
						<div class="bs-home-kicker">Latest digest</div>
						<h3>{digestCard.theme}</h3>
						<p>Round {digestCard.n} · {digestCard.winnerSong}</p>
					</a>
				{/if}
				{#if showPollCards}
					{#each polls as poll}
						<button class="bs-home-card" onclick={nav.goSeason}>
							<div class="bs-home-kicker">Open poll</div>
							<h3>{poll.question}</h3>
							<p>{poll.options.length} options{poll.closesAt ? ' · closes soon' : ''}</p>
						</button>
					{/each}
				{/if}
				{#if showSurveyCard && hasSurvey}
					<button class="bs-home-card" onclick={nav.goSurvey}>
						<div class="bs-home-kicker">Open theme survey</div>
						<h3>Pick the next round's theme</h3>
						<p>The theme survey is open — have your say before it closes.</p>
					</button>
				{/if}
				{#if showCurCard && cur}
					<div class="bs-home-card">
						<div class="bs-home-card-topline">
							<div class="bs-home-kicker">Current round</div>
							<span class="bs-phase-pill bs-phase-{cur.phase}">{cur.phase}</span>
						</div>
						<h3>Round {cur.round.round} — {cur.round.title}</h3>
						<p>{cur.phase === 'submission' ? 'Songs due' : 'Voting closes'} · {new Date(cur.deadline).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</p>
						<div class="bs-round-links">
							{#if showSpotify && roundLinks?.spotify}
								<a href={roundLinks.spotify} target="_blank" rel="noopener">Spotify</a>
							{/if}
							{#if showYtm && roundLinks?.ytm}
								<a href={roundLinks.ytm} target="_blank" rel="noopener">YouTube Music</a>
							{/if}
							{#if showYoutube && roundLinks?.youtube}
								<a href={roundLinks.youtube} target="_blank" rel="noopener">YouTube video</a>
							{/if}
							{#if showMusicLeague && roundLinks?.musicLeague}
								<a href={roundLinks.musicLeague} target="_blank" rel="noopener">Music League</a>
							{/if}
						</div>
						<button class="bs-card-go-season" onclick={nav.goSeason}>View in the season →</button>
					</div>
				{:else if nextRound}
					<button class="bs-home-card" onclick={nav.goSeason}>
						<div class="bs-home-kicker">Up next</div>
						<h3>{nextRound.title}</h3>
						<p>Round {nextRound.round}{nextRound.songsDue ? ' · songs due' : nextRound.votesDue ? ' · votes due' : ''}</p>
					</button>
				{/if}
				{#if newsCard}
					<button class="bs-home-card" onclick={nav.goHome}>
						<div class="bs-home-kicker">News</div>
						<h3>{newsCard.title}</h3>
						<p>{newsCard.body}</p>
					</button>
				{/if}
			</div>
			<button class="bs-share-btn" onclick={nav.goArchive}
				style="align-self:stretch; justify-content:center">
				All digests — {digests.length} rounds &nbsp;{@html icons.chevR}
			</button>
		</section>
	{/if}

	{#if secByNumbers}
		<section class="bs-sec">
			<div class="bs-eyebrow">By the numbers</div>
			<div class="bs-sec-title">The season so far</div>
			<div class="bs-sec-sub">Quirky over competitive — nobody's framed as a loser here.</div>
			<div class="bs-ribbon">
				{#each kpis as kpi}
					<div class="bs-kpi">
						<div class="bs-kpi-val">{kpi.value}</div>
						<div class="bs-kpi-label">{kpi.label}</div>
						<div class="bs-kpi-sub">{kpi.sub}</div>
					</div>
				{/each}
			</div>
		</section>
	{/if}

	<!-- Season-Update pulse — narrated season signals, null when season is too thin -->
	{#if secPulse && readModel.seasonUpdate}
		<section class="bs-sec">
			<div class="bs-eyebrow bs-acc-sky"><span class="bs-acc-dot"></span>The pulse</div>
			<h2 class="bs-sec-title">{readModel.seasonUpdate.title}</h2>
			<div class="bs-pulse-body">
				{#each readModel.seasonUpdate.body.split('\n\n') as para}
					<p>{para}</p>
				{/each}
			</div>
		</section>
	{/if}

	<!-- Superlative reel -->
	{#if secYearbook}
	<section class="bs-sec">
		<div class="bs-eyebrow bs-acc-amber"><span class="bs-acc-dot"></span>Yearbook awards</div>
		<div class="bs-sec-title">Season {league.season} superlatives</div>
		<div class="bs-sec-sub">Tap an award to open that player's profile.</div>
		<div class="bs-reel">
			{#each readModel.reel as item}
				{@const member = readModel.members.find((m) => m.id === item.winner)}
				<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
				<div class={'bs-award ' + bsAcc(item.accent)} role="button" tabindex="0"
					onclick={() => member && nav.goProfile(member.id)}
					onkeydown={(e) => e.key === 'Enter' && member && nav.goProfile(member.id)}>
					<div class="bs-medal">{@html accentIcon(item.accent)}</div>
					<div class="bs-award-name">{item.award}</div>
					<div class="bs-award-blurb">{item.blurb}</div>
					{#if member}
						<div class="bs-award-winner">
							<Avatar hue={member.hue} initials={member.initials} size="sm" src={member.avatar_url ?? null} />
							<span class="bs-who">{member.name}<small>tap to see profile</small></span>
							<button class="bs-share-mini"
								onclick={(e) => { e.stopPropagation(); openReelShare(item); }}
								aria-label="Share award">
								{@html icons.share}
							</button>
						</div>
					{/if}
				</div>
			{/each}
		</div>
	</section>
	{/if}

	<!-- The family -->
	{#if secFamily}
	<section class="bs-sec">
		<div class="bs-eyebrow">{members.length} members</div>
		<div class="bs-sec-title">The family</div>
		<div class="bs-sec-sub">Everyone gets a page. Tap a face.</div>
		<div class="bs-players">
			{#each members as m}
				<button class="bs-player" onclick={() => nav.goProfile(m.id)}>
					<Avatar hue={m.hue} initials={m.initials} size="md" src={m.avatar_url ?? null} />
					<span class="bs-player-txt">
						<span class="bs-player-name">{m.name}</span>
						{#if m.headline}
							<span class="bs-player-role">{m.headline}</span>
						{/if}
					</span>
					{#if m.stat.wins > 0}
						<span class="bs-player-wins">
							<span class="bs-player-wins-val">{m.stat.wins}</span>
							<span class="bs-player-wins-label">{m.stat.wins === 1 ? 'win' : 'wins'}</span>
						</span>
					{/if}
				</button>
			{/each}
		</div>
	</section>
	{/if}

	<!-- Moments of the season -->
	{#if secMoments && momentRows.length > 0}
		<section class="bs-sec">
			<div class="bs-eyebrow">Consensus, not ranking</div>
			<div class="bs-sec-title">Moments of the season</div>
			<div class="bs-moments">
				{#each momentRows as r}
					{@const sub = readModel.members.find((m) => m.id === r.d.submitter)}
					<div class="bs-moment">
						<div class={'bs-moment-icon ' + bsAcc(r.accent)} style="color:var(--acc); background:var(--acc-soft); border-color:color-mix(in oklch,var(--acc) 28%,transparent)">
							{@html r.icon}
						</div>
						<div class="bs-moment-body">
							<div class="bs-moment-kicker">{r.kicker} · R-{r.d.round}</div>
							<div class="bs-moment-song">{r.d.title} <span>— {r.d.artist}</span></div>
							<div class="bs-moment-line">
								{r.d.line}
								{#if sub}<span style="color:var(--fg-quiet)"> ({sub.name})</span>{/if}
							</div>
						</div>
					</div>
				{/each}
			</div>
		</section>
	{/if}

	{#if latestDigestUrl}
		<section class="bs-sec">
			<a class="bs-share-btn" href={latestDigestUrl}
				style="align-self:stretch; justify-content:center; background:var(--mash-pulp); border-color:var(--mash-pulp); color:#fff; text-decoration:none; font-weight:700">
				Read the latest digest &rarr;
			</a>
		</section>
	{/if}

	<!-- Footer -->
	<footer class="bs-footer">
		<div class="bs-footer-mark">the b/side</div>
		<div class="bs-footer-note">
			<b>Share this link.</b> Sign in to vote, add themes, and pick ntfy or WhatsApp reminders.
		</div>
	</footer>
</div>

<style>
	.bs-home-cards { display: grid; gap: 11px; }
	.bs-home-card {
		display: flex; flex-direction: column; gap: 6px; padding: 16px; text-align: left;
		border: 1px solid var(--line); border-radius: var(--r-5); background: var(--ink-2);
		color: inherit; text-decoration: none; cursor: pointer; font: inherit;
	}
	.bs-home-card:hover { border-color: var(--mash-pulp); }
	.bs-home-kicker { color: var(--mash-pulp); font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; }
	.bs-home-card h3 { margin: 0; font-family: var(--font-display); font-size: 18px; }
	.bs-home-card p { margin: 0; color: var(--fg-muted); font-size: 13px; display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
	.bs-home-card-topline { display: flex; align-items: center; gap: 8px; }
	.bs-phase-pill {
		font-family: var(--font-mono); font-size: 9px; font-weight: 700; letter-spacing: .06em;
		text-transform: uppercase; padding: 2px 7px; border-radius: 999px; border: 1px solid var(--line);
	}
	.bs-phase-submission { color: var(--mash-pulp); background: color-mix(in oklab, var(--mash-pulp) 12%, transparent); }
	.bs-phase-voting { color: var(--mash-amber); background: color-mix(in oklab, var(--mash-amber) 12%, transparent); }
	.bs-round-links { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 2px; }
	.bs-round-links a {
		font-family: var(--font-mono); font-size: 11px; font-weight: 600; padding: 5px 10px;
		border: 1px solid var(--line); border-radius: 999px; text-decoration: none; color: inherit;
		background: var(--ink-1);
	}
	.bs-round-links a:hover { border-color: var(--mash-pulp); }
	.bs-card-go-season { background: none; border: none; padding: 0; color: var(--mash-pulp); font: inherit; font-size: 12px; cursor: pointer; text-align: left; }
</style>
