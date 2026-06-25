<!--
  JobTypeRollups.svelte — Per-job-type segmented rollup bars for Song Metadata Queue.

  Renders 5 rows (one per job type in JOB_ORDER) each containing:
    [ name + provider/speed | segmented bar | done/total | StatusChip(rollupChip) ]

  lastfm_pop and lastfm_tags are visually bracketed with an amber "shared Last.fm
  rate-limit" annotation — they share the same rate-limit bucket.

  Segment color ladder (monotonic — NO accent/orange as a status):
    done    → bg-health        (green)
    running → bg-sky + .seg--running shimmer
    queued  → bg-sky/40        (dim-sky)
    failed  → bg-amber         (amber for failures only)
    missing → bg-fg-faint/20   (grey, slots with no queue row)
-->
<script lang="ts">
  import StatusChip from '$lib/components/StatusChip.svelte';
  import { rollupChip } from './ladder.js';
  import { segments } from './jobTypeRollups.js';
  import type { JobCounts } from './ladder.js';

  interface JobMeta {
    name: string;
    provider: string;
    speed: string;
  }

  interface Props {
    byJobType: Record<string, JobCounts> | undefined;
    jobMeta: Record<string, JobMeta>;
    jobOrder: ReadonlyArray<string>;
  }

  let { byJobType, jobMeta, jobOrder }: Props = $props();

  // Empty counts fallback
  const EMPTY: JobCounts = { pending: 0, processing: 0, done24h: 0, failed: 0, total: 0 };

  function countsFor(jt: string): JobCounts {
    return byJobType?.[jt] ?? EMPTY;
  }

  function doneCount(c: JobCounts): number {
    return Math.max(0, c.total - c.pending - c.processing - c.failed);
  }

  // Last.fm pair: these two job types share a rate-limit bucket.
  // Rendered inside a single amber bracket block.
  const LASTFM_JOBS = ['lastfm_pop', 'lastfm_tags'] as const;

  // Partition job order into groups:
  //   - non-lastfm jobs are rendered as individual rows
  //   - lastfm jobs are rendered as a single bracketed block
  //
  // We render the bracket inline by detecting consecutive lastfm positions.
</script>

<div>
  <!-- Non-Last.fm rows before the bracket -->
  {#each jobOrder.filter(jt => jt !== 'lastfm_pop' && jt !== 'lastfm_tags') as jobType (jobType)}
    {#if jobOrder.indexOf(jobType) < jobOrder.indexOf('lastfm_pop')}
      {@const meta = jobMeta[jobType]}
      {@const counts = countsFor(jobType)}
      {@const segs = segments(counts)}
      {@const chip = rollupChip(counts)}
      {@const done = doneCount(counts)}
      <div class="flex items-center gap-3 py-2 border-t border-border-muted first:border-t-0">
        <div class="w-52 shrink-0">
          <div class="text-sm text-fg font-medium leading-tight">{meta.name}</div>
          <div class="font-mono text-[10px] text-fg-faint mt-0.5">{meta.provider} · {meta.speed}</div>
        </div>
        <div class="flex-1 h-1.5 bg-bg-elevated rounded-full overflow-hidden flex">
          {#if segs.length === 0}
            <div class="h-full w-full bg-fg-faint/20 rounded-full"></div>
          {:else}
            {#each segs as seg (seg.status)}
              <div class="h-full {seg.className}" style="width: {seg.widthPct.toFixed(2)}%"></div>
            {/each}
          {/if}
        </div>
        <div class="font-mono text-xs text-fg-muted w-16 text-right shrink-0">
          {counts.total === 0 ? '—' : `${done}/${counts.total}`}
        </div>
        <div class="shrink-0">
          <StatusChip label={chip.label} tone={chip.tone} />
        </div>
      </div>
    {/if}
  {/each}

  <!-- Last.fm amber bracket: lastfm_pop + lastfm_tags share a rate-limit -->
  <div class="lastfm-bracket border-t border-border-muted">
    <div class="lastfm-bracket__label pt-1 pb-0.5">
      <span class="font-mono text-[9px] tracking-widest uppercase text-amber">shared Last.fm rate-limit</span>
    </div>
    {#each LASTFM_JOBS as jobType (jobType)}
      {@const meta = jobMeta[jobType]}
      {@const counts = countsFor(jobType)}
      {@const segs = segments(counts)}
      {@const chip = rollupChip(counts)}
      {@const done = doneCount(counts)}
      <div class="flex items-center gap-3 py-2 border-t border-border-muted first:border-t-0">
        <div class="w-52 shrink-0">
          <div class="text-sm text-fg font-medium leading-tight">{meta.name}</div>
          <div class="font-mono text-[10px] text-fg-faint mt-0.5">{meta.provider} · {meta.speed}</div>
        </div>
        <div class="flex-1 h-1.5 bg-bg-elevated rounded-full overflow-hidden flex">
          {#if segs.length === 0}
            <div class="h-full w-full bg-fg-faint/20 rounded-full"></div>
          {:else}
            {#each segs as seg (seg.status)}
              <div class="h-full {seg.className}" style="width: {seg.widthPct.toFixed(2)}%"></div>
            {/each}
          {/if}
        </div>
        <div class="font-mono text-xs text-fg-muted w-16 text-right shrink-0">
          {counts.total === 0 ? '—' : `${done}/${counts.total}`}
        </div>
        <div class="shrink-0">
          <StatusChip label={chip.label} tone={chip.tone} />
        </div>
      </div>
    {/each}
  </div>

  <!-- Non-Last.fm rows after the bracket -->
  {#each jobOrder.filter(jt => jt !== 'lastfm_pop' && jt !== 'lastfm_tags') as jobType (jobType)}
    {#if jobOrder.indexOf(jobType) > jobOrder.indexOf('lastfm_tags')}
      {@const meta = jobMeta[jobType]}
      {@const counts = countsFor(jobType)}
      {@const segs = segments(counts)}
      {@const chip = rollupChip(counts)}
      {@const done = doneCount(counts)}
      <div class="flex items-center gap-3 py-2 border-t border-border-muted first:border-t-0">
        <div class="w-52 shrink-0">
          <div class="text-sm text-fg font-medium leading-tight">{meta.name}</div>
          <div class="font-mono text-[10px] text-fg-faint mt-0.5">{meta.provider} · {meta.speed}</div>
        </div>
        <div class="flex-1 h-1.5 bg-bg-elevated rounded-full overflow-hidden flex">
          {#if segs.length === 0}
            <div class="h-full w-full bg-fg-faint/20 rounded-full"></div>
          {:else}
            {#each segs as seg (seg.status)}
              <div class="h-full {seg.className}" style="width: {seg.widthPct.toFixed(2)}%"></div>
            {/each}
          {/if}
        </div>
        <div class="font-mono text-xs text-fg-muted w-16 text-right shrink-0">
          {counts.total === 0 ? '—' : `${done}/${counts.total}`}
        </div>
        <div class="shrink-0">
          <StatusChip label={chip.label} tone={chip.tone} />
        </div>
      </div>
    {/if}
  {/each}
</div>

<style>
  /* Amber left-border bracket grouping the Last.fm pair.
     Color uses the CSS variable set in colors_and_type.css for consistency. */
  .lastfm-bracket {
    border-left: 2px solid var(--color-amber, #e8a83a);
    padding-left: 0.5rem;
    margin-left: 0.25rem;
  }

  /* Running segment: drives the mq-flow shimmer keyframe from colors_and_type.css.
     Defined here so the class is recognized; the keyframe itself lives in colors_and_type.css. */
  :global(.seg--running) {
    background-image: linear-gradient(
      90deg,
      transparent 0%,
      color-mix(in srgb, white 20%, transparent) 50%,
      transparent 100%
    );
    background-size: 200% 100%;
    animation: mq-flow 2s linear infinite;
  }
</style>
