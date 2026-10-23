<script lang="ts">
	// "How It Played": one card per song — a vote bar of voter faces (upvotes
	// right, knives left), the 1.0 consensus note, and that song's vote comments.
	import type { Digest2Ballot } from './ballot.js';
	let { ballot }: { ballot: Digest2Ballot } = $props();

	const SHOW_FIRST = 4;
	let showAll = $state(false);
	const initials = (n: string) => {
		const parts = n.split(/\s+/).filter((p) => /[a-z0-9]/i.test(p[0] ?? ''));
		return (parts.length > 1 ? parts[0][0] + parts[1][0] : (parts[0] ?? '?').slice(0, 2)).toUpperCase();
	};
	// Always show the podium, any song with a note, and the villain; the rest fold.
	const visible = (s: Digest2Ballot['songs'][number]) =>
		showAll || s.rank <= 3 || !!s.note || s.rank === ballot.villainRank;
	const hiddenCount = $derived(ballot.songs.filter((s) => !(s.rank <= 3 || s.note || s.rank === ballot.villainRank)).length);
	const medal = (r: number) => (r === 1 ? 'gold' : r === 2 ? 'silver' : r === 3 ? 'bronze' : '');
</script>

{#snippet face(name: string, avatar: string | null, pts: number)}
	<span class="face" class:dn={pts < 0} title="{name} {pts > 0 ? '+' : ''}{pts}">
		{#if avatar}<span class="av {avatar}" role="img" aria-label={name}></span>{:else}<span class="init">{initials(name)}</span>{/if}
		{#if pts > 1}<b>{pts}</b>{/if}
	</span>
{/snippet}

<!-- Face images: defined once here, used by these cards and the Ballot Grid. -->
{@html `<style>.av{background:#2a3340 center/cover no-repeat}${ballot.avatarCss}</style>`}

<section class="ballot">
	<h2>How It Played</h2>
	{#if ballot.lede}<p class="lede">{ballot.lede}</p>{/if}

	{#each ballot.songs as s (s.rank)}
		{#if visible(s)}
			{@const villain = s.rank === ballot.villainRank}
			<article class="card {medal(s.rank)}" class:villain>
				<header>
					<span class="rank">#{s.rank}</span>
					<div class="t">
						<h3>{s.title}</h3>
						<p>{s.artist} · <i>{s.submitter}</i></p>
					</div>
					<div class="netwrap">
						<span class="net" class:neg={s.net < 0}>{s.net > 0 ? '+' : ''}{s.net}</span>
						{#if s.forfeited}
							<span class="forfeit-note"><s>{s.rawNet > 0 ? '+' : ''}{s.rawNet}</s> forfeited (didn't vote)</span>
						{/if}
					</div>
				</header>
				<div class="bar">
					<div class="knives">
						{#each s.votes.filter((v) => v.pts < 0) as v (v.voter)}{@render face(v.voter, v.avatar, v.pts)}{/each}
					</div>
					<div class="axis"></div>
					<div class="ups" class:forfeit={s.forfeited}>
						{#each s.votes.filter((v) => v.pts > 0) as v (v.voter)}{@render face(v.voter, v.avatar, v.pts)}{/each}
					</div>
				</div>
				<p class="tally">
					{s.ups} paid · {s.downs} knifed{#if s.forfeited} · {s.rawUps} upvotes forfeited{/if}{#if villain} · <a href="#villain">see The Villain ↓</a>{/if}
				</p>
				{#if villain}
					<!-- The Villain section tells this one; no repeat here. -->
				{:else}
					{#if s.note}<p class="note">{s.note}</p>{/if}
					{@const said = s.votes.filter((v) => v.comment)}
					{#if said.length}
						<div class="qs">
							{#each said as v (v.voter)}
								<figure class="q" class:zero={v.pts === 0}>
									<span class="qface">
										{#if v.avatar}<span class="av {v.avatar}"></span>{:else}<span class="init">{initials(v.voter)}</span>{/if}
									</span>
									<div>
										<blockquote>{v.comment}</blockquote>
										<figcaption>
											{v.voter}
											<span class="pts" class:up={v.pts > 0} class:dn={v.pts < 0}>{v.pts > 0 ? '+' : ''}{v.pts}</span>
										</figcaption>
									</div>
								</figure>
							{/each}
						</div>
					{/if}
				{/if}
			</article>
		{/if}
	{/each}

	{#if !showAll && hiddenCount > 0}
		<button class="more" onclick={() => (showAll = true)}>Show the other {hiddenCount} songs</button>
	{/if}
	{#if ballot.closer}<p class="closer">{ballot.closer}</p>{/if}
</section>

<style>
	.ballot { margin: 2rem 0; }
	.lede { font-size: 1.05rem; }
	.closer { margin-top: 1rem; color: var(--fg-muted, #9aa4b1); }
	.card { background: var(--surface, #11151b); border: 1px solid var(--line, #262d37); border-radius: 14px; padding: 14px; margin: 12px 0; }
	.card.gold { border-color: #e8b04a77; }
	.card.villain { border-color: #e5534b99; background: linear-gradient(180deg, #e5534b17, transparent 60%), var(--surface, #11151b); }
	header { display: flex; gap: 10px; align-items: center; }
	.rank { font: 600 13px var(--font-mono, monospace); color: var(--fg-muted, #8b96a5); min-width: 28px; }
	.gold .rank { color: #e8b04a; } .silver .rank { color: #c9d1db; } .bronze .rank { color: #d08b5b; }
	.t { flex: 1; min-width: 0; }
	.t h3 { margin: 0; font: 600 1.1rem/1.2 var(--font-display, system-ui); }
	.t p { margin: 2px 0 0; color: var(--fg-muted, #8b96a5); font-size: .85rem; }
	.netwrap { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
	.net { font: 800 1.6rem var(--font-display, system-ui); color: #7cc47a; }
	.net.neg { color: #e5534b; }
	.forfeit-note { font: .68rem/1.2 var(--font-mono, monospace); color: #8b96a5; max-width: 11rem; text-align: right; }
	.forfeit-note s { color: #9aa4b1; }
	.ups.forfeit .face { border-color: #6b7380; filter: grayscale(1); opacity: .55; }
	.bar { display: grid; grid-template-columns: 1fr 2px 2.2fr; gap: 6px; align-items: center; margin: 12px 0 2px; }
	.knives { display: flex; justify-content: flex-end; gap: 4px; flex-wrap: wrap; }
	.ups { display: flex; gap: 4px; flex-wrap: wrap; }
	.axis { height: 34px; background: var(--line, #262d37); }
	.face { position: relative; width: 32px; height: 32px; border-radius: 50%; border: 2px solid #7cc47a; overflow: visible; flex: none; }
	.face.dn { border-color: #e5534b; }
	.face.dn .av { filter: grayscale(.5); }
	.face .av, .face .init { width: 100%; height: 100%; border-radius: 50%; display: block; object-fit: cover; }
	.init { display: flex !important; align-items: center; justify-content: center; background: #2a3340; color: #cfd6df; font: 700 10px var(--font-mono, monospace); border-radius: 6px !important; }
	.face b { position: absolute; right: -5px; bottom: -5px; min-width: 16px; height: 16px; border-radius: 8px; background: #2f7d3a; color: #fff; font: 800 10px/16px var(--font-mono, monospace); text-align: center; }
	.tally { margin: 4px 0 0; font: .78rem var(--font-mono, monospace); color: var(--fg-muted, #8b96a5); }
	.tally a { color: #ff8a83; }
	.note { margin: 10px 0 0; }
	.qs { display: grid; gap: 8px; margin-top: 10px; }
	.q { margin: 0; display: flex; gap: 10px; padding: 9px 11px; background: #ffffff08; border-radius: 10px; }
	.q.zero { background: transparent; border: 1px dashed var(--line, #262d37); }
	.qface { width: 26px; height: 26px; flex: none; }
	.qface .av, .qface .init { width: 26px; height: 26px; border-radius: 50%; display: block; object-fit: cover; }
	.q blockquote { margin: 0; font-size: .92rem; overflow-wrap: anywhere; }
	.q figcaption { margin-top: 3px; font: .75rem var(--font-mono, monospace); color: var(--fg-muted, #8b96a5); }
	.pts.up { color: #7cc47a; } .pts.dn { color: #e5534b; }
	.more { margin: 4px 0; padding: 8px 14px; border: 1px solid var(--line, #262d37); border-radius: 999px; background: none; color: inherit; cursor: pointer; font: inherit; }
	@media (max-width: 520px) { .bar { grid-template-columns: 1fr 2px 1.7fr; } .face { width: 28px; height: 28px; } }
</style>
