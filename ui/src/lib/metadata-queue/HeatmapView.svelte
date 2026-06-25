<!--
  HeatmapView.svelte — Children-of-scope × 5-job-type completion grid.

  Rows: children (leagues at all scope, seasons at league scope, rounds at
        season scope, songs at round scope via coverageMatrix).
  Columns: 5 job types (ytm, lastfm_pop, lastfm_tags, lyrics, audio).

  Cell colour: grey→green scale via heatBucket (done/total %).
  Cell borders:
    sky border   → processing > 0 (running, takes priority)
    amber border → failed > 0 (failure, secondary)
    no border    → idle / done

  Monotonic design: accent is only used for the active toggle affordance
  in the parent; no accent used as a status color here.
-->
<script lang="ts">
  import { heatBucket, cellBorder, HEATMAP_JOB_ORDER } from './heatmapView.js';
  import type { ChildRollup } from '$lib/db/metadataQueue.js';
  import type { CoverageRow } from '$lib/db/metadataQueue.js';

  interface Props {
    /** Children with per-job-type counts. Used at all/league/season scope. */
    children?: ChildRollup[];
    /**
     * Coverage matrix from poll data. Used at round scope (songs as rows).
     * When provided, takes precedence over `children`.
     */
    coverageMatrix?: CoverageRow[];
    /** Job display metadata: name, provider, speed */
    jobMeta: Record<string, { name: string; provider: string; speed: string }>;
  }

  let { children = [], coverageMatrix, jobMeta }: Props = $props();

  const JOB_ORDER = HEATMAP_JOB_ORDER;

  // Build rows from coverageMatrix (round scope) or children (other scopes).
  // For coverageMatrix, transform the per-job status into counts (0 or 1) so
  // we can reuse the same cell rendering logic.
  interface HeatRow {
    id: string | number;
    label: string;
    cells: Array<{
      jobType: string;
      donePct: number;
      processing: number;
      failed: number;
    }>;
  }

  const rows = $derived.by<HeatRow[]>(() => {
    if (coverageMatrix && coverageMatrix.length > 0) {
      // Round scope: each song is a row, each cell is 0% or 100%
      return coverageMatrix.map(song => ({
        id: song.spotify_uri,
        label: song.title ?? song.spotify_uri.split(':').pop() ?? song.spotify_uri,
        cells: JOB_ORDER.map(jt => {
          const status = song.jobs[jt] ?? 'missing';
          return {
            jobType: jt,
            donePct: status === 'done' ? 100 : 0,
            processing: status === 'processing' ? 1 : 0,
            failed: status === 'failed' ? 1 : 0,
          };
        }),
      }));
    }
    // Other scopes: use children with per-job-type counts
    return children.map(child => ({
      id: child.id,
      label: child.name,
      cells: JOB_ORDER.map(jt => {
        const counts = child.byJobType[jt];
        if (!counts || counts.total === 0) {
          return { jobType: jt, donePct: 0, processing: 0, failed: 0 };
        }
        const donePct = Math.round((counts.done / counts.total) * 100);
        return {
          jobType: jt,
          donePct,
          processing: counts.processing,
          failed: counts.failed,
        };
      }),
    }));
  });

  const isEmpty = $derived(rows.length === 0);
</script>

<div class="overflow-x-auto">
  {#if isEmpty}
    <p class="text-fg-faint font-mono text-sm italic py-4">No data at this scope.</p>
  {:else}
    <table class="w-full text-xs border-collapse">
      <!-- Column headers -->
      <thead>
        <tr>
          <th class="text-left font-mono text-[10px] tracking-widest uppercase text-fg-faint pb-2 pr-3 w-36 shrink-0">
            Name
          </th>
          {#each JOB_ORDER as jt (jt)}
            <th class="font-mono text-[9px] tracking-widest uppercase text-fg-faint pb-2 px-1 text-center min-w-[3rem]">
              {jobMeta[jt]?.name.split(' ')[0] ?? jt}
            </th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each rows as row (row.id)}
          <tr class="border-t border-border-muted first:border-t-0 hover:bg-surface-hover/30 transition-colors">
            <!-- Row label -->
            <td class="py-1.5 pr-3 font-mono text-[11px] text-fg-muted truncate max-w-[9rem]" title={String(row.label)}>
              {row.label}
            </td>
            <!-- Job-type cells -->
            {#each row.cells as cell (cell.jobType)}
              {@const bgClass = heatBucket(cell.donePct)}
              {@const border = cellBorder({ processing: cell.processing, failed: cell.failed })}
              <td class="py-1.5 px-1 text-center">
                <div
                  class="mx-auto w-8 h-5 rounded-sm {bgClass} transition-colors {border === 'sky' ? 'ring-1 ring-sky' : border === 'amber' ? 'ring-1 ring-amber' : ''}"
                  title="{cell.donePct}% done{cell.processing > 0 ? ' · running' : ''}{cell.failed > 0 ? ` · ${cell.failed} failed` : ''}"
                ></div>
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>

    <!-- Legend -->
    <div class="mt-3 flex flex-wrap items-center gap-4 text-[10px] font-mono text-fg-faint">
      <div class="flex items-center gap-1">
        <div class="w-4 h-3 rounded-sm bg-fg-faint/15"></div>
        <span>0%</span>
      </div>
      <div class="flex items-center gap-1">
        <div class="w-4 h-3 rounded-sm bg-health/40"></div>
        <span>partial</span>
      </div>
      <div class="flex items-center gap-1">
        <div class="w-4 h-3 rounded-sm bg-health"></div>
        <span>100%</span>
      </div>
      <div class="flex items-center gap-1">
        <div class="w-4 h-3 rounded-sm bg-fg-faint/15 ring-1 ring-sky"></div>
        <span>running</span>
      </div>
      <div class="flex items-center gap-1">
        <div class="w-4 h-3 rounded-sm bg-fg-faint/15 ring-1 ring-amber"></div>
        <span>failed</span>
      </div>
    </div>
  {/if}
</div>
