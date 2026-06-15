<script lang="ts">
  import '$lib/content/content.css';
  import UpdateModal from '$lib/content/UpdateModal.svelte';
  import type { PageData } from './$types.js';

  let { data }: { data: PageData } = $props();

  const EMBLEM_COLORS = [
    'oklch(0.52 0.14 25)',
    'oklch(0.52 0.12 305)',
    'oklch(0.52 0.10 215)',
    'oklch(0.52 0.11 150)',
  ];

  function initials(name: string): string {
    return name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase();
  }

  function emblemBg(idx: number): string {
    return EMBLEM_COLORS[idx % EMBLEM_COLORS.length];
  }

  function fmtDate(s: string): string {
    const iso = s.includes('T') ? s : s.replace(' ', 'T') + 'Z';
    const d = new Date(iso);
    return isNaN(d.getTime()) ? s : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  const digestHref = $derived(
    data.latestDigestRoundId ? `/digest/${data.latestDigestRoundId}` : '/digest',
  );

  let leagues = $state(data.leagues);
  let publishing = $state<number | null>(null);
  let publishErr = $state<string | null>(null);
  let updateLeague = $state<(typeof leagues)[number] | null>(null);

  type ReshareData = {
    leagueId: number;
    url: string;
    round: number;
    theme: string;
    league: string;
    headline: string;
    blurb: string;
    cardText: string;
  };
  let published = $state<ReshareData | null>(null);

  async function doPublish(league: (typeof leagues)[number]) {
    publishing = league.id;
    publishErr = null;
    try {
      const r1 = await fetch(`/api/content/${league.id}/publish`, { method: 'POST' });
      if (!r1.ok) throw new Error(await r1.text());

      const r2 = await fetch(`/api/content/${league.id}/reshare`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'card' }),
      });
      if (!r2.ok) throw new Error(await r2.text());
      const rs = await r2.json();

      published = {
        leagueId: league.id,
        url: rs.url,
        round: rs.round ?? 0,
        theme: rs.theme ?? '',
        league: rs.league ?? league.name,
        headline: rs.headline ?? 'NEW IN THE ARCHIVE',
        blurb: rs.blurb ?? '',
        cardText: rs.cardText ?? rs.url,
      };
    } catch (e) {
      publishErr = e instanceof Error ? e.message : 'Publish failed';
    } finally {
      publishing = null;
    }
  }

  async function copyCard() {
    if (!published) return;
    await navigator.clipboard.writeText(published.cardText);
  }

  async function copyLink() {
    if (!published) return;
    await navigator.clipboard.writeText(published.url);
  }

  function sendWhatsApp() {
    if (!published) return;
    window.open(`https://wa.me/?text=${encodeURIComponent(published.cardText)}`, '_blank');
  }

  function openUpdate(lg: (typeof leagues)[number]) {
    updateLeague = lg;
  }

  function handlePublished(reshare: {
    leagueId: number;
    url: string;
    round: number;
    theme: string;
    league: string;
    headline: string;
    blurb: string;
    cardText: string;
  }) {
    published = reshare;
    updateLeague = null;
  }
</script>

<svelte:head>
  <title>Content · music-league-bot</title>
</svelte:head>

<div style="display: flex; flex-direction: column; gap: 24px;">
  <header style="display: flex; flex-direction: column; gap: 6px;">
    <p style="font: 700 10px/1 var(--font-mono); letter-spacing: 0.16em; text-transform: uppercase; color: var(--fg-muted); margin: 0;">
      music-league-bot · /content
    </p>
    <h1 style="margin: 0; font: 700 28px/1.15 var(--font-display); letter-spacing: -0.015em; color: var(--fg);">
      Content
    </h1>
    <p style="margin: 0; font: 500 13px/1.5 var(--font-body); color: var(--fg-muted); max-width: 68ch;">
      Generate this round's digest, and keep each league's shareable b-side archive up to date — one link per league, all season.
    </p>
  </header>

  <div class="ct-tabrow">
    <div class="ct-tabs">
      <a href={digestHref} class="ct-tab">
        <span class="ct-tab-glyph">✉</span>
        Digest
      </a>
      <span class="ct-tab is-on">
        <span class="ct-tab-glyph">≣</span>
        Archive
        {#if data.pendingCount > 0}
          <span class="ct-count">{data.pendingCount}</span>
        {/if}
      </span>
    </div>
    <span class="ct-tabrow-note">
      {data.pendingCount > 0
        ? `${data.pendingCount} league${data.pendingCount === 1 ? '' : 's'} have a new digest ready to archive`
        : 'all leagues up to date'}
    </span>
  </div>

  {#if published}
    <div class="ct-published">
      <div class="ct-published-head">
        <div class="ct-published-check">✓</div>
        <div>
          <div class="ct-published-title">b-side updated · Round {published.round} is live in the archive</div>
          <div class="ct-published-sub">{published.league} · published to {published.url} · same link as always</div>
        </div>
      </div>

      <div class="ct-reshare">
        <div class="ct-reshare-card">
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <span class="ct-reshare-mark">the b/side</span>
            <span class="ct-reshare-kicker">{published.headline}</span>
          </div>
          <div class="ct-reshare-headline">Round {published.round} — "{published.theme}"</div>
          <div class="ct-reshare-blurb">{published.blurb}</div>
          <div class="ct-reshare-url"><span class="lock">🔒</span>{published.url}</div>
        </div>
        <div class="ct-reshare-actions">
          <button class="mash-btn mash-btn--primary" onclick={sendWhatsApp}>↗ Send to WhatsApp</button>
          <button class="mash-btn mash-btn--secondary" onclick={copyCard}>⧉ Copy share card</button>
          <span class="ct-or">or</span>
          <button class="mash-btn mash-btn--ghost" onclick={copyLink}>⧉ Copy link only</button>
        </div>
      </div>
    </div>
  {:else}
    <div class="ct-archive-intro">
      <p class="lede">
        Each league has <b>one b-side site</b> on digest.mattmariani.com — one unguessable link, reused all season.
        When a round's digest finalizes it's <b>ready to add to the archive</b>. Publishing an update refreshes the same link;
        members never need a new one.
      </p>
    </div>

    {#if publishErr}
      <div style="padding: 12px 14px; background: var(--surface); border: 1px solid var(--mash-pulp-edge); border-radius: var(--r-3); font: 500 12px/1.5 var(--font-mono); color: var(--mash-pulp);">
        {publishErr}
      </div>
    {/if}

    <div class="ct-leagues">
      {#each leagues as league, i (league.id)}
        {@const b = league.bside}
        {@const ready = !!b && !!league.pending}
        <div class="ct-league{ready ? ' is-ready' : ''}{!b ? ' is-unpublished' : ''}">
          <div class="ct-league-emblem" style="background: {emblemBg(i)};">{initials(league.name)}</div>

          <div class="ct-league-body">
            <div class="ct-league-top">
              <span class="ct-league-name">{league.name}</span>
              {#if b}
                <span class="ct-league-season">Season {b.season}</span>
              {:else}
                <span class="ct-league-season" style="border-style: dashed;">Not published</span>
              {/if}
            </div>

            {#if b}
              <span class="ct-league-url"><span class="lock">🔒</span>{b.url}</span>
            {:else}
              <span class="ct-league-url" style="color: var(--fg-quiet);">Publishing mints a permanent, unguessable link for the season</span>
            {/if}

            <div class="ct-league-meta">
              {#if b}
                <span>{league.members} members</span>
                <span class="dot"></span>
                <span>{b.archivedCount} rounds archived</span>
                <span class="dot"></span>
                <span>updated {fmtDate(b.lastUpdated)}</span>
              {:else}
                <span>{league.members} members · ready for a first archive</span>
              {/if}
            </div>
          </div>

          <div class="ct-league-actions">
            {#if ready}
              <span class="ct-readypill ct-readypill--ready"><span class="pip"></span>1 update ready</span>
            {:else if b}
              <span class="ct-readypill ct-readypill--current">✓ up to date</span>
            {:else}
              <span class="ct-readypill ct-readypill--idle">not published</span>
            {/if}

            {#if ready && league.pending}
              <div class="ct-pending-line">
                R-{league.pending.roundId} <b>"{league.pending.theme}"</b>
                {#if league.pending.closedAt} finalized {fmtDate(league.pending.closedAt)}{/if}
              </div>
            {/if}

            <div class="ct-league-btns">
              {#if b}
                <a href={b.url} target="_blank" rel="noopener" class="mash-btn mash-btn--ghost mash-btn--sm">↗ View</a>
              {/if}
              {#if ready}
                <button class="mash-btn mash-btn--primary mash-btn--sm" onclick={() => openUpdate(league)}>Update archive →</button>
              {:else if !b}
                <button
                  class="mash-btn mash-btn--primary mash-btn--sm"
                  onclick={() => doPublish(league)}
                  disabled={publishing === league.id}
                >
                  {publishing === league.id ? 'Publishing…' : 'Publish b-side →'}
                </button>
              {:else}
                <button class="mash-btn mash-btn--secondary mash-btn--sm" disabled style="opacity: 0.5;">No new digest</button>
              {/if}
            </div>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

{#if updateLeague}
  <UpdateModal
    league={updateLeague}
    onClose={() => (updateLeague = null)}
    onPublished={handlePublished}
  />
{/if}
