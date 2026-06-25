<script lang="ts">
  import SectionLabel from '$lib/components/SectionLabel.svelte';
  import {
    failedLabel,
    doneLabel,
    doneSubLabel,
    deriveTotals,
  } from './metricTiles.js';
  import type { Filter, MetricJobCounts } from './metricTiles.js';

  interface Props {
    byJobType: Record<string, MetricJobCounts>;
    approxSongs: number;
    filter: Filter;
    onFilter: (f: Filter) => void;
  }

  let { byJobType, approxSongs, filter, onFilter }: Props = $props();

  const totals = $derived(deriveTotals(byJobType));

  function toggle(f: Filter) {
    onFilter(filter === f ? 'all' : f);
  }

  function tileClass(f: Filter): string {
    const base = 'bg-bg-elevated border rounded-md p-3 text-left w-full transition-colors cursor-pointer';
    if (filter === f) {
      return `${base} border-accent ring-1 ring-accent/40`;
    }
    return `${base} border-border-muted hover:border-border-soft`;
  }
</script>

<div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">

  <!-- Queued tile: dim-sky, NOT yellow/warn -->
  <button
    type="button"
    class={tileClass('queued')}
    onclick={() => toggle('queued')}
    aria-pressed={filter === 'queued'}
  >
    <SectionLabel>Queued</SectionLabel>
    <div class="text-3xl font-display font-bold text-sky/60 mt-1 leading-none">
      {totals.totalQueued}
    </div>
    <div class="font-mono text-[10px] tracking-widest uppercase text-fg-faint mt-2">
      jobs pending
    </div>
  </button>

  <!-- Running tile: sky, NOT orange/accent -->
  <button
    type="button"
    class={tileClass('running')}
    onclick={() => toggle('running')}
    aria-pressed={filter === 'running'}
  >
    <SectionLabel>Running</SectionLabel>
    <div class="text-3xl font-display font-bold text-sky mt-1 leading-none">
      {totals.totalRunning}
    </div>
    <div class="font-mono text-[10px] tracking-widest uppercase text-fg-faint mt-2">
      jobs active
    </div>
  </button>

  <!-- Done tile: health/green; 24h shown separately below the lifetime count -->
  <button
    type="button"
    class={tileClass('done')}
    onclick={() => toggle('done')}
    aria-pressed={filter === 'done'}
  >
    <SectionLabel>Done</SectionLabel>
    <div class="text-3xl font-display font-bold text-health mt-1 leading-none">
      {totals.totalDone}
    </div>
    <div class="font-mono text-[10px] tracking-widest uppercase text-fg-faint mt-1">
      {doneLabel(totals.totalDone, totals.total)}
    </div>
    <!-- 24h sub-stat: SEPARATE from lifetime, per brief constraint -->
    <div class="font-mono text-[10px] tracking-widest uppercase text-fg-faint mt-0.5">
      {doneSubLabel(totals.totalDone24h)}
    </div>
  </button>

  <!-- Failed tile: amber only (NOT warn/yellow); click also sets triageOpen -->
  <button
    type="button"
    class={tileClass('failed')}
    onclick={() => { onFilter('failed'); }}
    aria-pressed={filter === 'failed'}
  >
    <SectionLabel>Failed</SectionLabel>
    <div class="text-3xl font-display font-bold text-amber mt-1 leading-none {totals.totalFailed === 0 ? 'opacity-40' : ''}">
      {totals.totalFailed}
    </div>
    <div class="font-mono text-[10px] tracking-widest uppercase text-fg-faint mt-2">
      {failedLabel(totals.totalFailed, approxSongs)}
    </div>
  </button>

</div>
