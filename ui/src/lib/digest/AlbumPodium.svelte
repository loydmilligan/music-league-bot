<script lang="ts" module>
  // ── album-podium · sprint-14 (viz) ───────────────────────────────────────
  // Visual form of the digest's TOP section (`podium` kind). Renders the top
  // songs' album covers in a medal podium (1/2/3) + a slim grid for the rest,
  // with rank + points badges, so the section's prose collapses to short
  // captions instead of a long ranked list.
  //
  // Implements the frontend VARIANT SLOT INTERFACE (`VisualComponentProps` in
  // variants.ts). Frontend registers this for kind 'podium' in the page's
  // VISUAL_COMPONENTS map; it is mounted as:
  //   <AlbumPodium {kind} {content} data={visualData} variant={'visual'|'both'} />
  // In 'both' the textual caption is rendered BELOW us by DigestSection, so we
  // render only the art — no own prose.
  //
  // We read the ranked rows from `content.items` (the same object the textual
  // form reads). `coverUrl` is optional per item — when absent (no Spotify art
  // resolved) the tile falls back to a vinyl glyph so the podium still reads.
  export type PodiumSong = {
    rank?: number;
    position?: number;
    title?: string;
    artist?: string;
    submitter?: string;
    points?: number;
    vote_total?: number;
    maxPoints?: number;
    // album art — accepted under several keys depending on how backend enriches
    coverUrl?: string | null;
    albumArtUrl?: string | null;
    album_art_url?: string | null;
    // Optional detail-card payload (season-recap podiums). When either is
    // present the entry becomes clickable and opens the full card instead of a
    // bare artwork lightbox; absent → the podium behaves exactly as before.
    fact?: string;
    song?: { title?: string; artist?: string; art?: string | null; url?: string };
  };
</script>

<script lang="ts">
  import { page } from '$app/state';
  // Static, NOT a dynamic import: the html-share exporter only captures assets
  // the headless browser actually fetches, so a lazily-imported chunk never
  // lands in the published artifact and 404s when someone taps Share.
  import { toPng } from 'html-to-image';
  import type { VisualComponentProps } from './variants.js';
  import { coverOpAt } from './coverOps.js';

  let { content }: VisualComponentProps = $props();

  type Content = { items?: unknown[] };
  const rawItems = $derived(
    Array.isArray((content as Content)?.items) ? ((content as Content).items as PodiumSong[]) : [],
  );

  const rankOf = (s: PodiumSong, i: number) => s.rank ?? s.position ?? i + 1;
  const ptsOf = (s: PodiumSong) => s.vote_total ?? s.points;
  const coverOf = (s: PodiumSong) => s.coverUrl ?? s.albumArtUrl ?? s.album_art_url ?? null;

  // Defensive sort by rank, then split into the medal podium (top 3) + the rest.
  const sorted = $derived(
    rawItems
      // _i = stable unique id for {#each} keys. Ranks can TIE (duplicate _rank),
      // so keying eaches by _rank throws each_key_duplicate (fatal hydration
      // error). Keep _i unique per item. (sprint-15 chat-wire hotfix — see log.)
      .map((s, i) => ({ ...s, _rank: rankOf(s, i), _cover: coverOf(s), _i: i }))
      .sort((a, b) => a._rank - b._rank),
  );
  const podium = $derived(sorted.slice(0, 3));
  const rest = $derived(sorted.slice(3));

  // Visual order on the shelf: silver (2) · gold (1) · bronze (3), gold tallest.
  const shelf = $derived([podium[1], podium[0], podium[2]].filter(Boolean));

  const medalClass = (rank: number) =>
    rank === 1 ? 'is-gold' : rank === 2 ? 'is-silver' : rank === 3 ? 'is-bronze' : '';
  const medalWord = (rank: number) =>
    rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : `#${rank}`;
  const initial = (s: PodiumSong) => (s.title?.trim()?.[0] ?? '♪').toUpperCase();

  // Static export (PNG/PDF) can't open a dialog, and hover doesn't exist there —
  // detected the same way ChatMoments does it, from the URL the export path sets.
  const isExport = $derived(page?.url?.searchParams?.get('export') === '1');

  // Cover Factory operator notes + project links (content._coverNotes/_coverProjects, written by
  // the auto run). App only: never in an export render or a share render (page.data.share), and
  // tagged data-export-hide="1" so every export/share pipeline drops them as well.
  const operator = $derived(!isExport && !(page?.data as { share?: boolean } | undefined)?.share);
  // By the item's index in content.items (_i): the server keys by rank|place|position, which can
  // differ from the display rank above (place is not read there).
  const opOf = (s: { _i: number }) => (operator ? coverOpAt(content, s._i) : null);

  // Detail card. Any entry carrying a `fact` or `song` opens the full card;
  // otherwise it degrades to a plain artwork lightbox. null = closed.
  let zoom = $state<PodiumSong | null>(null);
  const openable = (s: PodiumSong) => !!(s.fact || s.song || s.coverUrl);

  const safeName = (s: PodiumSong) =>
    (s.title ?? 'card').trim().toLowerCase().replace(/[^\w]+/g, '-').replace(/^-|-$/g, '') || 'card';

  // The detail card node, rasterized for share/save. Same approach as
  // bside/src/lib/shareImage.ts (Read The Room): render the CARD, not just its
  // artwork, so what lands in the chat carries the name, the fact and the song.
  let cardEl = $state<HTMLElement | undefined>(undefined);

  // Nodes tagged data-noshot are dropped from the capture (the close button and
  // the action row itself — chrome that shouldn't appear in a shared image).
  const shotFilter = (n: HTMLElement) =>
    !(n instanceof HTMLElement) || n.dataset?.noshot !== '1';

  async function renderCardPng(s: PodiumSong): Promise<{ dataUrl: string; file: File } | null> {
    if (!cardEl) return null;
    const dataUrl = await toPng(cardEl, {
      pixelRatio: 2,
      cacheBust: true,
      backgroundColor: '#0d1116',
      height: cardEl.scrollHeight,
      filter: shotFilter,
    });
    const blob = await (await fetch(dataUrl)).blob();
    return { dataUrl, file: new File([blob], `${safeName(s)}.png`, { type: 'image/png' }) };
  }

  // Share the rendered card. Native file-share where supported (mobile: the OS
  // sheet, straight into WhatsApp), then URL share, then clipboard. Every step
  // is best-effort — a refusal or a tainted canvas must never throw.
  let shareState = $state<'idle' | 'busy' | 'copied' | 'error'>('idle');
  async function shareCard(s: PodiumSong) {
    if (shareState === 'busy') return;
    const nav = navigator as Navigator & {
      canShare?: (d: { files?: File[]; url?: string }) => boolean;
      share?: (d: { files?: File[]; title?: string; text?: string; url?: string }) => Promise<void>;
    };
    shareState = 'busy';
    try {
      const shot = await renderCardPng(s);
      if (shot && nav.canShare?.({ files: [shot.file] })) {
        await nav.share({ files: [shot.file], title: s.title ?? '' });
        shareState = 'idle';
        return;
      }
      if (shot && !nav.share) {
        // Desktop without the Share API: hand them the PNG instead.
        const a = document.createElement('a');
        a.href = shot.dataUrl;
        a.download = shot.file.name;
        a.click();
        shareState = 'idle';
        return;
      }
    } catch {
      /* render failed (tainted canvas / cross-origin) — fall through */
    }
    try {
      if (nav.share) {
        await nav.share({ title: s.title ?? '', url: location.href });
      } else {
        await navigator.clipboard.writeText(location.href);
        shareState = 'copied';
        setTimeout(() => (shareState = 'idle'), 1600);
        return;
      }
    } catch {
      /* user dismissed the sheet */
    }
    shareState = 'idle';
  }

  // Save the rendered card as a PNG.
  let saveState = $state<'idle' | 'busy'>('idle');
  async function saveCard(s: PodiumSong) {
    if (saveState === 'busy') return;
    saveState = 'busy';
    try {
      const shot = await renderCardPng(s);
      if (shot) {
        const a = document.createElement('a');
        a.href = shot.dataUrl;
        a.download = shot.file.name;
        a.click();
      }
    } catch {
      /* fall back to the raw artwork below */
      const url = coverOf(s);
      if (url) window.open(url, '_blank', 'noopener');
    }
    saveState = 'idle';
  }
</script>

{#snippet coverOp(s: { _i: number })}
  {@const op = opOf(s)}
  {#if op?.note}
    <p class="apod-cf-note" data-export-hide="1">{op.note}</p>
  {/if}
  {#if op?.projectId}
    <a class="apod-cf-link" data-export-hide="1" href={`/cover-factory?project=${op.projectId}`}>Open in Cover Factory ↗</a>
  {/if}
{/snippet}

<div class="apod" data-component="album-podium">
  {#if shelf.length}
    <div class="apod-shelf" class:is-two={shelf.length === 2} class:is-one={shelf.length === 1}>
      {#each shelf as s (s._i)}
        {@const rank = s._rank}
        {@const pts = ptsOf(s)}
        <article class="apod-card {medalClass(rank)}">
          <span class="apod-medal">{medalWord(rank)}</span>
          <svelte:element
            this={openable(s) && !isExport ? 'button' : 'div'}
            class="apod-art"
            class:is-openable={openable(s) && !isExport}
            type={openable(s) && !isExport ? 'button' : undefined}
            aria-label={openable(s) && !isExport
              ? `Open details for ${s.title ?? 'this entry'}`
              : undefined}
            onclick={openable(s) && !isExport ? () => (zoom = s) : undefined}
          >
            {#if s._cover}
              <img src={s._cover} alt={`${s.title ?? ''} cover`} loading="lazy" />
            {:else}
              <span class="apod-art-fallback" aria-hidden="true">{initial(s)}</span>
            {/if}
            <span class="apod-rank-badge">{rank}</span>
          </svelte:element>
          <div class="apod-cap">
            <span class="apod-title" title={s.title ?? ''}>{s.title ?? ''}</span>
            <span class="apod-artist" title={s.artist ?? ''}>{s.artist ?? ''}</span>
          </div>
          <div class="apod-meta">
            {#if s.submitter}
              <span class="apod-sub">{s.submitter}</span>
            {/if}
            {#if pts !== undefined}
              <span class="apod-pts"
                >{pts}{#if s.maxPoints}<span class="apod-pts-max">/{s.maxPoints}</span>{/if}<span
                  class="apod-pts-unit">pt</span
                ></span
              >
            {/if}
          </div>
          {@render coverOp(s)}
        </article>
      {/each}
    </div>
  {/if}

  {#if rest.length}
    <ol class="apod-rest">
      {#each rest as s (s._i)}
        {@const pts = ptsOf(s)}
        <li class="apod-row">
          <span class="apod-row-rank">{String(s._rank).padStart(2, '0')}</span>
          {#if openable(s) && !isExport}
            <!-- click-to-open: the row thumb is small by design, so the entry
                 gets a detail card (artwork + fact + signature song). Suppressed
                 in export (a PNG can't open a dialog) — see isExport. -->
            <button
              type="button"
              class="apod-row-art is-zoomable"
              aria-label={`Open details for ${s.title ?? 'this entry'}`}
              onclick={() => (zoom = s)}
            >
              {#if s._cover}
                <img src={s._cover} alt="" loading="lazy" />
              {:else}
                <span class="apod-art-fallback sm" aria-hidden="true">{initial(s)}</span>
              {/if}
            </button>
          {:else}
            <div class="apod-row-art">
              {#if s._cover}
                <img src={s._cover} alt="" loading="lazy" />
              {:else}
                <span class="apod-art-fallback sm" aria-hidden="true">{initial(s)}</span>
              {/if}
            </div>
          {/if}
          <div class="apod-row-cap">
            <span class="apod-row-title" title={s.title ?? ''}>{s.title ?? ''}</span>
            <span class="apod-row-artist" title={s.artist ?? ''}>{s.artist ?? ''}</span>
          </div>
          {#if s.submitter}
            <span class="apod-row-sub">{s.submitter}</span>
          {/if}
          {#if pts !== undefined}
            <span class="apod-row-pts">{pts}<span class="apod-pts-unit">pt</span></span>
          {/if}
          {@render coverOp(s)}
        </li>
      {/each}
    </ol>
  {/if}

  {#if !shelf.length && !rest.length}
    <p class="apod-empty">(no ranked songs)</p>
  {/if}
</div>

<svelte:window onkeydown={(e) => zoom && e.key === 'Escape' && (zoom = null)} />

{#if zoom}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="apod-lightbox"
    role="dialog"
    aria-modal="true"
    aria-label={zoom.title ? `Details: ${zoom.title}` : 'Details'}
    tabindex="-1"
    onclick={() => (zoom = null)}
  >
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="apod-detail" bind:this={cardEl} onclick={(e) => e.stopPropagation()}>
      <button class="apod-detail-x" data-noshot="1" type="button" aria-label="Close" onclick={() => (zoom = null)}
        >✕</button
      >
      {#if coverOf(zoom)}
        <img class="apod-detail-art" src={coverOf(zoom)} alt={`${zoom.title ?? ''} artwork`} />
      {/if}
      <div class="apod-detail-body">
        <p class="apod-detail-eyebrow">
          {#if zoom.rank ?? zoom.position}#{zoom.rank ?? zoom.position} ·{/if}
          {ptsOf(zoom)}<span class="apod-pts-unit">pt</span>
        </p>
        <h3 class="apod-detail-title">{zoom.title ?? ''}</h3>
        {#if zoom.artist}<p class="apod-detail-sub">{zoom.artist}</p>{/if}
        {#if zoom.fact}<p class="apod-detail-fact">{zoom.fact}</p>{/if}
        {#if zoom.song}
          <a
            class="apod-detail-song"
            href={zoom.song.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {#if zoom.song.art}<img src={zoom.song.art} alt="" loading="lazy" />{/if}
            <span class="apod-detail-song-cap">
              <span class="apod-detail-song-label">signature song</span>
              <span class="apod-detail-song-title">{zoom.song.title}</span>
              <span class="apod-detail-song-artist">{zoom.song.artist}</span>
            </span>
            <span class="apod-detail-song-go" aria-hidden="true">↗</span>
          </a>
        {/if}
        {#if coverOf(zoom)}
          <div class="apod-detail-acts" data-noshot="1">
            <button type="button" class="apod-act" onclick={() => shareCard(zoom!)}>
              {shareState === 'busy' ? '…' : shareState === 'copied' ? '✓ link copied' : '↗ Share card'}
            </button>
            <button type="button" class="apod-act" onclick={() => saveCard(zoom!)}>
              {saveState === 'busy' ? '…' : '⤓ Save card'}
            </button>
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .apod {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  /* ── medal shelf (top 3) ─────────────────────────────────────────────── */
  .apod-shelf {
    display: grid;
    grid-template-columns: 1fr 1.5fr 1fr;
    gap: 12px;
    align-items: end;
  }
  .apod-shelf.is-two {
    grid-template-columns: 1fr 1.5fr;
  }
  .apod-shelf.is-one {
    grid-template-columns: minmax(0, 1.5fr);
    justify-content: center;
  }

  .apod-card {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--r-3);
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }
  .apod-card.is-gold {
    border-color: var(--amber);
    box-shadow: 0 0 0 3px rgba(232, 168, 58, 0.1);
  }
  .apod-card.is-silver {
    border-color: var(--line-strong);
  }
  .apod-card.is-bronze {
    border-color: #c08758;
  }

  .apod-medal {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font: 700 9px/1 var(--font-mono);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--fg-muted);
  }
  .apod-medal::before {
    content: '';
    width: 12px;
    height: 12px;
    border-radius: 999px;
    background: currentColor;
    box-shadow:
      inset 0 -2px 0 rgba(0, 0, 0, 0.25),
      0 0 0 2px var(--surface),
      0 0 0 3px currentColor;
  }
  .is-gold .apod-medal {
    color: var(--amber);
  }
  .is-silver .apod-medal {
    color: var(--fg-2);
  }
  .is-bronze .apod-medal {
    color: #c08758;
  }

  .apod-art {
    position: relative;
    width: 100%;
    aspect-ratio: 1 / 1;
    border-radius: var(--r-2);
    overflow: hidden;
    background: var(--ink-2);
    border: 1px solid var(--line);
  }
  .apod-art img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .apod-art-fallback {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    font: 700 48px/1 var(--font-mono);
    color: rgba(255, 255, 255, 0.16);
  }
  .apod-art-fallback.sm {
    font-size: 18px;
  }
  .is-gold .apod-art-fallback {
    font-size: 64px;
  }
  .apod-rank-badge {
    position: absolute;
    top: 6px;
    left: 6px;
    min-width: 20px;
    height: 20px;
    padding: 0 5px;
    border-radius: var(--r-2);
    background: rgba(7, 9, 12, 0.78);
    backdrop-filter: blur(2px);
    color: var(--bone);
    font: 700 11px/20px var(--font-mono);
    text-align: center;
  }
  .is-gold .apod-rank-badge {
    background: var(--amber);
    color: var(--ink-0);
  }

  .apod-cap {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .apod-title {
    font: 700 14px/1.2 var(--font-body);
    color: var(--fg);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .is-gold .apod-title {
    font-size: 16px;
  }
  .apod-artist {
    font: 500 11px/1.2 var(--font-mono);
    color: var(--fg-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* Cover Factory operator note + link (app only, data-export-hide). */
  .apod-cf-note {
    grid-column: 1 / -1;
    margin: 0;
    padding: 4px 6px;
    border: 1px solid color-mix(in srgb, var(--amber) 40%, transparent);
    border-radius: var(--r-2, 4px);
    background: color-mix(in srgb, var(--amber) 10%, transparent);
    color: var(--amber);
    font: 500 10.5px/1.35 var(--font-mono);
    overflow-wrap: anywhere;
  }
  .apod-cf-link {
    grid-column: 1 / -1;
    justify-self: start;
    font: 600 10px/1.2 var(--font-mono);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--amber);
    text-decoration: none;
  }
  .apod-cf-link:hover {
    text-decoration: underline;
  }
  .apod-meta {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    margin-top: auto;
    padding-top: 8px;
    border-top: 1px dashed var(--line);
  }
  .apod-sub {
    font: 500 10.5px/1.2 var(--font-mono);
    color: var(--fg-quiet);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .apod-pts {
    font: 700 18px/1 var(--font-mono);
    color: var(--mash-pulp);
    letter-spacing: -0.02em;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .is-gold .apod-pts {
    font-size: 22px;
  }
  .apod-pts-max {
    font-size: 10px;
    color: var(--fg-quiet);
    font-weight: 500;
  }
  .apod-pts-unit {
    font-size: 9px;
    color: var(--fg-quiet);
    font-weight: 500;
    margin-left: 2px;
  }

  /* ── slim list (rank 4+) ─────────────────────────────────────────────── */
  .apod-rest {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }
  .apod-row {
    display: grid;
    grid-template-columns: auto 64px 1fr auto auto;
    align-items: center;
    gap: 10px;
    padding: 8px 2px;
    border-bottom: 1px solid var(--line);
  }
  .apod-row:last-child {
    border-bottom: 0;
  }
  .apod-row-rank {
    font: 700 13px/1 var(--font-mono);
    color: var(--fg-quiet);
    font-variant-numeric: tabular-nums;
  }
  .apod-row-art.is-zoomable {
    padding: 0;
    border: 1px solid var(--line);
    cursor: zoom-in;
    transition:
      transform 120ms ease,
      box-shadow 120ms ease,
      border-color 120ms ease;
  }
  .apod-row-art.is-zoomable:hover,
  .apod-row-art.is-zoomable:focus-visible {
    transform: scale(1.6);
    border-color: var(--line-strong, var(--ink-5));
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.55);
    position: relative;
    z-index: 3;
  }
  @media (prefers-reduced-motion: reduce) {
    .apod-row-art.is-zoomable {
      transition: none;
    }
  }
  .apod-lightbox {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: grid;
    place-items: center;
    gap: 10px;
    grid-auto-flow: row;
    align-content: center;
    padding: 24px;
    background: rgba(7, 9, 12, 0.88);
    backdrop-filter: blur(2px);
    cursor: zoom-out;
  }
  .apod-detail {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 260px) minmax(0, 1fr);
    gap: 20px;
    align-items: start;
    width: min(720px, 92vw);
    max-height: 86vh;
    overflow-y: auto;
    padding: 20px;
    background: var(--ink-1);
    border: 1px solid var(--line);
    border-radius: var(--r-3, 12px);
    box-shadow: 0 28px 72px rgba(0, 0, 0, 0.6);
    cursor: default;
    text-align: left;
  }
  @media (max-width: 560px) {
    .apod-detail {
      grid-template-columns: minmax(0, 1fr);
      gap: 14px;
      padding: 16px;
    }
  }
  .apod-detail-x {
    position: absolute;
    top: 8px;
    right: 8px;
    width: 30px;
    height: 30px;
    display: grid;
    place-items: center;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: rgba(7, 9, 12, 0.7);
    color: var(--fg-muted);
    font-size: 13px;
    cursor: pointer;
  }
  .apod-detail-x:hover {
    color: var(--fg);
  }
  .apod-detail-art {
    width: 100%;
    aspect-ratio: 1 / 1;
    object-fit: cover;
    border-radius: var(--r-2);
    border: 1px solid var(--line);
    display: block;
  }
  .apod-detail-body {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .apod-detail-eyebrow {
    margin: 0;
    font: 700 11px/1 var(--font-mono);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--fg-quiet);
  }
  .apod-detail-title {
    margin: 0;
    font: 700 24px/1.15 var(--font-body);
    color: var(--fg-bright, var(--ink-9));
  }
  .apod-detail-sub {
    margin: 0;
    font: 600 13px/1.35 var(--font-mono);
    color: var(--mash-pulp);
  }
  .apod-detail-fact {
    margin: 6px 0 0;
    font: 400 14px/1.55 var(--font-body);
    color: var(--fg, var(--ink-8));
  }
  .apod-detail-song {
    margin-top: 6px;
    display: grid;
    grid-template-columns: 48px minmax(0, 1fr) auto;
    gap: 12px;
    align-items: center;
    padding: 10px;
    border: 1px solid var(--line);
    border-radius: var(--r-2);
    background: var(--ink-2);
    text-decoration: none;
    color: inherit;
  }
  .apod-detail-song:hover {
    border-color: var(--mash-pulp);
  }
  .apod-detail-song img {
    width: 48px;
    height: 48px;
    border-radius: var(--r-1);
    object-fit: cover;
    display: block;
  }
  .apod-detail-song-cap {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }
  .apod-detail-song-label {
    font: 700 9.5px/1 var(--font-mono);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--fg-quiet);
  }
  .apod-detail-song-title {
    font: 600 13px/1.25 var(--font-body);
    color: var(--fg-bright, var(--ink-9));
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .apod-detail-song-artist {
    font: 400 12px/1.25 var(--font-body);
    color: var(--fg-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .apod-detail-song-go {
    color: var(--fg-quiet);
    font-size: 14px;
  }
  .apod-detail-acts {
    display: flex;
    gap: 8px;
    margin-top: 10px;
    flex-wrap: wrap;
  }
  .apod-act {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 7px 12px;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: var(--ink-2);
    color: var(--fg, var(--ink-8));
    font: 600 12px/1 var(--font-mono);
    text-decoration: none;
    cursor: pointer;
    white-space: nowrap;
  }
  .apod-act:hover {
    border-color: var(--mash-pulp);
    color: var(--fg-bright, var(--ink-9));
  }
  .apod-art.is-openable {
    padding: 0;
    border: 0;
    background: none;
    cursor: pointer;
    display: block;
    width: 100%;
  }
  .apod-row-art {
    width: 64px;
    height: 64px;
    border-radius: var(--r-1);
    overflow: hidden;
    background: var(--ink-2);
    border: 1px solid var(--line);
    position: relative;
  }
  .apod-row-art img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .apod-row-cap {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }
  .apod-row-title {
    font: 600 12.5px/1.25 var(--font-body);
    color: var(--fg);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .apod-row-artist {
    font: 500 10.5px/1.2 var(--font-mono);
    color: var(--fg-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .apod-row-sub {
    font: 500 10px/1.2 var(--font-mono);
    color: var(--fg-quiet);
    text-align: right;
    white-space: nowrap;
  }
  .apod-row-pts {
    font: 700 13px/1 var(--font-mono);
    color: var(--fg-2);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .apod-empty {
    margin: 0;
    font: 400 13px/1.5 var(--font-body);
    color: var(--fg-quiet);
    font-style: italic;
  }

  /* ── narrow / mobile-export reflow ───────────────────────────────────── */

  /* html-share on phone (≤640px): stack the medal shelf vertically.
     Gold first (it's center in the visual order array but rank 1), then
     silver and bronze side-by-side. Achieves legible full-width art tiles. */
  @media (max-width: 640px) {
    .apod-shelf {
      grid-template-columns: 1fr;
    }
    .apod-shelf.is-two {
      grid-template-columns: 1fr;
    }
    /* Reorder: gold (2nd in DOM = rank 1) floats to top */
    .apod-card.is-gold {
      order: -1;
    }
    .apod-card.is-silver,
    .apod-card.is-bronze {
      /* side-by-side row below gold */
    }
    /* Put silver and bronze in a 2-col sub-row by switching the shelf
       back to a 2-col grid once we know gold is first */
    .apod-shelf:not(.is-one) {
      grid-template-columns: 1fr 1fr;
    }
    .apod-card.is-gold {
      grid-column: 1 / -1;
    }
    .apod-pts {
      font-size: 16px;
    }
    .is-gold .apod-pts {
      font-size: 20px;
    }
  }

  @media (max-width: 460px) {
    .apod-shelf {
      gap: 8px;
    }
    .apod-card {
      padding: 9px;
    }
    .apod-title {
      font-size: 12.5px;
    }
    .is-gold .apod-title {
      font-size: 13.5px;
    }
    .apod-row {
      grid-template-columns: auto 52px 1fr auto;
      gap: 8px;
    }
    .apod-row-art {
      width: 52px;
      height: 52px;
    }
    .apod-row-sub {
      display: none;
    }
  }
</style>
