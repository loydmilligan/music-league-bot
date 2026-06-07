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
          <div class="stch-rankcell">
            <span class="stch-arrow is-{mv.dir}" title={`prev rank ${r.prevRank ?? '—'}`}
              >{mv.glyph}</span
            >
            <span class="stch-rank">{r.rank}</span>
            <span class="stch-prev">{r.prevRank == null ? '(new)' : `(${r.prevRank})`}</span>
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
        ><i class="stch-arrow is-up">▲</i> up <i class="stch-arrow is-down">▼</i> down · (n) = prev
        rank</span
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
    grid-template-columns: 64px 1fr;
    align-items: center;
    gap: 10px;
  }

  /* ── rank cell: arrow · rank · (prev) ────────────────────────────────── */
  .stch-rankcell {
    display: grid;
    grid-template-columns: 12px auto;
    grid-template-rows: auto auto;
    column-gap: 5px;
    align-items: center;
    justify-content: start;
  }
  .stch-arrow {
    grid-row: 1 / 3;
    font-size: 11px;
    line-height: 1;
    text-align: center;
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
  .stch-rank {
    grid-column: 2;
    grid-row: 1;
    font: 700 18px/1 var(--font-mono);
    color: var(--fg);
    font-variant-numeric: tabular-nums;
  }
  .stch-prev {
    grid-column: 2;
    grid-row: 2;
    font: 500 9.5px/1 var(--font-mono);
    color: var(--fg-quiet);
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
  .stch-legend .stch-arrow {
    font-size: 9px;
  }

  .stch-empty {
    margin: 0;
    font: 400 13px/1.5 var(--font-body);
    color: var(--fg-quiet);
    font-style: italic;
  }

  /* html-share on phone (≤640px): taller bars, wider rankcell, larger type */
  @media (max-width: 640px) {
    .stch-row {
      grid-template-columns: 60px 1fr;
      gap: 10px;
    }
    .stch-track {
      height: 24px;
    }
    .stch-rank {
      font-size: 20px;
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
      grid-template-columns: 54px 1fr;
      gap: 8px;
    }
    .stch-rank {
      font-size: 16px;
    }
    .stch-legend {
      gap: 10px;
    }
  }
</style>
