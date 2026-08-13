<script lang="ts">
  // `refrain` — one fixed token said again and again. The token is centred at
  // display size in amber; the dated occurrences follow as pill chips, with the
  // season count as a pulp chip on the end.
  import { unquote, type RegularEntry } from '../regularStyles.js';
  import Evidence from './Evidence.svelte';

  let { entry, isExport }: { entry: RegularEntry; isExport: boolean } = $props();

  const rf = $derived(entry.refrain);
</script>

<div class="rs" data-style="refrain" data-export={isExport}>
  {#if entry.note}<p class="rs-line">{entry.note}</p>{/if}
  {#if rf}
    <div class="rs-refrain">
      <p class="big">"{unquote(rf.token)}"</p>
      {#if rf.caption}<p class="cap">{rf.caption}</p>{/if}
      {#if rf.occurrences.length || rf.count}
        <div class="tally">
          {#each rf.occurrences as oc, i (i)}
            <span class="oc">{oc}</span>
          {/each}
          {#if rf.count}<span class="oc more">{rf.count}</span>{/if}
        </div>
      {/if}
    </div>
  {/if}
  <Evidence quotes={entry.evidence} highlight={entry.highlight} />
</div>

<style>
  .rs-line {
    margin: 2px 0 6px;
    color: var(--fg-2);
    font: 500 13px/1.4 var(--font-body);
    overflow-wrap: break-word;
  }
  .rs-refrain {
    padding: 6px 0 2px;
    text-align: center;
  }
  /* display-size type with no space in it would otherwise widen the export
     frame and clip the PNG — let the token break rather than the layout */
  .rs-refrain .big {
    margin: 0;
    color: var(--amber);
    font: 800 clamp(38px, 10vw, 54px) / 0.9 var(--font-display);
    letter-spacing: -0.02em;
    overflow-wrap: break-word;
  }
  .rs-refrain .cap {
    overflow-wrap: break-word;
    margin: 8px 0 0;
    color: var(--fg-muted);
    font: 400 12px/1.5 var(--font-mono);
  }
  .tally {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 6px;
    margin-top: 15px;
  }
  .oc {
    max-width: 100%;
    overflow-wrap: break-word;
    padding: 5px 10px;
    background: var(--surface-2);
    border: 1px solid var(--line-strong);
    border-radius: 999px;
    color: var(--fg-muted);
    font: 600 10px/1 var(--font-mono);
  }
  .oc.more {
    border-color: var(--mash-pulp);
    color: var(--mash-pulp);
  }
</style>
