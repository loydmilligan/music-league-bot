<script lang="ts" module>
  // ── next-round-viz · sprint-17 (viz) ──────────────────────────────────────
  // Next-round preview — teases the upcoming round: theme, deadlines, and
  // submissions-so-far. Implements the variant slot interface
  // (`VisualComponentProps`, variants.ts); data-driven via the section's
  // `visualData` → the `data` prop. Backend `nextRound` payload:
  //   { theme, submissionDeadline, votingDeadline, submissionsSoFar } | null
  // Renders NOTHING when the payload is null/empty (current round is the latest).
  //
  // TWO render modes off one component:
  //   • WEB (interactive): the deadline as a relative countdown ("closes in
  //     3 days") alongside the absolute date.
  //   • EXPORT (PNG/PDF, ?export=1): the absolute date only — a static artifact
  //     shouldn't bake in a "3 days" that's stale by the time it's shared.
  import type { VisualComponentProps } from './variants.js';

  export type NextRound = {
    theme?: string | null;
    submissionDeadline?: string | null;
    votingDeadline?: string | null;
    deadline?: string | null;
    submissionsSoFar?: number | null;
  };
</script>

<script lang="ts">
  import { page } from '$app/state';

  let { data }: VisualComponentProps = $props();

  const nr = $derived((data ?? null) as NextRound | null);
  const theme = $derived(nr?.theme?.trim() ?? '');
  const primaryDeadline = $derived(nr?.submissionDeadline ?? nr?.deadline ?? null);
  const hasContent = $derived(!!nr && (!!theme || !!primaryDeadline || !!nr.votingDeadline));

  const isExport = $derived(page?.url?.searchParams?.get('export') === '1');

  const deadlineMs = $derived.by(() => {
    if (!primaryDeadline) return NaN;
    const t = Date.parse(primaryDeadline);
    return Number.isFinite(t) ? t : NaN;
  });

  function absDate(iso: string | null | undefined): string {
    if (!iso) return '';
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) return '';
    try {
      return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }).format(new Date(ms));
    } catch {
      return '';
    }
  }

  const absSubmissionDeadline = $derived(absDate(primaryDeadline));
  const absVotingDeadline = $derived(absDate(nr?.votingDeadline));

  // Relative countdown (web only — would go stale in a shared static artifact).
  const relDeadline = $derived.by(() => {
    if (Number.isNaN(deadlineMs)) return '';
    const diff = deadlineMs - Date.now();
    if (diff <= 0) return 'closed';
    const mins = Math.round(diff / 60000);
    const hrs = Math.round(diff / 3600000);
    const days = Math.round(diff / 86400000);
    if (mins < 60) return `closes in ${mins} min`;
    if (hrs < 24) return `closes in ${hrs} hr${hrs === 1 ? '' : 's'}`;
    return `closes in ${days} day${days === 1 ? '' : 's'}`;
  });

  const subs = $derived(typeof nr?.submissionsSoFar === 'number' ? nr.submissionsSoFar : null);
</script>

{#if hasContent}
  <div class="nr" data-component="next-round-viz">
    <div class="nr-head">
      <span class="nr-eyebrow">▶ Up next</span>
      {#if !isExport && relDeadline}
        <span class="nr-countdown" class:is-closed={relDeadline === 'closed'}>{relDeadline}</span>
      {/if}
    </div>

    {#if theme}
      <p class="nr-theme">{theme}</p>
    {/if}

    <div class="nr-meta">
      {#if absSubmissionDeadline}
        <span class="nr-chip">
          <span class="nr-chip-lbl">submissions</span>
          <span class="nr-chip-val">{absSubmissionDeadline}</span>
        </span>
      {/if}
      {#if absVotingDeadline}
        <span class="nr-chip">
          <span class="nr-chip-lbl">voting</span>
          <span class="nr-chip-val">{absVotingDeadline}</span>
        </span>
      {/if}
      {#if subs !== null}
        <span class="nr-chip">
          <span class="nr-chip-lbl">submissions so far</span>
          <span class="nr-chip-val">{subs}</span>
        </span>
      {/if}
    </div>
  </div>
{/if}

<style>
  .nr {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 14px 16px;
    background: var(--mash-pulp-soft);
    border: 1px solid var(--mash-pulp-edge);
    border-radius: var(--r-3);
  }
  .nr-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
  }
  .nr-eyebrow {
    font: 700 9px/1 var(--font-mono);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--mash-pulp);
  }
  .nr-countdown {
    font: 600 10px/1 var(--font-mono);
    color: var(--amber);
    letter-spacing: 0.02em;
  }
  .nr-countdown.is-closed {
    color: var(--fg-quiet);
  }
  .nr-theme {
    margin: 0;
    font: 700 18px/1.2 var(--font-body);
    color: var(--fg);
    letter-spacing: -0.01em;
  }
  .nr-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 18px;
  }
  .nr-chip {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .nr-chip-lbl {
    font: 700 8.5px/1.2 var(--font-mono);
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--fg-quiet);
  }
  .nr-chip-val {
    font: 700 13px/1 var(--font-mono);
    color: var(--fg-2);
    font-variant-numeric: tabular-nums;
  }
</style>
