<script lang="ts">
  import type { PageData } from './$types.js';
  import SettingsTabs from '$lib/components/SettingsTabs.svelte';
  import CostSummaryCard from '$lib/debug/CostSummaryCard.svelte';
  import CostCallDrilldown from '$lib/debug/CostCallDrilldown.svelte';
  import CostBarChart from '$lib/debug/CostBarChart.svelte';
  import CostScatter from '$lib/debug/CostScatter.svelte';
  import ValueScoreDock from '$lib/debug/ValueScoreDock.svelte';
  import {
    fetchCostSummary,
    fetchCostDaily,
    fetchCostCalls,
    type DaySummary,
    type DailyCost,
    type CostCall,
  } from '$lib/debug/costApi.js';

  let { data } = $props<{ data: PageData }>();

  // Reactive data fetching
  let summary    = $state<DaySummary | null>(null);
  let dailyCosts = $state<DailyCost[]>([]);
  let calls      = $state<CostCall[]>([]);
  let loadErr    = $state<string | null>(null);

  // callsByDate index for the bar chart
  const callsByDate = $derived.by<Record<string, CostCall[]>>(() => {
    const out: Record<string, CostCall[]> = {};
    for (const c of calls) {
      const d = c.ts.slice(0, 10);
      (out[d] ??= []).push(c);
    }
    return out;
  });

  async function loadData() {
    if (!data.debugEnabled) return;
    try {
      const [s, d, c] = await Promise.all([
        fetchCostSummary(),
        fetchCostDaily(14),
        fetchCostCalls(),
      ]);
      summary    = s;
      dailyCosts = d;
      calls      = c;
      loadErr    = null;
    } catch (err) {
      loadErr = err instanceof Error ? err.message : String(err);
    }
  }

  $effect(() => {
    loadData();
  });
</script>

<svelte:head><title>Debug · music-league-bot</title></svelte:head>

<!-- Page header -->
<div class="mb-8">
  <div class="text-fg-faint font-mono text-xs tracking-widest uppercase mb-3">
    music-league-bot · /settings/debug
  </div>
  <h1 class="text-4xl font-bold text-fg mb-3">Debug</h1>
  <p class="text-fg-muted max-w-2xl">
    Live cost observability — today's LLM spend by category, call drilldown, 14-day chart, and model value rankings.
  </p>
</div>

<SettingsTabs />

<div class="mt-6">
  {#if !data.debugEnabled}
    <!-- Placeholder when debug mode is off -->
    <div class="debug-placeholder">
      <span class="debug-placeholder-glyph">⚙</span>
      <div class="debug-placeholder-body">
        <div class="debug-placeholder-title">Debug mode is off</div>
        <div class="debug-placeholder-sub">
          Enable it in <a href="/settings" class="debug-link">App Settings → Debug mode</a> to see the cost dashboard.
        </div>
      </div>
    </div>
  {:else}
    <!-- Error state -->
    {#if loadErr}
      <div class="debug-error">
        <span class="debug-error-glyph">▲</span>
        Failed to load cost data: {loadErr}
      </div>
    {/if}

    <!-- Dashboard grid -->
    <div class="debug-grid">
      <!-- Row 1: Summary + Scatter side by side on desktop -->
      <div class="debug-row debug-row--pair">
        <div class="debug-col">
          <CostSummaryCard {summary} />
        </div>
        <div class="debug-col">
          <CostScatter {calls} />
        </div>
      </div>

      <!-- Row 2: Bar chart (full width) -->
      <CostBarChart days={dailyCosts} callsByDate={callsByDate} />

      <!-- Row 3: Call drilldown (full width) -->
      <CostCallDrilldown {calls} />

      <!-- Row 4: Value score dock (full width) -->
      <ValueScoreDock {calls} />
    </div>
  {/if}
</div>

<style>
  .debug-placeholder {
    display: flex;
    align-items: flex-start;
    gap: 14px;
    background: var(--surface);
    border: 1px dashed var(--line-strong);
    border-radius: var(--r-4);
    padding: 28px 24px;
    margin-top: 8px;
  }

  .debug-placeholder-glyph {
    font-size: 28px;
    line-height: 1;
    color: var(--fg-quiet);
    flex-shrink: 0;
  }

  .debug-placeholder-body {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .debug-placeholder-title {
    font: 700 16px/1.2 var(--font-body);
    color: var(--fg-muted);
  }

  .debug-placeholder-sub {
    font: 400 13px/1.5 var(--font-body);
    color: var(--fg-quiet);
  }

  .debug-link {
    color: var(--mash-pulp);
    text-decoration: underline;
    text-decoration-style: dotted;
    text-underline-offset: 3px;
  }

  .debug-link:hover {
    color: var(--mash-pulp-deep);
  }

  .debug-error {
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--ember-soft);
    border: 1px solid var(--ember);
    border-radius: var(--r-3);
    padding: 10px 14px;
    font: 500 12px/1.4 var(--font-mono);
    color: var(--ember);
    margin-bottom: 16px;
  }

  .debug-error-glyph {
    flex-shrink: 0;
    font-size: 14px;
  }

  .debug-grid {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .debug-row--pair {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }

  .debug-col {
    min-width: 0;
  }

  /* On mobile, stack everything */
  @media (max-width: 640px) {
    .debug-row--pair {
      grid-template-columns: 1fr;
    }
  }
</style>
