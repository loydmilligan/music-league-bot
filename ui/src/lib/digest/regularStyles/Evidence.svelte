<script lang="ts">
  // Shared supporting-evidence list. Every style prints its hero first and then
  // (optionally) the verbatim quotes that back it, so the quote markup lives in
  // one place — emphasis always via markRuns() run arrays, never injected HTML.
  import { markRuns } from '../regularStyles.js';

  let { quotes, highlight = [] }: { quotes: string[]; highlight?: string[] } = $props();
</script>

{#each quotes as quote, i (i)}
  <p class="rs-ev">"{#each markRuns(quote, highlight) as run, k (k)}{#if run.hit}<b class="rs-hl">{run.t}</b>{:else}{run.t}{/if}{/each}"</p>
{/each}

<style>
  .rs-ev {
    margin: 9px 0 0;
    padding-left: 13px;
    border-left: 2px solid var(--mash-pulp);
    color: var(--fg-2);
    font: 400 12.5px/1.5 var(--font-body);
    /* a quote can carry an unbroken 50-char token; break it rather than let it
       widen .dg-export past the export frame and clip the PNG */
    overflow-wrap: break-word;
  }
  /* the tell itself, marked inside its own quote */
  .rs-hl {
    color: var(--amber);
    background: var(--amber-soft);
    border-radius: 3px;
    padding: 0 3px;
    font-weight: 700;
  }
</style>
