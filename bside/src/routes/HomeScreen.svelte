<script lang="ts">
	import Avatar from '../lib/atoms/Avatar.svelte';
	import { icons } from '../lib/icons.js';
	import { bsAcc } from '../lib/accents.js';
	import type { ReadModel, Nav, SharePayload } from '../lib/types.js';

	interface Props { readModel: ReadModel; nav: Nav; }
	let { readModel, nav }: Props = $props();

	const league = $derived(readModel.league);
	const latestRound = $derived(readModel.archive[0] ?? null);
	const latestSubmitter = $derived(
		latestRound ? (readModel.members.find((m) => m.id === latestRound.submitter) ?? null) : null
	);

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
</script>

<div class="bs-pad">

	<!-- Masthead -->
	<div class="bs-topbar">
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

	<!-- KPI ribbon — celebratory, no win/loss ladder -->
	<section class="bs-sec">
		<div class="bs-eyebrow">By the numbers</div>
		<div class="bs-sec-title">The season so far</div>
		<div class="bs-sec-sub">Quirky over competitive — nobody's framed as a loser here.</div>
		<div class="bs-ribbon">
			{#each readModel.kpis as kpi}
				<div class="bs-kpi">
					<div class="bs-kpi-val">{kpi.value}</div>
					<div class="bs-kpi-label">{kpi.label}</div>
					<div class="bs-kpi-sub">{kpi.sub}</div>
				</div>
			{/each}
		</div>
	</section>

	<!-- Season-Update pulse — narrated season signals, null when season is too thin -->
	{#if readModel.seasonUpdate}
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
					<div class="bs-medal">{@html icons.trophy}</div>
					<div class="bs-award-name">{item.award}</div>
					<div class="bs-award-blurb">{item.blurb}</div>
					{#if member}
						<div class="bs-award-winner">
							<Avatar hue={member.hue} initials={member.initials} size="sm" />
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

	<!-- The family -->
	<section class="bs-sec">
		<div class="bs-eyebrow">{league.memberCount} members</div>
		<div class="bs-sec-title">The family</div>
		<div class="bs-sec-sub">Everyone gets a page. Tap a face.</div>
		<div class="bs-players">
			{#each readModel.members as m}
				<button class="bs-player" onclick={() => nav.goProfile(m.id)}>
					<Avatar hue={m.hue} initials={m.initials} size="md" />
					<span class="bs-player-txt">
						<span class="bs-player-name">{m.name}</span>
						{#if m.headline}
							<span class="bs-player-role">{m.headline}</span>
						{/if}
					</span>
				</button>
			{/each}
		</div>
	</section>

	<!-- Moments of the season -->
	{#if momentRows.length > 0}
		<section class="bs-sec">
			<div class="bs-eyebrow">Consensus, not ranking</div>
			<div class="bs-sec-title">Moments of the season</div>
			<div class="bs-moments">
				{#each momentRows as r}
					{@const sub = readModel.members.find((m) => m.id === r.d.submitter)}
					<div class="bs-moment">
						<div class={'bs-moment-icon ' + bsAcc(r.accent)} style="color:var(--acc)">
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

	<!-- Latest digest teaser -->
	{#if latestRound}
		<section class="bs-sec">
			<div class="bs-eyebrow">Fresh off the press</div>
			<div class="bs-sec-title">Latest round</div>
			<div class="bs-sec-sub">The full digest archive lives here too.</div>
			<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
			<div class="bs-featured" role="button" tabindex="0"
				onclick={nav.goArchive}
				onkeydown={(e) => e.key === 'Enter' && nav.goArchive()}
				style="--hue:{latestRound.hue}">
				<div class="bs-featured-top">
					<span class="bs-roundbadge">ROUND {latestRound.n}</span>
					<span class="bs-tag-new">Just closed</span>
				</div>
				<div class="bs-featured-theme">{latestRound.theme}</div>
				<div class="bs-winner-row">
					{#if latestSubmitter}
						<Avatar hue={latestSubmitter.hue} initials={latestSubmitter.initials} size="sm" />
					{/if}
					<div class="bs-winner-meta">
						<div class="bs-winner-song">{latestRound.winnerSong} — {latestRound.winnerArtist}</div>
						<div class="bs-winner-by">
							Won by {latestSubmitter?.name ?? latestRound.submitter} · {latestRound.votes} votes cast
						</div>
					</div>
					<span class="bs-winner-medal" style="color:var(--amber)">{@html icons.trophy}</span>
				</div>
			</div>
			<button class="bs-share-btn" onclick={nav.goArchive}
				style="align-self:stretch; justify-content:center">
				Open the archive — {readModel.archive.length} rounds &nbsp;{@html icons.chevR}
			</button>
		</section>
	{/if}

	<!-- Footer -->
	<footer class="bs-footer">
		<div class="bs-footer-mark">the b/side</div>
		<div class="bs-footer-note">
			<b>No login. Just this link.</b> Share it with the family — it never reveals the league HQ.
		</div>
	</footer>
</div>
