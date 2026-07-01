<script lang="ts">
	import Avatar from '../lib/atoms/Avatar.svelte';
	import { icons } from '../lib/icons.js';
	import { bsAcc, accentIcon } from '../lib/accents.js';
	import type { ReadModel, Nav, SharePayload, FullMember } from '../lib/types.js';
	import TasteWaveform from '../lib/taste-waveform/TasteWaveform.svelte';
	import { tasteEngine, scopedLeague } from '../lib/taste-waveform/taste-waveform.js';
	import { tasteSettings } from '../lib/tasteSettings.svelte.js';
	import TasteSettings from '../lib/atoms/TasteSettings.svelte';

	interface Props { readModel: ReadModel; memberId: string; nav: Nav; }
	let { readModel, memberId, nav }: Props = $props();

	const member = $derived(readModel.members.find((m) => m.id === memberId));
	const isFull = $derived(member?.tier === 'full');

	// Build the (scope-filtered) league engine, then find this member's player index.
	const lg = $derived(readModel.taste ? scopedLeague(readModel.taste, tasteSettings, readModel.league.id) : null);
	const eng = $derived(lg ? tasteEngine(lg, tasteSettings) : null);
	const pi = $derived(lg && member ? lg.players.findIndex((p) => p.name === member.name) : -1);
	const waveSub = $derived(
		tasteSettings.scopeAll ? 'your taste, across all your leagues' : `your taste, in ${readModel.league.name}`,
	);

	let settingsOpen = $state(false);

	function openWaveShare() {
		if (!member || !eng || pi < 0) return;
		nav.openShare({
			award: '', blurb: '',
			who: member.name, hue: member.hue, initials: member.initials,
			accent: 'pulp',
			kind: 'signature',
			engine: eng,
			pi,
			league: readModel.league.name,
		});
	}

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

		<!-- Sonic Signature — the taste waveform (supersedes the old AI fingerprint) -->
		{#if eng && pi >= 0}
			<section class="bs-sec">
				<TasteWaveform variant="hero" engine={eng} {pi} name={member.name} sub={waveSub} />
				<div style="display:flex; gap:8px; align-items:center; margin-top:10px;">
					<button class="bs-share-btn" onclick={openWaveShare}>
						{@html icons.share} Share your signature
					</button>
					<button class="bs-icon-btn" onclick={() => (settingsOpen = true)} aria-label="Signature settings" title="Signature settings">⚙</button>
				</div>
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

	<TasteSettings open={settingsOpen} onClose={() => (settingsOpen = false)} />
{/if}
