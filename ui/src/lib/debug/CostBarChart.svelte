<!--
  CostBarChart.svelte
  2-week vertical stacked CSS-bar chart.
  Colors per category: digest=mash-pulp, archive=moss, predict=sky.
  Per-call opacity shading: 1.0 - (index / count) * 0.45 (bottom = most opaque).
  Hover tooltips via CSS + title attributes.
  NO charting library — pure CSS/flex/grid like StandingsChart.svelte.
  Translated from cost-q1.jsx (Q1Bars, Q1Legend) + cost-styles.css.

  Props:
    days      DailyCost[]               — 14 days oldest-first (contract)
    callsByDate Record<string, CostCall[]> — map of date → calls for shading
-->
<script lang="ts">
  import type { DailyCost, CostCall } from './costApi.js';

  let {
    days,
    callsByDate = {},
  }: {
    days: DailyCost[];
    callsByDate?: Record<string, CostCall[]>;
  } = $props();

  const CATS = ['digest', 'archive', 'predict', 'avatar'] as const;
  type Cat = typeof CATS[number];

  const CAT_LABEL: Record<Cat, string> = {
    digest:  'Digest',
    archive: 'Archive',
    predict: 'Predict',
    avatar:  'Avatar',
  };

  // Max total across all days — determines the y-scale ceiling
  const yMax = $derived(Math.max(...days.map((d) => d.digest + d.archive + d.predict + d.avatar), 0.001));

  // For each day and category, produce opacity-stepped segments.
  // Segments = individual calls sorted by cost (largest first = bottom).
  // When no call-level data is available, treat entire category as one segment.
  function segments(day: DailyCost, cat: Cat): { cost: number; label: string; opacity: number }[] {
    const calls = (callsByDate[day.date] ?? []).filter((c) => c.category === cat);
    const catTotal = day[cat];
    if (catTotal <= 0) return [];

    if (calls.length === 0) {
      // No per-call data: one segment at full opacity
      return [{ cost: catTotal, label: `${CAT_LABEL[cat]} (no detail)`, opacity: 1 }];
    }

    // Sort by cost desc (most expensive at bottom = highest opacity)
    const sorted = [...calls].sort((a, b) => b.cost_usd - a.cost_usd);
    const n = sorted.length;
    return sorted.map((c, i) => ({
      cost: c.cost_usd,
      label: `${CAT_LABEL[cat]} · ${c.label} · $${c.cost_usd.toFixed(4)}`,
      opacity: 1.0 - (i / Math.max(n, 1)) * 0.45,
    }));
  }

  function money(n: number): string {
    if (n >= 1) return `$${n.toFixed(2)}`;
    if (n >= 0.01) return `$${n.toFixed(3)}`;
    return `$${n.toFixed(4)}`;
  }

  function shortDate(isoDate: string): string {
    const d = new Date(isoDate + 'T00:00:00Z');
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    if (isoDate === todayStr) return 'today';
    // "Jun 15" style
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  }

  const PLOT_H = 200; // px height of the chart area

  const isEmpty = $derived(yMax <= 0.0011);

  // Y-axis ticks
  const yTicks = $derived([yMax, yMax / 2, 0]);
</script>

<div class="cbc-wrap">
  <div class="cbc-title">
    14-day spend · stacked by category
    {#if !isEmpty}
      <span class="cbc-total">{money(days.reduce((s, d) => s + d.digest + d.archive + d.predict + d.avatar, 0))}</span>
    {/if}
  </div>

  {#if isEmpty}
    <div class="cbc-empty">(no spend in the last 14 days)</div>
  {:else}
    <!-- Chart area -->
    <div class="cbc-chart">
      <!-- Y-axis ticks -->
      <div class="cbc-yticks" style="height: {PLOT_H}px">
        {#each yTicks as tick}
          <span>{money(tick)}</span>
        {/each}
      </div>

      <!-- Bars grid -->
      <div class="cbc-bars-plot" style="height: {PLOT_H}px">
        {#each days as day (day.date)}
          {@const total = day.digest + day.archive + day.predict + day.avatar}
          {@const isZero = total <= 0}
          <div class="cbc-daycol" class:is-zero={isZero}>
            {#if isZero}
              <div class="cbc-zero-tick"></div>
            {:else}
              <!-- Stack: bottom-to-top = digest, archive, predict -->
              <div
                class="cbc-stack"
                style="height: {(total / yMax) * (PLOT_H - 18)}px"
              >
                {#each CATS as cat}
                  {@const segs = segments(day, cat)}
                  {#each segs as seg, i (i)}
                    {@const segH = Math.max((seg.cost / yMax) * (PLOT_H - 18), 1)}
                    <!-- svelte-ignore a11y_mouse_events_have_key_events -->
                    <div
                      class="cbc-seg cbc-seg--{cat}"
                      style="height: {segH}px; opacity: {seg.opacity}"
                      title={seg.label}
                    ></div>
                  {/each}
                {/each}
              </div>
            {/if}
            <div class="cbc-daylab">
              {shortDate(day.date)}
            </div>
          </div>
        {/each}
      </div>
    </div>

    <!-- Legend -->
    <div class="cbc-legend">
      {#each CATS as cat}
        <div class="cbc-leg">
          <span class="cbc-leg-swatch cbc-leg-swatch--{cat}"></span>
          <span class="cbc-leg-label">{CAT_LABEL[cat]}</span>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .cbc-wrap {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--r-4);
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .cbc-title {
    font: 700 13px/1.2 var(--font-body);
    color: var(--fg);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .cbc-total {
    font: 500 10px/1 var(--font-mono);
    color: var(--fg-quiet);
    letter-spacing: 0.02em;
  }

  .cbc-empty {
    font: 400 12px/1.4 var(--font-body);
    color: var(--fg-quiet);
    font-style: italic;
  }

  /* chart layout: y-axis ticks + bars side by side */
  .cbc-chart {
    display: grid;
    grid-template-columns: 40px 1fr;
    gap: 6px;
  }

  .cbc-yticks {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    font: 500 8px/1 var(--font-mono);
    color: var(--fg-quiet);
    text-align: right;
    padding-bottom: 20px;
  }

  .cbc-bars-plot {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: 1fr;
    align-items: end;
    gap: 3px;
    border-bottom: 1px solid var(--line-strong);
    overflow: hidden;
  }

  .cbc-daycol {
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    align-items: center;
    gap: 4px;
    height: 100%;
    min-width: 0;
  }

  /* The stacked bar: column-reverse so digest renders at bottom */
  .cbc-stack {
    width: 100%;
    max-width: 22px;
    display: flex;
    flex-direction: column-reverse;
    border-radius: 3px 3px 0 0;
    overflow: hidden;
    min-height: 1px;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.35);
  }

  .cbc-seg {
    width: 100%;
    min-height: 1px;
    cursor: default;
    transition: filter 0.1s ease;
  }

  .cbc-seg:hover {
    filter: brightness(1.25) saturate(1.1);
    outline: 1px solid var(--bone);
    outline-offset: -1px;
    z-index: 2;
    position: relative;
  }

  /* category fills */
  .cbc-seg--digest  { background: var(--mash-pulp); }
  .cbc-seg--archive { background: var(--moss); }
  .cbc-seg--predict { background: var(--sky); }
  .cbc-seg--avatar  { background: var(--amber); }

  .cbc-daycol.is-zero .cbc-stack {
    background: var(--ink-2);
    box-shadow: none;
  }

  .cbc-zero-tick {
    width: 100%;
    max-width: 22px;
    height: 2px;
    background: var(--ink-3);
    border-radius: 1px;
  }

  .cbc-daylab {
    font: 500 7.5px/1 var(--font-mono);
    color: var(--fg-quiet);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
    text-align: center;
    padding: 2px 0 0;
  }

  /* legend */
  .cbc-legend {
    display: flex;
    gap: 14px;
    flex-wrap: wrap;
  }

  .cbc-leg {
    display: flex;
    align-items: center;
    gap: 6px;
    font: 600 11px/1 var(--font-body);
    color: var(--fg-2);
  }

  .cbc-leg-swatch {
    width: 12px;
    height: 12px;
    border-radius: 2px;
    flex-shrink: 0;
  }

  .cbc-leg-swatch--digest  { background: var(--mash-pulp); }
  .cbc-leg-swatch--archive { background: var(--moss); }
  .cbc-leg-swatch--predict { background: var(--sky); }
  .cbc-leg-swatch--avatar  { background: var(--amber); }

  /* On narrow mobile: shrink font sizes */
  @media (max-width: 460px) {
    .cbc-daylab {
      font-size: 6.5px;
    }
    .cbc-yticks {
      font-size: 7px;
    }
  }
</style>
