<script lang="ts">
	import Avatar from '../lib/atoms/Avatar.svelte';
	import { icons } from '../lib/icons.js';
	import { bsAcc } from '../lib/accents.js';
	import type { ReadModel, Nav, SharePayload } from '../lib/types.js';

	interface Props { readModel: ReadModel; nav: Nav; }
	let { readModel, nav }: Props = $props();

	const league = $derived(readModel.league);

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
	<div style="display:flex; align-items:center; justify-content:space-between;">
		<span class="bs-mark bs-mark--md">the b/side</span>
		<button class="bs-share-btn" onclick={() => {
			const first = readModel.reel[0];
			if (first) openReelShare(first);
		}}>
			{@html icons.share} Share this league
		</button>
	</div>

	<!-- Hero -->
	<div class="bs-hero">
		<div class="bs-hero-eyebrow">Season {league.season} · {league.memberCount} members</div>
		<div class="bs-hero-name">{league.name}</div>
		<div class="bs-fresh">
			<span class="bs-pulse"></span>
			Updated {league.updated}
		</div>
	</div>

	<!-- KPI ribbon -->
	<div class="bs-sec">
		<div class="bs-eyebrow">By the numbers</div>
		<div class="bs-ribbon">
			{#each readModel.kpis as kpi}
				<div class="bs-kpi">
					<div class="bs-kpi-val">{kpi.value}</div>
					<div class="bs-kpi-label">{kpi.label}</div>
					<div class="bs-kpi-sub">{kpi.sub}</div>
				</div>
			{/each}
		</div>
	</div>

	<!-- Superlative reel -->
	<div class="bs-sec">
		<div class="bs-eyebrow bs-acc-pulp"><span class="bs-acc-dot"></span>Season awards</div>
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
							<div class="bs-who">
								{member.name}
								<small>tap to see profile</small>
							</div>
							<button class="bs-share-mini" onclick={(e) => { e.stopPropagation(); openReelShare(item); }}
								aria-label="Share award">
								{@html icons.share}
							</button>
						</div>
					{/if}
				</div>
			{/each}
		</div>
	</div>

	<!-- Family grid -->
	<div class="bs-sec">
		<div class="bs-eyebrow">The family</div>
		<div class="bs-players">
			{#each readModel.members as m}
				<button class="bs-player" onclick={() => nav.goProfile(m.id)}>
					<Avatar hue={m.hue} initials={m.initials} />
					<div class="bs-player-txt">
						<div class="bs-player-name">{m.name}</div>
						{#if m.headline}
							<div class="bs-player-role">{m.headline}</div>
						{/if}
					</div>
				</button>
			{/each}
		</div>
	</div>

	<!-- Archive link -->
	<button class="bs-featured" onclick={() => nav.goArchive()}>
		<div class="bs-featured-top">
			<div class="bs-roundbadge">R{league.round} · Latest digest</div>
			{@html icons.chevR}
		</div>
		<div class="bs-featured-theme">Digest Archive →</div>
		<div class="bs-sec-sub">Every round, forever. See all {readModel.archive.length} digests.</div>
	</button>

	<!-- Footer -->
	<div class="bs-footer">
		<div class="bs-mark bs-mark--sm">the b/side</div>
		<div class="bs-footer-note">A fan-facing companion to your music league.<br /><b>No login required. No rankings. Just music.</b></div>
	</div>
</div>
