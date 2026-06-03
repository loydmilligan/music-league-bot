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
  };
</script>

<script lang="ts">
  import type { VisualComponentProps } from './variants.js';

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
</script>

<div class="apod" data-component="album-podium">
  {#if shelf.length}
    <div class="apod-shelf" class:is-two={shelf.length === 2} class:is-one={shelf.length === 1}>
      {#each shelf as s (s._i)}
        {@const rank = s._rank}
        {@const pts = ptsOf(s)}
        <article class="apod-card {medalClass(rank)}">
          <span class="apod-medal">{medalWord(rank)}</span>
          <div class="apod-art">
            {#if s._cover}
              <img src={s._cover} alt={`${s.title ?? ''} cover`} loading="lazy" />
            {:else}
              <span class="apod-art-fallback" aria-hidden="true">{initial(s)}</span>
            {/if}
            <span class="apod-rank-badge">{rank}</span>
          </div>
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
          <div class="apod-row-art">
            {#if s._cover}
              <img src={s._cover} alt="" loading="lazy" />
            {:else}
              <span class="apod-art-fallback sm" aria-hidden="true">{initial(s)}</span>
            {/if}
          </div>
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
        </li>
      {/each}
    </ol>
  {/if}

  {#if !shelf.length && !rest.length}
    <p class="apod-empty">(no ranked songs)</p>
  {/if}
</div>

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
    grid-template-columns: auto 36px 1fr auto auto;
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
  .apod-row-art {
    width: 36px;
    height: 36px;
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
      grid-template-columns: auto 30px 1fr auto;
      gap: 8px;
    }
    .apod-row-art {
      width: 30px;
      height: 30px;
    }
    .apod-row-sub {
      display: none;
    }
  }
</style>
