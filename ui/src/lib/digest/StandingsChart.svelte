<script lang="ts" module>
  // ── standings-chart · sprint-14 (viz) ────────────────────────────────────
  // Season-standings-with-round-impact bar chart. One horizontal bar per user =
  // their season total, with THIS round's points drawn as a highlighted
  // end-segment, the current rank + (prev rank), and a ▲/▼/– movement arrow.
  //
  // Implements the frontend VARIANT SLOT INTERFACE (`VisualComponentProps` in
  // variants.ts). Mounted as:
  //   <StandingsChart {kind} {content} data={visualData} variant=… />
  // We read the **Standings payload** from `data` (NOT content_json), per the
  // backend → viz contract:
  //   data = { standings: StandingRow[], reconcile?: {...} }   (array also accepted)
  //   StandingRow = { name, rank, prevRank, priorTotal, roundPoints, currentTotal }
  //   in standing order;  priorTotal + roundPoints === currentTotal;
  //   prevRank may be null (new entrant / first scored round) → renders '(new)'.
  // In 'both' the textual caption renders BELOW us via DigestSection — we render
  // only the chart.
  export type StandingRow = {
    name: string;
    rank: number;
    prevRank?: number | null;
    priorTotal: number;
    roundPoints: number;
    currentTotal: number;
    avatar_url?: string | null;
    initials?: string;
    hue?: string;
  };
</script>

<script lang="ts">
  import type { VisualComponentProps } from './variants.js';

  let { data }: VisualComponentProps = $props();

  // Accept either the full payload object ({ standings, reconcile }) or a bare
  // array, defensively — the contract carries `standings` but tolerate both.
  const rows = $derived.by<StandingRow[]>(() => {
    const d = data as { standings?: unknown } | unknown[] | null | undefined;
    const arr = Array.isArray(d) ? d : Array.isArray(d?.standings) ? d.standings : [];
    return [...(arr as StandingRow[])].sort((a, b) => a.rank - b.rank);
  });

  // Scale all bars against the leader's season total so widths are comparable.
  const maxTotal = $derived(Math.max(1, ...rows.map((r) => r.currentTotal || 0)));
  const pct = (n: number) => `${Math.max(0, (n / maxTotal) * 100)}%`;

  type Move = { dir: 'up' | 'down' | 'same'; glyph: string };
  function movement(r: StandingRow): Move {
    if (r.prevRank == null) return { dir: 'same', glyph: '–' };
    if (r.rank < r.prevRank) return { dir: 'up', glyph: '▲' };
    if (r.rank > r.prevRank) return { dir: 'down', glyph: '▼' };
    return { dir: 'same', glyph: '–' };
  }
</script>

<div class="stch" data-component="standings-chart">
  {#if rows.length}
    <ol class="stch-rows">
      {#each rows as r (r.name + r.rank)}
        {@const mv = movement(r)}
        <li class="stch-row">
          <!-- Avatar with badge overlays (replaces stch-rankcell) -->
          <div class="stch-avwrap">
            {#if r.avatar_url}
              <img
                class="stch-av"
                src={r.avatar_url}
                alt={r.initials ?? r.name}
                onerror={(e) => {
                  const img = e.currentTarget as HTMLImageElement;
                  img.style.display = 'none';
                  const next = img.nextElementSibling as HTMLElement | null;
                  if (next) next.style.display = 'grid';
                }}
              />
            {/if}
            <!-- Initials fallback (shown when no avatar_url, or on img error) -->
            <div
              class="stch-av stch-av-init"
              style:background={r.hue ?? 'oklch(0.72 0.15 0)'}
              style:display={r.avatar_url ? 'none' : 'grid'}
            >
              {r.initials ?? r.name.slice(0, 2).toUpperCase()}
            </div>
            <!-- Rank badge at bottom-center -->
            <span class="stch-rank-badge">{r.rank}</span>
            <!-- Arrow badge at top-right -->
            <span class="stch-arrow-badge is-{mv.dir}" title={`prev rank ${r.prevRank ?? '—'}`}>{mv.glyph}</span>
          </div>

          <div class="stch-main">
            <div class="stch-toprow">
              <span class="stch-name" title={r.name}>{r.name}</span>
              <span class="stch-total">{r.currentTotal}</span>
            </div>
            <div
              class="stch-track"
              role="img"
              aria-label={`${r.name}: ${r.currentTotal} total, +${r.roundPoints} this round`}
            >
              <div class="stch-bar-prior" style:width={pct(r.priorTotal)}></div>
              {#if r.roundPoints > 0}
                <div class="stch-bar-round" style:width={pct(r.roundPoints)}>
                  <span class="stch-round-lbl">+{r.roundPoints}</span>
                </div>
              {/if}
            </div>
          </div>
        </li>
      {/each}
    </ol>

    <div class="stch-legend">
      <span class="stch-leg"><i class="sw sw-prior"></i>season so far</span>
      <span class="stch-leg"><i class="sw sw-round"></i>this round</span>
      <span class="stch-leg"
        ><i class="stch-arrow is-up">▲</i> up <i class="stch-arrow is-down">▼</i> down · # = rank</span
      >
    </div>
  {:else}
    <p class="stch-empty">(no standings data)</p>
  {/if}
</div>

<style>
  .stch {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .stch-rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .stch-row {
    display: grid;
    grid-template-columns: 40px 1fr;
    align-items: center;
    gap: 10px;
  }

  /* ── avatar column with badge overlays ──────────────────────────────── */
  .stch-avwrap {
    position: relative;
    width: 32px;
    height: 32px;
    flex: 0 0 32px;
    margin-right: 0;
  }
  .stch-av {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    object-fit: cover;
    display: block;
  }
  .stch-av-init {
    display: grid;
    place-items: center;
    font-size: 11px;
    font-weight: 700;
    color: #0c0a08;
    letter-spacing: -0.02em;
  }
  /* Rank badge — bottom center */
  .stch-rank-badge {
    position: absolute;
    bottom: -3px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(0, 0, 0, 0.7);
    color: #fff;
    font-size: 9px;
    font-weight: 700;
    line-height: 1;
    padding: 1px 3px;
    border-radius: 3px;
    pointer-events: none;
  }
  /* Arrow badge — top right */
  .stch-arrow-badge {
    position: absolute;
    top: -3px;
    right: -3px;
    font-size: 10px;
    line-height: 1;
    font-weight: 700;
  }
  .stch-arrow-badge.is-up {
    color: #22c55e;
  }
  .stch-arrow-badge.is-down {
    color: #ef4444;
  }
  .stch-arrow-badge.is-same {
    color: #6b7280;
  }

  /* ── bar ─────────────────────────────────────────────────────────────── */
  .stch-main {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }
  .stch-toprow {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
  }
  .stch-name {
    font: 600 12.5px/1.2 var(--font-body);
    color: var(--fg-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .stch-total {
    font: 700 13px/1 var(--font-mono);
    color: var(--fg);
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  }
  .stch-track {
    display: flex;
    align-items: stretch;
    height: 16px;
    border-radius: var(--r-1);
    overflow: hidden;
    background: var(--ink-2);
  }
  .stch-bar-prior {
    background: var(--ink-4);
    border-radius: var(--r-1) 0 0 var(--r-1);
    min-width: 2px;
  }
  .stch-bar-round {
    background: var(--mash-pulp);
    display: flex;
    align-items: center;
    justify-content: flex-end;
    min-width: 3px;
    box-shadow: -1px 0 0 var(--mash-pulp-edge);
  }
  .stch-round-lbl {
    font: 700 9px/1 var(--font-mono);
    color: var(--bone);
    padding: 0 4px;
    white-space: nowrap;
  }

  /* ── legend ──────────────────────────────────────────────────────────── */
  .stch-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 14px;
    padding-top: 4px;
    border-top: 1px dashed var(--line);
  }
  .stch-leg {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font: 500 9.5px/1.4 var(--font-mono);
    color: var(--fg-quiet);
    letter-spacing: 0.02em;
  }
  .sw {
    width: 12px;
    height: 9px;
    border-radius: 2px;
    display: inline-block;
  }
  .sw-prior {
    background: var(--ink-4);
  }
  .sw-round {
    background: var(--mash-pulp);
  }
  .stch-arrow.is-up {
    color: var(--moss);
  }
  .stch-arrow.is-down {
    color: var(--ember);
  }
  .stch-arrow.is-same {
    color: var(--fg-quiet);
  }
  .stch-legend .stch-arrow {
    font-size: 9px;
  }

  .stch-empty {
    margin: 0;
    font: 400 13px/1.5 var(--font-body);
    color: var(--fg-quiet);
    font-style: italic;
  }

  /* html-share on phone (≤640px): taller bars, larger type */
  @media (max-width: 640px) {
    .stch-row {
      grid-template-columns: 40px 1fr;
      gap: 10px;
    }
    .stch-track {
      height: 24px;
    }
    .stch-round-lbl {
      font-size: 10px;
    }
    .stch-name {
      font-size: 13.5px;
    }
    .stch-total {
      font-size: 14px;
    }
  }

  @media (max-width: 460px) {
    .stch-row {
      grid-template-columns: 40px 1fr;
      gap: 8px;
    }
    .stch-legend {
      gap: 10px;
    }
  }
</style>
