<script lang="ts">
  // `roster-map` — real name → what they actually call them. Three columns:
  // the known-correct form (right-aligned, muted), an arrow, the alias in amber.
  import type { RegularEntry } from '../regularStyles.js';
  import Evidence from './Evidence.svelte';

  let { entry, isExport }: { entry: RegularEntry; isExport: boolean } = $props();

  const line = $derived(entry.summary || entry.note);
</script>

<div class="rs" data-style="roster-map" data-export={isExport}>
  {#if line}<p class="rs-line">{line}</p>{/if}
  <div class="rs-map">
    {#each entry.pairs as p, i (i)}
      <span class="real">{p.real}</span>
      <span class="ar" aria-hidden="true">→</span>
      <span class="alias">{p.alias}</span>
    {/each}
  </div>
  <Evidence quotes={entry.evidence} highlight={entry.highlight} />
</div>

<style>
  .rs-line {
    margin: 2px 0 10px;
    color: var(--fg-2);
    font: 500 13px/1.4 var(--font-body);
    overflow-wrap: anywhere;
  }
  .rs-map {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    gap: 9px 14px;
    align-items: baseline;
    margin-top: 4px;
  }
  /* A minted nickname is exactly the kind of value that arrives as one
     unbroken 50-character token. Without min-width:0 a grid item refuses to
     shrink below its content, which widens .dg-export past the 800px frame and
     silently clips the exported PNG — so every cell may break mid-token. */
  .rs-map > * {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .rs-map .real {
    text-align: right;
    color: var(--fg-quiet);
    font: 500 13px/1.2 var(--font-mono);
  }
  .rs-map .ar {
    text-align: center;
    color: var(--line-strong);
    font: 400 12px/1.2 var(--font-mono);
  }
  .rs-map .alias {
    color: var(--amber);
    font: 700 14px/1.2 var(--font-mono);
  }
</style>
