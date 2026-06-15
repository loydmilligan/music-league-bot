<script lang="ts">
	import Avatar from '../lib/atoms/Avatar.svelte';
	import { icons } from '../lib/icons.js';
	import { bsAcc } from '../lib/accents.js';
	import type { ReadModel, Nav, SharePayload, FullMember } from '../lib/types.js';

	interface Props { readModel: ReadModel; memberId: string; nav: Nav; }
	let { readModel, memberId, nav }: Props = $props();

	const member = $derived(readModel.members.find((m) => m.id === memberId));
	const isFull = $derived(member?.tier === 'full');

	function openSigShare() {
		if (!member) return;
		const sig = member.signatureSuperlative;
		const payload: SharePayload = {
			award: sig.award,
			blurb: sig.blurb,
			who: member.name,
			hue: member.hue,
			initials: member.initials,
			accent: 'pulp',
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
</script>

{#if !member}
	<div class="bs-pad">
		<div class="bs-topbar">
			<button class="bs-back" onclick={() => nav.goHome()}>
				{@html icons.chevL} League
			</button>
		</div>
		<div class="bs-error" style="min-height:40vh; display:flex; align-items:center; justify-content:center;">
			Member not found.
		</div>
	</div>
{:else}
	<div class="bs-pad">
		<!-- Top bar -->
		<div class="bs-topbar">
			<button class="bs-back" onclick={() => nav.goHome()}>
				{@html icons.chevL} League
			</button>
			<span class="bs-mark bs-mark--sm" style="margin-left:auto;">the b/side</span>
		</div>

		<!-- Profile hero -->
		<div class="bs-phero">
			<div class="bs-phero-top">
				<Avatar hue={member.hue} initials={member.initials} size="lg" />
				<div class="bs-phero-id">
					<div class="bs-phero-name">{member.name}</div>
					{#if member.joined}
						<div class="bs-phero-joined">{member.joined}</div>
					{/if}
				</div>
			</div>
			{#if member.headline}
				<div class="bs-phero-headline">{member.headline}</div>
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
		</div>

		<!-- Signature superlative trophy -->
		<div class={'bs-trophy ' + bsAcc('pulp')}>
			<div class="bs-trophy-medal">{@html icons.trophy}</div>
			<div class="bs-trophy-body">
				<div class="bs-trophy-eyebrow">Signature award</div>
				<div class="bs-trophy-name">{member.signatureSuperlative.award}</div>
				<div class="bs-trophy-blurb">{member.signatureSuperlative.blurb}</div>
			</div>
		</div>
		<button class="bs-share-btn" onclick={openSigShare}>
			{@html icons.share} Share this award
		</button>

		{#if member.tier === 'lite'}
			<div class="bs-footer-note" style="margin-top:8px; text-align:center;">
				<small>Taste fingerprint data not yet available for this member.</small>
			</div>
		{/if}

		{#if isFull}
			{@const full = member as FullMember}

			<!-- Taste fingerprint: artists -->
			<div class="bs-sec">
				<div class="bs-eyebrow bs-acc-pulp"><span class="bs-acc-dot"></span>Signature artists</div>
				<div class="bs-chips">
					{#each full.signatureArtists as a}
						<div class={'bs-chip' + (a.star ? ' bs-chip--star' : '')}>
							{#if a.star}{@html icons.star}{/if}
							{a.name}
						</div>
					{/each}
				</div>
			</div>

			<!-- Genres + eras -->
			<div class="bs-sec">
				<div class="bs-eyebrow">Sounds like</div>
				<div class="bs-chips">
					{#each full.genres as g}<div class="bs-chip bs-chip--soft">{g}</div>{/each}
					{#each full.eras as e}<div class="bs-chip bs-chip--soft">{e}</div>{/each}
				</div>
			</div>

			<!-- Spectrum sliders -->
			<div class="bs-sec">
				<div class="bs-eyebrow">Taste spectrum</div>
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
			</div>

			<!-- Rewards / punishes -->
			<div class="bs-sec">
				<div class="bs-eyebrow">Taste rules</div>
				<div class="bs-rp">
					<div class="bs-rp-col" data-kind="up">
						<div class="bs-rp-h">{@html icons.thumbU} Rewards</div>
						{#each full.rewards as r}<div class="bs-rp-item">{r}</div>{/each}
					</div>
					<div class="bs-rp-col" data-kind="down">
						<div class="bs-rp-h">{@html icons.thumbD} Punishes</div>
						{#each full.punishes as p}<div class="bs-rp-item">{p}</div>{/each}
					</div>
				</div>
			</div>

			<!-- More superlatives -->
			{#if full.superlatives.length > 0}
				<div class="bs-sec">
					<div class="bs-eyebrow">More awards</div>
					{#each full.superlatives as sup}
						<div class={'bs-award ' + bsAcc(sup.accent)} style="margin-bottom:10px;">
							<div class="bs-medal">{@html icons.trophy}</div>
							<div class="bs-award-name">{sup.award}</div>
							<div class="bs-award-blurb">{sup.blurb}</div>
							<div class="bs-award-winner">
								<button class="bs-share-mini" onclick={() => openSupShare(sup.award, sup.blurb, sup.accent)}
									aria-label="Share award">{@html icons.share}</button>
							</div>
						</div>
					{/each}
				</div>
			{/if}

			<!-- Biggest fan / hater -->
			{#if full.biggestFan || full.biggestHater}
				<div class="bs-sec">
					<div class="bs-eyebrow">Fan · Hater</div>
					<div class="bs-fh">
						{#if full.biggestFan}
							{@const fan = full.biggestFan}
							{@const fanMember = readModel.members.find((m) => m.name.toLowerCase() === fan.who.toLowerCase())}
							<div class="bs-fhcard" data-kind="fan">
								<div class="bs-fh-tag">{@html icons.heart} Biggest fan</div>
								<div class="bs-fh-who">
									{#if fanMember}
										<Avatar hue={fanMember.hue} initials={fanMember.initials} size="sm" />
									{/if}
									<div class="bs-fh-whoname">{fan.who}</div>
									<div class="bs-fh-pts">+{fan.pts}</div>
								</div>
								{#if fan.line}<div class="bs-fh-line">{fan.line}</div>{/if}
							</div>
						{/if}
						{#if full.biggestHater}
							{@const hater = full.biggestHater}
							{@const haterMember = readModel.members.find((m) => m.name.toLowerCase() === hater.who.toLowerCase())}
							<div class="bs-fhcard" data-kind="hater">
								<div class="bs-fh-tag">{@html icons.bolt} Friendly hater</div>
								<div class="bs-fh-who">
									{#if haterMember}
										<Avatar hue={haterMember.hue} initials={haterMember.initials} size="sm" />
									{/if}
									<div class="bs-fh-whoname">{hater.who}</div>
									<div class="bs-fh-pts">{hater.pts}</div>
								</div>
								{#if hater.line}<div class="bs-fh-line">{hater.line}</div>{/if}
							</div>
						{/if}
					</div>
				</div>
			{/if}

			<!-- Your people (vote overlap) -->
			{#if full.voteTogether.length > 0 || full.voteTwins.length > 0}
				<div class="bs-sec">
					<div class="bs-eyebrow">Your people</div>
					<div class="bs-people-split">
						{#if full.voteTogether.length > 0}
							<div class="bs-people-group">
								<div class="bs-people-gh">
									<div class="bs-people-gt">Vote Together <span class="bs-tag2">pulp · within league</span></div>
									<div class="bs-people-gnote">Who votes the same way as you, round by round.</div>
								</div>
								{#each full.voteTogether as p}
									<div class="bs-person">
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
							<div class="bs-people-group bs-person-grp2">
								<div class="bs-people-gh">
									<div class="bs-people-gt">Taste Twins <span class="bs-tag2">sky · cross-league</span></div>
									<div class="bs-people-gnote">Who shares your overall taste, across all leagues.</div>
								</div>
								{#each full.voteTwins as p}
									<div class="bs-person">
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
				</div>
			{/if}

			<!-- Discovery playlist -->
			<div class="bs-sec">
				<div class="bs-eyebrow">Discovery playlist</div>
				<div class="bs-playlist">
					<div class="bs-pl-head">
						<div class="bs-pl-kicker">{@html icons.spark} For {member.name}</div>
						<div class="bs-pl-name">{full.playlist.name}</div>
						<div class="bs-pl-nudge">{full.playlist.nudge}</div>
					</div>
					{#each full.playlist.tracks as track, i}
						<div class="bs-pl-track">
							<div class="bs-pl-num">{i + 1}</div>
							<div class="bs-pl-track-body">
								<div class="bs-pl-title">{track.title} <span>· {track.artist}</span></div>
								<div class="bs-pl-why">{track.why}</div>
							</div>
						</div>
					{/each}
				</div>
			</div>
		{/if}

		<!-- Footer -->
		<div class="bs-footer">
			<div class="bs-mark bs-mark--sm">the b/side</div>
			<div class="bs-footer-note">No login required. No rankings. Just music.</div>
		</div>
	</div>
{/if}
