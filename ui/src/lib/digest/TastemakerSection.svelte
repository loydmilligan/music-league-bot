<script lang="ts" module>
  // ── tastemaker-component · sprint-18 (viz) ────────────────────────────────
  // The discoverability v2 "Tastemaker leaderboard" — a per-player season taste
  // profile. Ported from the approved mockup
  // `docs/planning/famjam-s3-concept-c-mobile.html`. Replaces the squashed v1.
  //
  // Per-player stacked bar across 4 RAW-obscurity buckets, ranked by a MEDIAN
  // discovery-percentile "Tastemaker score" (de-squashed, ~24–80 spread). Counts
  // live INSIDE the segments; the median score + ▲/▼ rank-change sit on the left.
  //
  // TWO render modes off one component:
  //   • WEB (interactive): tappable bucket counts → a lightweight song modal
  //     (light scrim, tap-outside / Esc to close, gentle slide-up). The modal
  //     shows that bucket's bar broken into ONE CHUNK PER SONG (most-obscure =
  //     rightmost chunk = top of the list), themed to the bucket colour + icon.
  //   • EXPORT (mobile PNG, ?export=1): static fallback — bars + counts + median
  //     score + ▲/▼ + legend, NO modal/tap (interactivity can't survive a PNG).
  //
  // Implements the variant slot interface (`VisualComponentProps`, variants.ts).
  // The v2 payload arrives on the `data` prop (the section's `visualData`):
  //   { scope, season, players: [ {
  //       name, rank, prevRank: number|null, tastemakerScore: 0–100 (percentile
  //       median), avgPoints, submissionCount,
  //       buckets: { radioHit, recognizable, curiousCut, rabbitHole },
  //       songs: [ { round, artist, title, obscurity, discoveryPercentile,
  //                  bucket, points } ]   // most-obscure-first
  //   } ] }
  // Self-suppresses (renders nothing) when the payload is null/empty.
  import type { VisualComponentProps } from './variants.js';

  export type BucketKey = 'radioHit' | 'recognizable' | 'curiousCut' | 'rabbitHole';
  export type TastemakerSong = {
    round?: string;
    artist?: string;
    title?: string;
    obscurity?: number;
    discoveryPercentile?: number;
    bucket?: BucketKey;
    points?: number;
  };
  export type TastemakerPlayer = {
    name?: string;
    rank?: number;
    prevRank?: number | null;
    tastemakerScore?: number;
    avgPoints?: number;
    submissionCount?: number;
    buckets?: Record<BucketKey, number>;
    songs?: TastemakerSong[];
  };
  export type TastemakerPayload = {
    scope?: string;
    season?: string;
    players?: TastemakerPlayer[];
  };

  type BucketMeta = { key: BucketKey; label: string; range: string; color: string; icon: string };
  // order = mainstream → obscure (left → right in the bar)
  const BUCKETS: BucketMeta[] = [
    {
      key: 'radioHit', label: 'Radio Hit', range: '<10', color: '#f5762e',
      icon: '<svg viewBox="0 0 24 24"><path d="M5 9l13-5"/><rect x="3" y="9" width="18" height="11" rx="2"/><circle cx="8" cy="14.5" r="2.5"/><path d="M15 13h3M15 16h3"/></svg>',
    },
    {
      key: 'recognizable', label: 'Recognizable', range: '10–19', color: '#e8a83a',
      icon: '<svg viewBox="0 0 24 24"><path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="13" width="4" height="7" rx="1.5"/><rect x="17" y="13" width="4" height="7" rx="1.5"/></svg>',
    },
    {
      key: 'curiousCut', label: 'Curious Cut', range: '20–29', color: '#5aa3ff',
      icon: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/></svg>',
    },
    {
      key: 'rabbitHole', label: 'Rabbit Hole', range: '30+', color: '#3ec27a',
      icon: '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="18.5" rx="8" ry="3"/><path d="M12 3v11M8 10l4 4 4-4"/></svg>',
    },
  ];
  const BUCKET_BY_KEY: Record<BucketKey, BucketMeta> = Object.fromEntries(
    BUCKETS.map((b) => [b.key, b]),
  ) as Record<BucketKey, BucketMeta>;
</script>

<script lang="ts">
  import { page } from '$app/state';

  let { data }: VisualComponentProps = $props();

  // Accept the payload object, a {discoverability:{...}} wrapper, or null.
  const payload = $derived.by<TastemakerPayload | null>(() => {
    const d = data as TastemakerPayload | { discoverability?: TastemakerPayload } | null | undefined;
    if (!d) return null;
    if (Array.isArray((d as TastemakerPayload).players)) return d as TastemakerPayload;
    const inner = (d as { discoverability?: TastemakerPayload }).discoverability;
    if (inner && Array.isArray(inner.players)) return inner;
    return null;
  });
  const players = $derived(
    [...(payload?.players ?? [])].sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0)),
  );

  // Static export (mobile PNG) can't expand → no modal/tap.
  const isExport = $derived(page?.url?.searchParams?.get('export') === '1');

  type Move = { dir: 'up' | 'down' | 'same'; glyph: string };
  function movement(p: TastemakerPlayer): Move {
    if (p.prevRank == null || p.rank == null) return { dir: 'same', glyph: '–' };
    if (p.rank < p.prevRank) return { dir: 'up', glyph: '▲' };
    if (p.rank > p.prevRank) return { dir: 'down', glyph: '▼' };
    return { dir: 'same', glyph: '–' };
  }
  const bucketCount = (p: TastemakerPlayer, k: BucketKey) => p.buckets?.[k] ?? 0;

  // ── tap-modal state (web only) ────────────────────────────────────────
  let modalPlayer = $state<TastemakerPlayer | null>(null);
  let modalBucket = $state<BucketMeta | null>(null);
  let hoverIdx = $state(-1);

  // songs of the open bucket, most-obscure-first (payload songs[] already is)
  const modalSongs = $derived.by<TastemakerSong[]>(() => {
    if (!modalPlayer || !modalBucket) return [];
    return (modalPlayer.songs ?? []).filter((s) => s.bucket === modalBucket!.key);
  });
  // chunks shown left→right = least→most obscure, so rightmost = song #1 (most obscure)
  const chunks = $derived(
    modalSongs.map((s, i) => ({ song: s, idx: i })).slice().reverse(),
  );
  const chunkOpacity = (idx: number, n: number) =>
    n <= 1 ? 1 : +(1 - 0.38 * (idx / (n - 1))).toFixed(3); // idx 0 (most obscure) brightest

  function openModal(p: TastemakerPlayer, b: BucketMeta) {
    if (isExport) return;
    modalPlayer = p;
    modalBucket = b;
    hoverIdx = -1;
  }
  function closeModal() {
    modalPlayer = null;
    modalBucket = null;
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && modalPlayer) closeModal();
  }
</script>

<svelte:window onkeydown={onKey} />

{#if players.length}
  <div class="tm" data-component="tastemaker" class:is-export={isExport}>
    <!-- legend: buckets + score explanation (both web & static) -->
    <div class="tm-legend">
      <div class="tm-legend-buckets">
        {#each BUCKETS as b (b.key)}
          <span class="tm-leg"><i class="tm-sw" style:background={b.color}></i>{b.label} {b.range}</span>
        {/each}
      </div>
      <p class="tm-legend-score">
        <b>Tastemaker score</b> = median of your songs' discovery percentile (how obscure vs. the
        season, from Last.fm play counts). Buckets use each song's raw obscurity.
      </p>
    </div>

    <ol class="tm-rows">
      {#each players as p, pi (p.name ?? pi)}
        {@const mv = movement(p)}
        {@const total = BUCKETS.reduce((sum, b) => sum + bucketCount(p, b.key), 0) || 1}
        <li class="tm-row">
          <div class="tm-left">
            <span class="tm-score" title={`median discovery percentile · ${p.submissionCount ?? 0} picks`}
              >{p.tastemakerScore ?? '—'}</span
            >
            <span class="tm-delta is-{mv.dir}"
              ><span class="tm-arr">{mv.glyph}</span><span class="tm-prev"
                >{p.prevRank == null ? '' : `(${p.prevRank})`}</span
              ></span
            >
          </div>
          <div class="tm-right">
            <div class="tm-name-row">
              <span class="tm-name" title={p.name ?? ''}>{p.name ?? '—'}</span>
              <span class="tm-rk">#{p.rank ?? pi + 1}</span>
            </div>
            <div class="tm-bar" role="img" aria-label={`${p.name}: tastemaker score ${p.tastemakerScore}`}>
              {#each BUCKETS as b (b.key)}
                {@const n = bucketCount(p, b.key)}
                {#if n > 0}
                  <button
                    type="button"
                    class="tm-seg"
                    style:flex-grow={n}
                    style:background={b.color}
                    disabled={isExport}
                    title={isExport ? null : `${p.name} · ${b.label} · ${n} song${n === 1 ? '' : 's'} — tap`}
                    aria-label={`${p.name}, ${n} ${b.label} songs${isExport ? '' : ' — tap for list'}`}
                    onclick={() => openModal(p, b)}
                  >{n}</button>
                {/if}
              {/each}
            </div>
          </div>
        </li>
      {/each}
    </ol>
  </div>

  <!-- ── web-only song modal ─────────────────────────────────────────── -->
  {#if !isExport && modalPlayer && modalBucket}
    {@const n = modalSongs.length}
    <div
      class="tm-scrim"
      role="dialog"
      aria-modal="true"
      aria-label={`${modalPlayer.name} · ${modalBucket.label} songs`}
      tabindex="-1"
      onclick={(e) => { if (e.target === e.currentTarget) closeModal(); }}
      onkeydown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) closeModal(); }}
    >
      <div class="tm-modal" style:--bucket={modalBucket.color}>
        <div class="tm-modal-head">
          <div class="tm-modal-title">
            <span class="tm-modal-eyebrow">
              <span class="tm-modal-ico">{@html modalBucket.icon}</span>
              {modalBucket.label} · {n} song{n === 1 ? '' : 's'}
            </span>
            <h3 class="tm-modal-h">{modalPlayer.name}</h3>
          </div>
          <button type="button" class="tm-modal-x" aria-label="Close" onclick={closeModal}>✕</button>
        </div>

        <div class="tm-chunkbar-wrap">
          <div class="tm-chunkbar-cap"><span>familiar</span><span>most obscure →</span></div>
          <div class="tm-chunkbar">
            {#each chunks as c (c.idx)}
              <div
                class="tm-chunk"
                role="presentation"
                class:hl={hoverIdx === c.idx}
                style:opacity={chunkOpacity(c.idx, n)}
                title={`#${c.idx + 1} · ${c.song.title ?? ''} (ob ${c.song.obscurity ?? '—'})`}
                onpointerenter={() => (hoverIdx = c.idx)}
                onpointerleave={() => (hoverIdx = -1)}
              >{c.idx + 1}</div>
            {/each}
          </div>
        </div>

        <ul class="tm-modal-list">
          {#each modalSongs as s, i (i)}
            <li
              class="tm-song"
              role="presentation"
              class:hl={hoverIdx === i}
              onpointerenter={() => (hoverIdx = i)}
              onpointerleave={() => (hoverIdx = -1)}
            >
              <span class="tm-song-n">{i + 1}</span>
              <span class="tm-song-main">
                <span class="tm-song-title">{s.title ?? ''}</span>
                <span class="tm-song-artist">{s.artist ?? ''}</span>
              </span>
              <span class="tm-song-meta">
                <span class="tm-song-ob" style:color={modalBucket.color}>ob {s.obscurity ?? '—'}</span>
                <span class="tm-song-round">{s.round ?? ''}</span>
              </span>
            </li>
          {/each}
        </ul>

        <div class="tm-modal-foot">
          <button type="button" class="tm-btn-close" onclick={closeModal}>Close</button>
        </div>
      </div>
    </div>
  {/if}
{/if}

<style>
  .tm {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  /* ── legend ──────────────────────────────────────────────────────────── */
  .tm-legend {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .tm-legend-buckets {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 12px;
  }
  .tm-leg {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font: 600 9.5px/1.2 var(--font-mono);
    color: var(--fg-muted);
  }
  .tm-sw {
    width: 11px;
    height: 11px;
    border-radius: 3px;
    flex-shrink: 0;
  }
  .tm-legend-score {
    margin: 0;
    font: 400 10.5px/1.45 var(--font-body);
    color: var(--fg-quiet);
  }
  .tm-legend-score b {
    color: var(--fg-muted);
    font-weight: 700;
  }

  /* ── rows ────────────────────────────────────────────────────────────── */
  .tm-rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }
  .tm-row {
    display: grid;
    grid-template-columns: 46px 1fr;
    gap: 10px;
    align-items: center;
    padding: 7px 0;
    border-bottom: 1px solid var(--line);
  }
  .tm-row:last-child {
    border-bottom: 0;
  }

  .tm-left {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1px;
  }
  .tm-score {
    font: 800 22px/1 var(--font-mono);
    color: var(--fg);
    letter-spacing: -0.03em;
    font-variant-numeric: tabular-nums;
  }
  .tm-delta {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    font: 700 9.5px/1 var(--font-mono);
  }
  .tm-arr {
    font-size: 10px;
  }
  .tm-delta.is-up {
    color: var(--moss);
  }
  .tm-delta.is-down {
    color: var(--ember);
  }
  .tm-delta.is-same {
    color: var(--fg-quiet);
  }
  .tm-prev {
    color: var(--fg-quiet);
    font-weight: 600;
  }

  .tm-right {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .tm-name-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
  }
  .tm-name {
    font: 700 12.5px/1.2 var(--font-body);
    color: var(--fg);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tm-rk {
    font: 700 9px/1 var(--font-mono);
    color: var(--fg-quiet);
    flex-shrink: 0;
  }

  .tm-bar {
    display: flex;
    width: 100%;
    height: 24px;
    border-radius: 5px;
    overflow: hidden;
    background: var(--surface-2);
  }
  .tm-seg {
    flex-basis: 0;
    min-width: 26px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 0;
    padding: 0;
    margin: 0;
    font: 800 12px/1 var(--font-mono);
    color: #07090c;
    position: relative;
    -webkit-tap-highlight-color: transparent;
  }
  .tm-seg + .tm-seg {
    box-shadow: inset 1px 0 0 rgba(7, 9, 12, 0.35);
  }
  /* web: tappable affordance (disabled in the static export) */
  .tm-seg:not(:disabled) {
    cursor: pointer;
    transition: filter 120ms ease;
  }
  .tm-seg:not(:disabled):hover,
  .tm-seg:not(:disabled):focus-visible {
    filter: brightness(1.12);
    outline: none;
  }
  .tm-seg:not(:disabled):active {
    filter: brightness(0.9);
  }
  .tm-seg:not(:disabled)::after {
    content: '';
    position: absolute;
    top: 3px;
    right: 3px;
    width: 3px;
    height: 3px;
    border-radius: 50%;
    background: rgba(7, 9, 12, 0.4);
  }
  .tm-seg:disabled {
    cursor: default;
  }

  /* ── modal (web only) — light scrim, gentle slide-up ─────────────────── */
  .tm-scrim {
    position: fixed;
    inset: 0;
    background: rgba(7, 9, 12, 0.34);
    backdrop-filter: blur(1px);
    z-index: 120;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    animation: tm-scrim-in 240ms ease;
  }
  @media (min-width: 520px) {
    .tm-scrim {
      align-items: center;
    }
  }
  @keyframes tm-scrim-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
  .tm-modal {
    width: 100%;
    max-width: 440px;
    max-height: 88vh;
    background: var(--surface);
    border: 1px solid var(--line-strong);
    border-top: 3px solid var(--bucket, var(--line-strong));
    border-radius: 16px 16px 0 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    animation: tm-sheet-up 320ms cubic-bezier(0.22, 0.61, 0.36, 1);
  }
  @media (min-width: 520px) {
    .tm-modal {
      border-radius: 16px;
    }
  }
  @keyframes tm-sheet-up {
    from {
      transform: translateY(10px);
      opacity: 0;
    }
    to {
      transform: none;
      opacity: 1;
    }
  }
  .tm-modal-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px;
    padding: 16px 16px 12px;
    border-bottom: 1px solid var(--line);
  }
  .tm-modal-title {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  .tm-modal-eyebrow {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    font: 700 9.5px/1 var(--font-mono);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--bucket, var(--fg-muted));
  }
  .tm-modal-ico {
    display: inline-flex;
    width: 15px;
    height: 15px;
  }
  .tm-modal-ico :global(svg) {
    width: 15px;
    height: 15px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .tm-modal-h {
    margin: 0;
    font: 800 16px/1.15 var(--font-body);
    color: var(--fg);
  }
  .tm-modal-x {
    flex-shrink: 0;
    width: 32px;
    height: 32px;
    border-radius: 8px;
    background: var(--surface-2);
    border: 1px solid var(--line);
    color: var(--fg-muted);
    font: 700 16px/1 var(--font-mono);
    cursor: pointer;
  }
  .tm-modal-x:hover {
    color: var(--fg);
  }

  /* chunked bar: one rectangle per song (rightmost = most obscure) */
  .tm-chunkbar-wrap {
    padding: 14px 16px 4px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .tm-chunkbar-cap {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    font: 600 8.5px/1.2 var(--font-mono);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--fg-quiet);
  }
  .tm-chunkbar {
    display: flex;
    gap: 3px;
    height: 30px;
  }
  .tm-chunk {
    flex: 1 1 0;
    min-width: 0;
    border-radius: 4px;
    background: var(--bucket, var(--line-strong));
    display: grid;
    place-items: center;
    font: 800 11px/1 var(--font-mono);
    color: #07090c;
    cursor: default;
    transition: opacity 120ms ease, transform 120ms ease;
  }
  .tm-chunk.hl {
    opacity: 1 !important;
    transform: translateY(-2px);
  }

  .tm-modal-list {
    margin: 0;
    padding: 8px;
    list-style: none;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }
  .tm-song {
    display: flex;
    align-items: baseline;
    gap: 10px;
    padding: 9px 10px;
    border-radius: 8px;
    transition: background 120ms ease, box-shadow 120ms ease;
  }
  .tm-song:nth-child(odd) {
    background: var(--ink-0);
  }
  .tm-song.hl {
    background: var(--surface-2);
    box-shadow: inset 2px 0 0 var(--bucket, var(--line-strong));
  }
  .tm-song-n {
    font: 800 10px/1.4 var(--font-mono);
    color: var(--bucket, var(--fg-quiet));
    min-width: 16px;
    flex-shrink: 0;
    text-align: center;
  }
  .tm-song-main {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .tm-song-title {
    font: 700 13px/1.25 var(--font-body);
    color: var(--fg);
  }
  .tm-song-artist {
    font: 500 11.5px/1.2 var(--font-mono);
    color: var(--fg-muted);
  }
  .tm-song-meta {
    margin-left: auto;
    text-align: right;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .tm-song-ob {
    font: 700 12px/1 var(--font-mono);
  }
  .tm-song-round {
    font: 500 8.5px/1.3 var(--font-mono);
    color: var(--fg-quiet);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .tm-modal-foot {
    padding: 10px 16px 16px;
    border-top: 1px solid var(--line);
  }
  .tm-btn-close {
    width: 100%;
    padding: 12px;
    border-radius: 10px;
    border: 1px solid var(--line-strong);
    background: var(--surface-2);
    color: var(--fg);
    font: 700 13px/1 var(--font-body);
    cursor: pointer;
  }
  .tm-btn-close:hover {
    filter: brightness(1.1);
  }

  @media (max-width: 460px) {
    .tm-row {
      grid-template-columns: 42px 1fr;
      gap: 8px;
    }
    .tm-score {
      font-size: 20px;
    }
  }

  /* ── mobile-share: phone-portrait readability (html-share, ≤640px) ──── */
  /* Target: bars as tall as the PDF output, segment counts legible at arm's
     length. Bar height 24→40px, segment font 12→16px, score 22→28px. */
  @media (max-width: 640px) {
    .tm-row {
      grid-template-columns: 54px 1fr;
      gap: 10px;
      padding: 10px 0;
    }
    .tm-score {
      font: 800 28px/1 var(--font-mono);
    }
    .tm-name {
      font: 700 14px/1.2 var(--font-body);
    }
    .tm-bar {
      height: 40px;
      border-radius: 6px;
    }
    .tm-seg {
      font: 800 16px/1 var(--font-mono);
      min-width: 32px;
    }
    .tm-legend-score {
      font-size: 11.5px;
    }
  }
</style>
