<script lang="ts" module>
  // ── discoverability-viz · sprint-17 (viz) ─────────────────────────────────
  // "Tastemaker leaderboard" — a season-level per-player obscurity ranking:
  // who submits songs nobody's heard (high obscurity) vs. the same old crowd-
  // pleasers everyone knows. Horizontal bars ranked most-obscure first.
  //
  // Implements the variant slot interface (`VisualComponentProps`, variants.ts).
  // Data-driven via the section's `visualData` → arrives on the `data` prop
  // (same mechanism as StandingsChart). Backend `discoverability` payload:
  //   [{ name: string, obscurityScore: 0–100, submissionCount: number,
  //      avgPopularity: number }]   — most-obscure first.
  // (`{ discoverability: [...] }` wrapper also tolerated.)
  // obscurityScore = mean of (100 − Last.fm popularity proxy) across the
  // player's season submissions. Self-suppresses when the payload is empty.
  //
  // TWO render modes off one component:
  //   • WEB (interactive): bars + the avgPopularity detail revealed on row hover.
  //   • EXPORT (PNG/PDF, ?export=1): the same bars with avgPopularity shown
  //     inline/static (no hover in a flat artifact).
  import type { VisualComponentProps } from './variants.js';

  export type TastemakerRow = {
    name?: string;
    obscurityScore?: number;
    submissionCount?: number;
    avgPopularity?: number;
  };
</script>

<script lang="ts">
  import { page } from '$app/state';

  let { data }: VisualComponentProps = $props();

  const rows = $derived.by<TastemakerRow[]>(() => {
    const d = data as { discoverability?: unknown } | unknown[] | null | undefined;
    const arr = Array.isArray(d) ? d : Array.isArray(d?.discoverability) ? d.discoverability : [];
    return [...(arr as TastemakerRow[])]
      .filter((r) => r && typeof r.obscurityScore === 'number')
      .sort((a, b) => (b.obscurityScore ?? 0) - (a.obscurityScore ?? 0));
  });

  const isExport = $derived(page?.url?.searchParams?.get('export') === '1');
  const clamp = (n: number) => Math.max(0, Math.min(100, n));
  const round1 = (n: number | undefined) => (typeof n === 'number' ? Math.round(n) : '—');
</script>

{#if rows.length}
  <div class="tl" class:is-static={isExport} data-component="discoverability-viz">
    <div class="tl-axis" aria-hidden="true">
      <span class="tl-axis-end">obscure picks</span>
      <span class="tl-axis-track"><span class="tl-axis-arrow">←</span><span class="tl-axis-arrow"
          >→</span
        ></span>
      <span class="tl-axis-end tl-axis-end--right">crowd-pleasers</span>
    </div>

    <ol class="tl-rows">
      {#each rows as r, i (r.name ?? i)}
        {@const score = clamp(r.obscurityScore ?? 0)}
        <li class="tl-row">
          <div class="tl-head">
            <span class="tl-rank">{i + 1}</span>
            <span class="tl-name" title={r.name ?? ''}>{r.name ?? '—'}</span>
            <span class="tl-score" title="obscurity score (0–100)">{round1(r.obscurityScore)}</span>
          </div>
          <div
            class="tl-track"
            role="img"
            aria-label={`${r.name}: obscurity ${round1(r.obscurityScore)} of 100, ${r.submissionCount ?? 0} submissions`}
          >
            <div class="tl-bar" style:width={`${score}%`}></div>
          </div>
          <div class="tl-detail">
            <span class="tl-pills">{r.submissionCount ?? 0} pick{(r.submissionCount ?? 0) === 1 ? '' : 's'}</span>
            <span class="tl-pills tl-pills--pop">avg popularity {round1(r.avgPopularity)}/100</span>
          </div>
        </li>
      {/each}
    </ol>
  </div>
{/if}

<style>
  .tl {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  /* ── axis label ──────────────────────────────────────────────────────── */
  .tl-axis {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 10px;
    font: 700 9px/1 var(--font-mono);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--fg-quiet);
  }
  .tl-axis-end {
    color: var(--mash-pulp);
  }
  .tl-axis-end--right {
    color: var(--fg-muted);
    text-align: right;
  }
  .tl-axis-track {
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-top: 1px dashed var(--line);
    padding-top: 2px;
  }
  .tl-axis-arrow {
    font-size: 10px;
    color: var(--fg-quiet);
  }

  /* ── rows ────────────────────────────────────────────────────────────── */
  .tl-rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .tl-row {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .tl-head {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  .tl-rank {
    font: 700 11px/1 var(--font-mono);
    color: var(--fg-quiet);
    font-variant-numeric: tabular-nums;
    min-width: 14px;
  }
  .tl-name {
    flex: 1;
    font: 600 12.5px/1.2 var(--font-body);
    color: var(--fg);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tl-score {
    font: 700 13px/1 var(--font-mono);
    color: var(--mash-pulp);
    font-variant-numeric: tabular-nums;
  }
  .tl-track {
    height: 12px;
    border-radius: var(--r-1);
    background: var(--ink-2);
    overflow: hidden;
  }
  .tl-bar {
    height: 100%;
    min-width: 2px;
    background: linear-gradient(90deg, var(--mash-pulp), var(--mash-pulp-deep));
    border-radius: var(--r-1);
  }

  /* avgPopularity detail — hover-reveal on web, always-on in static export */
  .tl-detail {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 10px;
    max-height: 0;
    opacity: 0;
    overflow: hidden;
    transition:
      max-height var(--dur-fast) var(--ease-out),
      opacity var(--dur-fast) var(--ease-out);
  }
  .tl-row:hover .tl-detail,
  .tl-row:focus-within .tl-detail {
    max-height: 32px;
    opacity: 1;
  }
  .tl.is-static .tl-detail {
    max-height: none;
    opacity: 1;
  }
  .tl-pills {
    font: 500 10px/1.4 var(--font-mono);
    color: var(--fg-quiet);
    letter-spacing: 0.02em;
  }
  .tl-pills--pop {
    color: var(--fg-muted);
  }
</style>
