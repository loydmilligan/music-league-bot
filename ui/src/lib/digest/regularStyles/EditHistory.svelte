<script lang="ts">
  // `edit-history` — two stat lines, then one message shown with its repairs
  // redlined: the wrong token struck through in --ember, the fix in --moss.
  // The runs come from splitRepairRuns(); nothing is injected as HTML.
  import { splitRepairRuns, unquote, type RegularEntry } from '../regularStyles.js';
  import Evidence from './Evidence.svelte';

  let { entry, isExport }: { entry: RegularEntry; isExport: boolean } = $props();

  const ex = $derived(entry.example);
  const runs = $derived(ex ? splitRepairRuns(unquote(ex.text), ex.repairs) : []);
</script>

<div class="rs" data-style="edit-history" data-export={isExport}>
  {#if entry.note}<p class="rs-line">{entry.note}</p>{/if}

  {#if entry.stats.length}
    <div class="rs-stats">
      {#each entry.stats as s, i (i)}
        <div class="e"><span class="v">{s.value}</span><span class="l">{s.label}</span></div>
      {/each}
    </div>
  {/if}

  {#if ex && runs.some((r) => r.t || r.repair)}
    <div class="rs-edex">
      <p class="lb">the edit history</p>
      <p class="edline">"{#each runs as run, i (i)}{#if run.repair}<span class="rl">{run.t}</span><span class="fix">{run.repair.now}</span>{:else}{run.t}{/if}{/each}"</p>
      {#if ex.caption}<p class="edcap">{ex.caption}</p>{/if}
    </div>
  {/if}

  <Evidence quotes={entry.evidence} highlight={entry.highlight} />
</div>

<style>
  .rs-line {
    margin: 2px 0 8px;
    color: var(--fg-2);
    font: 500 13px/1.4 var(--font-body);
    overflow-wrap: break-word;
  }
  .rs-stats {
    display: flex;
    flex-wrap: wrap;
    gap: 26px;
    margin: 2px 0 16px;
  }
  .rs-stats .e {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  .rs-stats .v {
    color: var(--fg);
    font: 800 26px/1 var(--font-display);
    font-variant-numeric: tabular-nums;
  }
  .rs-stats .l {
    /* The mock's 11ch is narrower than the word "apostrophes" once the
       uppercase tracking is applied, which forced a mid-word break on the real
       R147 label regardless of wrap mode. Sized to the longest word a curated
       stat label realistically carries. */
    max-width: 15ch;
    overflow-wrap: break-word;
    color: var(--fg-quiet);
    font: 700 9px/1.3 var(--font-mono);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .rs-edex {
    padding: 14px 16px;
    background: var(--surface-2);
    border: 1px solid var(--line-strong);
    border-radius: 9px;
  }
  .rs-edex .lb {
    margin: 0 0 9px;
    color: var(--fg-quiet);
    font: 700 8.5px/1 var(--font-mono);
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  /* the repaired tokens are misspellings — exactly the values that arrive as
     one long unbroken string — so break them rather than the export frame */
  .edline {
    margin: 0;
    color: var(--fg);
    font: 400 15px/1.7 var(--font-body);
    overflow-wrap: break-word;
  }
  /* the wrong token, kept visible and struck */
  .rl {
    margin-right: 3px;
    color: var(--ember);
    text-decoration: line-through;
    text-decoration-color: var(--ember);
    opacity: 0.8;
  }
  .fix {
    color: var(--moss);
    font-weight: 700;
  }
  .edcap {
    margin: 10px 0 0;
    color: var(--fg-quiet);
    font: 400 10.5px/1.5 var(--font-mono);
  }
</style>
