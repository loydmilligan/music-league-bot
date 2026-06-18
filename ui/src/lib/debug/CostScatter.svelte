<!--
  CostScatter.svelte
  Cost x latency scatter plot.
  One point per model, colored by category share.
  CSS positioned points — no chart library.
  Translated from cost-q2.jsx (Q2Scatter option A).

  Props:
    calls CostCall[] — today's calls; aggregated here to one point per model
-->
<script lang="ts">
  import type { CostCall } from './costApi.js';

  let { calls }: { calls: CostCall[] } = $props();

  interface ModelPoint {
    model: string;
    cost: number;     // avg cost per call
    lat: number;      // avg latency in seconds
    n: number;        // call count
    abbr: string;
  }

  function abbr(model: string): string {
    const parts = model.split('/');
    const name = parts[parts.length - 1];
    // Take first letters of dash-separated words, max 4 chars
    return name
      .split('-')
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('')
      .slice(0, 4);
  }

  const points = $derived.by<ModelPoint[]>(() => {
    const byModel = new Map<string, { totalCost: number; totalLat: number; n: number }>();
    for (const c of calls) {
      const cur = byModel.get(c.model) ?? { totalCost: 0, totalLat: 0, n: 0 };
      cur.totalCost += c.cost_usd;
      cur.totalLat += (c.latency_ms ?? 0) / 1000;
      cur.n += 1;
      byModel.set(c.model, cur);
    }
    return Array.from(byModel.entries()).map(([model, agg]) => ({
      model,
      cost: agg.n > 0 ? agg.totalCost / agg.n : 0,
      lat:  agg.n > 0 ? agg.totalLat / agg.n : 0,
      n: agg.n,
      abbr: abbr(model),
    }));
  });

  const W = 280;
  const H = 160;

  const costMax = $derived(Math.max(...points.map((p) => p.cost), 0.001) * 1.15);
  const latMax  = $derived(Math.max(...points.map((p) => p.lat), 0.001) * 1.15);

  function xOf(lat: number): number {
    return (lat / latMax) * W;
  }

  function yOf(cost: number): number {
    return Math.max(0.04, cost / costMax) * H;
  }

  function money(n: number): string {
    if (n >= 0.01) return `$${n.toFixed(3)}`;
    return `$${n.toFixed(5)}`;
  }

  const isEmpty = $derived(points.length === 0);
</script>

<div class="csc-wrap">
  <div class="csc-title">
    Cost × latency
    <span class="csc-sub">one point per model · today</span>
  </div>

  {#if isEmpty}
    <div class="csc-empty">(no calls today)</div>
  {:else}
    <div class="csc-container" style="padding: 10px 12px 28px 44px; position: relative;">
      <!-- axis labels -->
      <span class="csc-axis-title">cost / call</span>
      <div class="csc-plot" style="width: {W}px; height: {H}px; position: relative;">
        <!-- gridlines -->
        {#each [0, 0.25, 0.5, 0.75, 1] as g}
          <div class="csc-grid-h" style="bottom: {g * H}px"></div>
          <div class="csc-grid-v" style="left: {g * W}px"></div>
        {/each}

        <!-- axis text -->
        <span class="csc-ax-y" style="right: calc(100% + 4px); bottom: {H - 8}px">{money(costMax)}</span>
        <span class="csc-ax-y" style="right: calc(100% + 4px); bottom: -4px">$0</span>
        <span class="csc-ax-x" style="left: -2px; bottom: -18px">fast</span>
        <span class="csc-ax-x" style="right: -8px; bottom: -18px">slow</span>

        <!-- model dots -->
        {#each points as pt (pt.model)}
          {@const x = xOf(pt.lat)}
          {@const y = yOf(pt.cost)}
          <div
            class="csc-dot"
            style="left: {x}px; bottom: {y}px;"
            title="{pt.model} · {money(pt.cost)}/call avg · {pt.lat.toFixed(1)}s avg · n={pt.n}"
          >
            {pt.abbr}
            <span class="csc-dot-lab">{pt.abbr}</span>
          </div>
        {/each}
      </div>
    </div>

    <div class="csc-note">
      Bottom-left = cheapest + fastest. Hover a dot for model details.
    </div>
  {/if}
</div>

<style>
  .csc-wrap {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--r-4);
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    overflow: hidden;
  }

  .csc-title {
    font: 700 13px/1.2 var(--font-body);
    color: var(--fg);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .csc-sub {
    font: 500 10px/1 var(--font-mono);
    color: var(--fg-quiet);
  }

  .csc-empty {
    font: 400 12px/1.4 var(--font-body);
    color: var(--fg-quiet);
    font-style: italic;
  }

  .csc-container {
    overflow-x: auto;
  }

  .csc-axis-title {
    position: absolute;
    left: 8px;
    top: 50%;
    transform: rotate(-90deg) translateX(50%);
    transform-origin: left center;
    font: 700 8px/1 var(--font-mono);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--fg-muted);
    white-space: nowrap;
  }

  .csc-plot {
    background: var(--ink-0);
    border: 1px solid var(--line);
    border-radius: var(--r-3);
  }

  .csc-grid-h {
    position: absolute;
    left: 0;
    right: 0;
    height: 1px;
    background: var(--ink-3);
  }

  .csc-grid-v {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background: var(--ink-3);
  }

  .csc-ax-y {
    position: absolute;
    font: 600 8px/1 var(--font-mono);
    color: var(--fg-quiet);
    white-space: nowrap;
  }

  .csc-ax-x {
    position: absolute;
    font: 600 8px/1 var(--font-mono);
    color: var(--fg-quiet);
  }

  .csc-dot {
    position: absolute;
    transform: translate(-50%, 50%);
    width: 28px;
    height: 28px;
    border-radius: 999px;
    border: 2px solid var(--mash-pulp);
    background: var(--mash-pulp-soft);
    display: grid;
    place-items: center;
    cursor: pointer;
    font: 700 8px/1 var(--font-mono);
    color: var(--mash-pulp);
    transition: box-shadow 0.12s ease;
    z-index: 1;
  }

  .csc-dot:hover {
    box-shadow: 0 0 0 4px rgba(255, 255, 255, 0.1);
    z-index: 3;
  }

  .csc-dot-lab {
    position: absolute;
    left: 50%;
    bottom: calc(100% + 3px);
    transform: translateX(-50%);
    white-space: nowrap;
    font: 700 8px/1 var(--font-mono);
    color: var(--fg);
    background: var(--ink-0);
    padding: 2px 4px;
    border-radius: 3px;
    border: 1px solid var(--line);
    display: none;
  }

  .csc-dot:hover .csc-dot-lab {
    display: block;
  }

  .csc-note {
    font: 400 10px/1.4 var(--font-body);
    color: var(--fg-quiet);
  }
</style>
