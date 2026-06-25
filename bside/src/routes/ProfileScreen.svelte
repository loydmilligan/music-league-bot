<script lang="ts">
	import Avatar from '../lib/atoms/Avatar.svelte';
	import { icons } from '../lib/icons.js';
	import { bsAcc, accentIcon } from '../lib/accents.js';
	import type { ReadModel, Nav, SharePayload, FullMember } from '../lib/types.js';

	interface Props { readModel: ReadModel; memberId: string; nav: Nav; }
	let { readModel, memberId, nav }: Props = $props();

	const member = $derived(readModel.members.find((m) => m.id === memberId));
	const isFull = $derived(member?.tier === 'full');

	function openSigShare() {
		if (!member) return;
		const payload: SharePayload = {
			award: member.signatureSuperlative.award,
			blurb: member.signatureSuperlative.blurb,
			who: member.name,
			hue: member.hue,
			initials: member.initials,
			accent: 'amber',
		};
		nav.openShare(payload);
	}

	function openSupShare(award: string, blurb: string, accent: string) {
		if (!member) return;
		const payload: SharePayload = {
			award, blurb,
			who: member.name,
			hue: member.hue,
			initials: member.initials,
			accent: accent as SharePayload['accent'],
		};
		nav.openShare(payload);
	}

	function memberByName(name: string) {
		return readModel.members.find((m) => m.name.toLowerCase() === name.toLowerCase());
	}
</script>

{#if !member}
	<div class="bs-pad">
		<div class="bs-topbar">
			<button class="bs-back" onclick={() => nav.goHome()}>
				{@html icons.chevL} League
			</button>
		</div>
		<div style="min-height:40vh; display:flex; align-items:center; justify-content:center; color:var(--fg-quiet); font-size:15px;">
			Member not found.
		</div>
	</div>
{:else}
	<div class="bs-pad">

		<!-- Top bar -->
		<div class="bs-topbar">
			<button class="bs-back" onclick={() => nav.goHome()}>
				{@html icons.chevL} {readModel.league.name}
			</button>
			<span class="bs-mark bs-mark--sm" style="margin-left:auto;">the b/side</span>
		</div>

		<!-- Hero -->
		<header class="bs-phero">
			<div class="bs-phero-top">
				<Avatar hue={member.hue} initials={member.initials} size="lg" src={member.avatar_url ?? null} />
				<div class="bs-phero-id">
					<div class="bs-phero-name">{member.name}</div>
					{#if member.joined}
						<div class="bs-phero-joined">{member.joined}</div>
					{/if}
				</div>
			</div>
			{#if member.headline}
				<p class="bs-phero-headline">{member.headline}</p>
			{/if}
			<div class="bs-statline">
				<div class="bs-stat">
					<div class="bs-stat-val">{member.stat.submitted}</div>
					<div class="bs-stat-label">submitted</div>
				</div>
				<div class="bs-stat">
					<div class="bs-stat-val">{member.stat.avgPts.toFixed(1)}</div>
					<div class="bs-stat-label">avg pts</div>
				</div>
				<div class="bs-stat">
					<div class="bs-stat-val">{member.stat.wins}</div>
					<div class="bs-stat-label">wins</div>
				</div>
			</div>
		</header>

		<!-- Signature superlative trophy — amber, the headline award -->
		<section class="bs-sec">
			<div class={'bs-trophy ' + bsAcc('amber')}>
				<div class="bs-trophy-medal">{@html icons.trophy}</div>
				<div class="bs-trophy-body">
					<div class="bs-trophy-eyebrow">{member.name}'s headline award</div>
					<div class="bs-trophy-name">{member.signatureSuperlative.award}</div>
					<div class="bs-trophy-blurb">{member.signatureSuperlative.blurb}</div>
				</div>
			</div>
			<button class="bs-share-btn" onclick={openSigShare}>
				{@html icons.share} Share this award
			</button>
		</section>

		<!-- Taste fingerprint — chips for both tiers; spectrum + rewards/punishes for full -->
		{#if member.signatureArtists.length > 0 || member.genres.length > 0 || member.eras.length > 0 || isFull}
			<section class="bs-sec">
				<div>
					<div class="bs-eyebrow bs-acc-pulp"><span class="bs-acc-dot"></span>Taste fingerprint</div>
					<div class="bs-sec-title">What makes them tick</div>
					{#if isFull}
						<div class="bs-sec-sub">An AI read of their picks and votes.</div>
					{/if}
				</div>

				{#if member.signatureArtists.length > 0}
					<div>
						<div class="bs-rp-h" style="color:var(--fg-quiet); margin-bottom:7px;">Signature artists</div>
						<div class="bs-chips">
							{#each member.signatureArtists as a}
								<div class={'bs-chip' + (a.star ? ' bs-chip--star' : '')}>
									{#if a.star}{@html icons.star}{/if}
									{a.name}
								</div>
							{/each}
						</div>
					</div>
				{/if}

				{#if member.genres.length > 0 || member.eras.length > 0}
					<div>
						<div class="bs-rp-h" style="color:var(--fg-quiet); margin-bottom:7px;">Sounds like</div>
						<div class="bs-chips">
							{#each member.genres as g}<div class="bs-chip bs-chip--soft">{g}</div>{/each}
							{#each member.eras as e}<div class="bs-chip bs-chip--soft">{e}</div>{/each}
						</div>
					</div>
				{/if}

				{#if isFull}
					{@const full = member as FullMember}

					{#if full.spectrum.length > 0}
						<div class="bs-spectrum">
							{#each full.spectrum as axis}
								<div class="bs-spec-row">
									<div class="bs-spec-ends">
										<span class="bs-end-l">{axis.left}</span>
										<span class="bs-end-r">{axis.right}</span>
									</div>
									<div class="bs-spec-track">
										<div class="bs-spec-dot" style:left={axis.value + '%'}></div>
									</div>
								</div>
							{/each}
						</div>
					{/if}

					{#if full.rewards.length > 0 || full.punishes.length > 0}
						<div class="bs-rp">
							{#if full.rewards.length > 0}
								<div class="bs-rp-col" data-kind="up">
									<div class="bs-rp-h">{@html icons.thumbU} Rewards</div>
									{#each full.rewards as r}<div class="bs-rp-item">{r}</div>{/each}
								</div>
							{/if}
							{#if full.punishes.length > 0}
								<div class="bs-rp-col" data-kind="down">
									<div class="bs-rp-h">{@html icons.thumbD} Punishes</div>
									{#each full.punishes as p}<div class="bs-rp-item">{p}</div>{/each}
								</div>
							{/if}
						</div>
					{/if}
				{/if}
			</section>
		{/if}

		<!-- More superlatives — full only -->
		{#if isFull}
			{@const full = member as FullMember}
			{#if full.superlatives.length > 0}
				<section class="bs-sec">
					<div>
						<div class="bs-eyebrow bs-acc-sky"><span class="bs-acc-dot"></span>More awards</div>
						<div class="bs-sec-title">Yearbook superlatives</div>
					</div>
					{#each full.superlatives as sup}
						<div class={'bs-award ' + bsAcc(sup.accent)}>
							<div class="bs-medal">{@html accentIcon(sup.accent)}</div>
							<div class="bs-award-name">{sup.award}</div>
							<div class="bs-award-blurb">{sup.blurb}</div>
							<div class="bs-award-winner">
								<button class="bs-share-mini" onclick={() => openSupShare(sup.award, sup.blurb, sup.accent)} aria-label="Share award">
									{@html icons.share}
								</button>
							</div>
						</div>
					{/each}
				</section>
			{/if}
		{/if}

		<!-- Biggest fan / friendly hater -->
		{#if isFull}
			{@const full = member as FullMember}
			{#if full.biggestFan || full.biggestHater}
				<section class="bs-sec">
					<div>
						<div class="bs-eyebrow bs-acc-moss"><span class="bs-acc-dot"></span>Vote relationships</div>
						<div class="bs-sec-title">Biggest fan &amp; friendly hater</div>
						<div class="bs-sec-sub">Who rewards your picks — and who buries them, lovingly.</div>
					</div>
					<div class="bs-fh">
						{#if full.biggestFan}
							{@const fan = full.biggestFan}
							{@const fanM = memberByName(fan.who)}
							<div class="bs-fhcard" data-kind="fan">
								<div class="bs-fh-tag">{@html icons.heart} Biggest fan</div>
								<div class="bs-fh-who">
									{#if fanM}<Avatar hue={fanM.hue} initials={fanM.initials} size="sm" src={fanM.avatar_url ?? null} />{/if}
									<div class="bs-fh-whoname">{fan.who}</div>
									<div class="bs-fh-pts">+{fan.pts}</div>
								</div>
								{#if fan.line}<div class="bs-fh-line">{fan.line}</div>{/if}
							</div>
						{/if}
						{#if full.biggestHater}
							{@const hater = full.biggestHater}
							{@const haterM = memberByName(hater.who)}
							<div class="bs-fhcard" data-kind="hater">
								<div class="bs-fh-tag">{@html icons.bolt} Friendly hater</div>
								<div class="bs-fh-who">
									{#if haterM}<Avatar hue={haterM.hue} initials={haterM.initials} size="sm" src={haterM.avatar_url ?? null} />{/if}
									<div class="bs-fh-whoname">{hater.who}</div>
									<div class="bs-fh-pts">{hater.pts}</div>
								</div>
								{#if hater.line}<div class="bs-fh-line">{hater.line}</div>{/if}
							</div>
						{/if}
					</div>
				</section>
			{/if}
		{:else if member.biggestFan}
			{@const fan = member.biggestFan}
			{@const fanM = memberByName(fan.who)}
			<section class="bs-sec">
				<div>
					<div class="bs-eyebrow bs-acc-moss"><span class="bs-acc-dot"></span>Vote relationships</div>
					<div class="bs-sec-title">Biggest fan</div>
				</div>
				<div class="bs-fhcard" data-kind="fan" style="max-width:300px;">
					<div class="bs-fh-tag">{@html icons.heart} Biggest fan</div>
					<div class="bs-fh-who">
						{#if fanM}<Avatar hue={fanM.hue} initials={fanM.initials} size="sm" src={fanM.avatar_url ?? null} />{/if}
						<div class="bs-fh-whoname">{fan.who}</div>
						<div class="bs-fh-pts">+{fan.pts}</div>
					</div>
					{#if fan.line}<div class="bs-fh-line">{fan.line}</div>{/if}
				</div>
			</section>
		{/if}

		<!-- Your people — overlap v2, two honest metrics, full only -->
		{#if isFull}
			{@const full = member as FullMember}
			{#if full.voteTogether.length > 0 || full.voteTwins.length > 0}
				<section class="bs-sec">
					<div>
						<div class="bs-eyebrow bs-acc-pulp"><span class="bs-acc-dot"></span>Overlap v2.0</div>
						<div class="bs-sec-title">Your people</div>
						<div class="bs-sec-sub">Two honest reads — who you vote with, and who just shares your taste.</div>
					</div>
					<div class="bs-people-split">
						{#if full.voteTogether.length > 0}
							<div class="bs-people-group" style="border-top: 2px solid var(--mash-pulp);">
								<div class="bs-people-gh">
									<div class="bs-people-gt">
										Vote Together
										<span class="bs-tag2">within shared rounds</span>
									</div>
									<div class="bs-people-gnote">How often you actually hand each other points when you're in the same round.</div>
								</div>
								{#each full.voteTogether as p}
									{@const pm = memberByName(p.who)}
									<div class="bs-person">
										{#if pm}<Avatar hue={pm.hue} initials={pm.initials} size="sm" src={pm.avatar_url ?? null} />{/if}
										<div class="bs-person-name">{p.who}</div>
										<div class="bs-person-bar">
											<div class="bs-person-fill" style:width={p.pct + '%'}></div>
										</div>
										<div class="bs-person-pct">{p.pct}%</div>
									</div>
								{/each}
							</div>
						{/if}
						{#if full.voteTwins.length > 0}
							<div class="bs-people-group bs-person-grp2" style="border-top: 2px solid var(--sky);">
								<div class="bs-people-gh">
									<div class="bs-people-gt">
										Taste Twins
										<span class="bs-tag2" style="border-color: var(--sky); color: var(--sky);">across all leagues</span>
									</div>
									<div class="bs-people-gnote">Similar taste even when you've never shared a round — no penalty for no overlap.</div>
								</div>
								{#each full.voteTwins as p}
									{@const pm = memberByName(p.who)}
									<div class="bs-person">
										{#if pm}<Avatar hue={pm.hue} initials={pm.initials} size="sm" src={pm.avatar_url ?? null} />{/if}
										<div class="bs-person-name">{p.who}</div>
										<div class="bs-person-bar">
											<div class="bs-person-fill" style:width={p.pct + '%'}></div>
										</div>
										<div class="bs-person-pct">{p.pct}%</div>
									</div>
								{/each}
							</div>
						{/if}
					</div>
				</section>
			{/if}
		{/if}

		<!-- Discovery playlist — full only -->
		{#if isFull}
			{@const full = member as FullMember}
			<section class="bs-sec">
				<div>
					<div class="bs-eyebrow bs-acc-ember"><span class="bs-acc-dot"></span>Recommendations</div>
					<div class="bs-sec-title">A playlist with an agenda</div>
				</div>
				<div class="bs-playlist">
					<div class="bs-pl-head">
						<div class="bs-pl-kicker">{@html icons.spark} For {member.name}</div>
						<div class="bs-pl-name">{full.playlist.name}</div>
						{#if full.playlist.nudge}
							<div class="bs-pl-nudge">{full.playlist.nudge}</div>
						{/if}
					</div>
					{#each full.playlist.tracks as track, i}
						<div class="bs-pl-track">
							<div class="bs-pl-num">{String(i + 1).padStart(2, '0')}</div>
							<div class="bs-pl-track-body">
								<div class="bs-pl-title">{track.title} <span>· {track.artist}</span></div>
								<div class="bs-pl-why">{track.why}</div>
							</div>
						</div>
					{/each}
				</div>
			</section>
		{/if}

		<!-- Lite footnote -->
		{#if !isFull}
			<div style="text-align:center; padding: 4px 8px; color: var(--fg-quiet); font-size: 12.5px; line-height: 1.5;">
				{member.name}'s full profile fills in as the season plays out.
			</div>
		{/if}

		<!-- Footer -->
		<footer class="bs-footer">
			<div class="bs-mark bs-mark--sm">the b/side</div>
			<div class="bs-footer-note">{readModel.league.name} · shareable, no login</div>
		</footer>

	</div>
{/if}
