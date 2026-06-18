<!--
  ValueScoreDock.svelte
  Weighted sliders that re-rank models live.
  Lifted from cost-q3.jsx (Q3Ranked + WeightSliders) and cost-data2.jsx (recommend, normalization).
  Lower-is-better normalization of cost+latency. Quality slot stays empty/future.
  Uses Svelte 5 runes ($state, $props, $derived).
-->
<script lang="ts">
  import type { CostCall } from './costApi.js';

  let { calls }: { calls: CostCall[] } = $props();

  // Weight state: cost + latency sum to 100
  let wCost = $state(50);
  let wLat  = $derived(100 - wCost);

  interface ModelAgg {
    model: string;
    cost: number;    // avg cost per call
    lat:  number;    // avg latency in seconds
    n:    number;
  }

  // Aggregate calls to per-model averages
  const agg = $derived.by<ModelAgg[]>(() => {
    const byModel = new Map<string, { totalCost: number; totalLat: number; n: number }>();
    for (const c of calls) {
      const cur = byModel.get(c.model) ?? { totalCost: 0, totalLat: 0, n: 0 };
      cur.totalCost += c.cost_usd;
      cur.totalLat += (c.latency_ms ?? 0) / 1000;
      cur.n += 1;
      byModel.set(c.model, cur);
    }
    return Array.from(byModel.entries()).map(([model, d]) => ({
      model,
      cost: d.n > 0 ? d.totalCost / d.n : 0,
      lat:  d.n > 0 ? d.totalLat / d.n : 0,
      n: d.n,
    }));
  });

  // Min-max normalize and invert (higher = better)
  interface Normalized extends ModelAgg {
    nCost: number;
    nLat:  number;
    score: number;
  }

  function normalize(rows: ModelAgg[], wc: number, wl: number): Normalized[] {
    const costs = rows.map((r) => r.cost);
    const lats  = rows.map((r) => r.lat);
    const cMin = Math.min(...costs), cMax = Math.max(...costs);
    const lMin = Math.min(...lats),  lMax = Math.max(...lats);
    const inv = (v: number, lo: number, hi: number): number =>
      hi === lo ? 1 : 1 - (v - lo) / (hi - lo);
    const sum = wc + wl || 1;
    return rows.map((r) => {
      const nCost = inv(r.cost, cMin, cMax);
      const nLat  = inv(r.lat, lMin, lMax);
      const score = Math.round((nCost * wc + nLat * wl) / sum * 100);
      return { ...r, nCost, nLat, score };
    }).sort((a, b) => b.score - a.score);
  }

  const ranked = $derived(normalize(agg, wCost, wLat));

  function money(n: number): string {
    if (n >= 0.01) return `$${n.toFixed(3)}`;
    return `$${n.toFixed(5)}`;
  }

  function abbr(model: string): string {
    const parts = model.split('/');
    return parts[parts.length - 1];
  }

  const presets = [
    { label: 'Balanced', cost: 50 },
    { label: 'Cheapest', cost: 85 },
    { label: 'Fastest',  cost: 15 },
  ];

  const isEmpty = $derived(agg.length === 0);
</script>

<div class="vsd-wrap">
  <div class="vsd-title">Value score · live ranking</div>

  {#if isEmpty}
    <div class="vsd-empty">(no calls today — no models to rank)</div>
  {:else}
    <!-- Sliders -->
    <div class="vsd-sliders">
      <div class="vsd-slider-title">
        Weights
        <span class="vsd-slider-hint">drag to re-rank</span>
      </div>

      <!-- Cost slider -->
      <div class="vsd-wt">
        <div class="vsd-wt-top">
          <span class="vsd-wt-name">
            <span class="vsd-dot vsd-dot--cost"></span>Cost
          </span>
          <span class="vsd-wt-val">{wCost}<span class="vsd-wt-pct">%</span></span>
        </div>
        <input
          class="vsd-range"
          type="range"
          min="0"
          max="100"
          value={wCost}
          oninput={(e) => { wCost = Number(e.currentTarget.value); }}
        />
      </div>

      <!-- Latency slider (derived: 100 - wCost) -->
      <div class="vsd-wt">
        <div class="vsd-wt-top">
          <span class="vsd-wt-name">
            <span class="vsd-dot vsd-dot--lat"></span>Latency
          </span>
          <span class="vsd-wt-val">{wLat}<span class="vsd-wt-pct">%</span></span>
        </div>
        <input
          class="vsd-range"
          type="range"
          min="0"
          max="100"
          value={wLat}
          oninput={(e) => { wCost = 100 - Number(e.currentTarget.value); }}
        />
      </div>

      <!-- Quality: future slot, disabled -->
      <div class="vsd-wt vsd-wt--ghost">
        <div class="vsd-wt-top">
          <span class="vsd-wt-name">
            <span class="vsd-dot vsd-dot--quality"></span>Quality
          </span>
          <span class="vsd-wt-val vsd-wt-val--ghost">—</span>
        </div>
        <input class="vsd-range vsd-range--disabled" type="range" min="0" max="100" value="0" disabled />
      </div>

      <!-- Preset buttons + sum display -->
      <div class="vsd-presets">
        <div class="vsd-preset-btns">
          {#each presets as preset}
            <button
              class="vsd-preset"
              onclick={() => { wCost = preset.cost; }}
            >{preset.label}</button>
          {/each}
        </div>
        <span class="vsd-sum">cost + latency = <b>100</b></span>
      </div>
    </div>

    <!-- Ranked models -->
    <div class="vsd-ranked">
      <div class="vsd-ranked-title">
        Models by value
        <span class="vsd-ranked-weights">{wCost}% cost · {wLat}% latency</span>
      </div>
      <div class="vsd-rank-list">
        {#each ranked as r, i (r.model)}
          {@const isLead = i === 0}
          <div class="vsd-rank-row" class:is-lead={isLead}>
            <div class="vsd-rank-pos">{i + 1}</div>
            <div class="vsd-rank-body">
              <div class="vsd-rank-line">
                <span class="vsd-rank-name" title={r.model}>
                  {abbr(r.model)}
                  <small>{money(r.cost)} · {r.lat.toFixed(1)}s · n={r.n}</small>
                </span>
                <span class="vsd-rank-score">{r.score}</span>
              </div>
              <div class="vsd-rank-bar">
                <div class="vsd-rank-fill" style="width: {r.score}%"></div>
              </div>
              <!-- Normalized sub-tracks -->
              <div class="vsd-norm">
                <div class="vsd-norm-cell">
                  <span class="vsd-norm-k">cost</span>
                  <div class="vsd-norm-bar">
                    <div class="vsd-norm-fill vsd-norm-fill--cost" style="width: {r.nCost * 100}%"></div>
                  </div>
                  <span class="vsd-norm-val">{r.nCost.toFixed(2)}</span>
                </div>
                <div class="vsd-norm-cell">
                  <span class="vsd-norm-k">lat</span>
                  <div class="vsd-norm-bar">
                    <div class="vsd-norm-fill vsd-norm-fill--lat" style="width: {r.nLat * 100}%"></div>
                  </div>
                  <span class="vsd-norm-val">{r.nLat.toFixed(2)}</span>
                </div>
              </div>
            </div>
          </div>
        {/each}
      </div>
    </div>

    <p class="vsd-note">
      <b>Normalize:</b> each KPI is min-max scaled and inverted so 1.0 = best (cheapest / fastest). Score = cost-weight·n<sub>cost</sub> + latency-weight·n<sub>lat</sub>.
    </p>
  {/if}
</div>

<style>
  .vsd-wrap {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--r-4);
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .vsd-title {
    font: 700 13px/1.2 var(--font-body);
    color: var(--fg);
  }

  .vsd-empty {
    font: 400 12px/1.4 var(--font-body);
    color: var(--fg-quiet);
    font-style: italic;
  }

  /* sliders card */
  .vsd-sliders {
    background: var(--surface-2);
    border: 1px solid var(--line);
    border-radius: var(--r-3);
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .vsd-slider-title {
    font: 700 11px/1 var(--font-body);
    color: var(--fg);
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .vsd-slider-hint {
    font: 500 9px/1 var(--font-mono);
    color: var(--fg-quiet);
    letter-spacing: 0.03em;
  }

  .vsd-wt {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .vsd-wt--ghost {
    opacity: 0.45;
  }

  .vsd-wt-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .vsd-wt-name {
    font: 700 11px/1 var(--font-body);
    color: var(--fg);
    display: flex;
    align-items: center;
    gap: 7px;
  }

  .vsd-dot {
    width: 9px;
    height: 9px;
    border-radius: 999px;
  }

  .vsd-dot--cost    { background: var(--mash-pulp); }
  .vsd-dot--lat     { background: var(--sky); }
  .vsd-dot--quality { background: var(--line-strong); }

  .vsd-wt-val {
    font: 700 13px/1 var(--font-mono);
    color: var(--fg);
  }

  .vsd-wt-pct {
    color: var(--fg-quiet);
    font-weight: 500;
  }

  .vsd-wt-val--ghost {
    color: var(--fg-quiet);
  }

  .vsd-range {
    -webkit-appearance: none;
    appearance: none;
    width: 100%;
    height: 6px;
    border-radius: 999px;
    background: var(--ink-3);
    outline: none;
    cursor: pointer;
  }

  .vsd-range::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 18px;
    height: 18px;
    border-radius: 999px;
    background: var(--mash-pulp);
    border: 2px solid var(--bone);
    cursor: grab;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
  }

  .vsd-range::-moz-range-thumb {
    width: 18px;
    height: 18px;
    border-radius: 999px;
    background: var(--mash-pulp);
    border: 2px solid var(--bone);
    cursor: grab;
  }

  .vsd-range--disabled {
    opacity: 0.4;
  }

  .vsd-range--disabled::-webkit-slider-thumb {
    background: var(--ink-5);
    cursor: not-allowed;
  }

  .vsd-presets {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    flex-wrap: wrap;
  }

  .vsd-preset-btns {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  .vsd-preset {
    font: 600 10px/1 var(--font-mono);
    padding: 5px 9px;
    border-radius: var(--r-2);
    border: 1px solid var(--line-strong);
    background: var(--surface-2);
    color: var(--fg-2);
    cursor: pointer;
    transition: all 0.12s ease;
  }

  .vsd-preset:hover {
    border-color: var(--mash-pulp);
    color: var(--mash-pulp);
  }

  .vsd-sum {
    font: 500 10px/1.3 var(--font-mono);
    color: var(--fg-quiet);
  }

  .vsd-sum b {
    color: var(--moss);
  }

  /* ranked list */
  .vsd-ranked {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .vsd-ranked-title {
    font: 700 11px/1 var(--font-body);
    color: var(--fg);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .vsd-ranked-weights {
    font: 500 9px/1 var(--font-mono);
    color: var(--fg-quiet);
  }

  .vsd-rank-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .vsd-rank-row {
    display: grid;
    grid-template-columns: 18px 1fr;
    gap: 9px;
    align-items: center;
  }

  .vsd-rank-pos {
    font: 700 12px/1 var(--font-mono);
    color: var(--fg-quiet);
    text-align: right;
  }

  .vsd-rank-row.is-lead .vsd-rank-pos {
    color: var(--mash-pulp);
  }

  .vsd-rank-body {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .vsd-rank-line {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
  }

  .vsd-rank-name {
    font: 700 11px/1.1 var(--font-body);
    color: var(--fg);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }

  .vsd-rank-name small {
    font: 500 9px/1 var(--font-mono);
    color: var(--fg-quiet);
    font-weight: 500;
    margin-left: 6px;
  }

  .vsd-rank-score {
    font: 800 14px/1 var(--font-mono);
    color: var(--fg);
    flex: 0 0 auto;
  }

  .vsd-rank-row.is-lead .vsd-rank-score {
    color: var(--mash-pulp);
  }

  .vsd-rank-bar {
    height: 10px;
    border-radius: 999px;
    background: var(--ink-2);
    overflow: hidden;
  }

  .vsd-rank-fill {
    height: 100%;
    border-radius: 999px;
    background: linear-gradient(90deg, var(--mash-pulp-edge), var(--mash-pulp));
    transition: width 0.25s ease;
  }

  .vsd-rank-row.is-lead .vsd-rank-fill {
    background: linear-gradient(90deg, var(--mash-pulp-deep), var(--mash-pulp));
  }

  /* normalized sub-tracks */
  .vsd-norm {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px 10px;
    margin-top: 2px;
  }

  .vsd-norm-cell {
    display: grid;
    grid-template-columns: 26px 1fr 30px;
    gap: 5px;
    align-items: center;
  }

  .vsd-norm-k {
    font: 700 7.5px/1 var(--font-mono);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--fg-quiet);
  }

  .vsd-norm-bar {
    height: 4px;
    border-radius: 999px;
    background: var(--ink-2);
    overflow: hidden;
  }

  .vsd-norm-fill {
    height: 100%;
    border-radius: 999px;
  }

  .vsd-norm-fill--cost { background: var(--mash-pulp); }
  .vsd-norm-fill--lat  { background: var(--sky); }

  .vsd-norm-val {
    font: 500 8px/1 var(--font-mono);
    color: var(--fg-quiet);
    text-align: right;
  }

  .vsd-note {
    margin: 0;
    font: 400 10px/1.5 var(--font-body);
    color: var(--fg-quiet);
    border-top: 1px dashed var(--line);
    padding-top: 8px;
  }

  .vsd-note b {
    color: var(--fg-muted);
    font-weight: 700;
  }
</style>
