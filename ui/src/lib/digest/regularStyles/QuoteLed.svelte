<script lang="ts">
  // `quote-led` — the shelf's default and its fallback. Hero: an optional
  // one-line note plus the verbatim quotes themselves. Every other style
  // degrades to this one when its payload is missing (see resolveStyle).
  import type { RegularEntry } from '../regularStyles.js';
  import Evidence from './Evidence.svelte';

  let { entry, isExport }: { entry: RegularEntry; isExport: boolean } = $props();
</script>

<div class="rs" data-style="quote-led" data-export={isExport}>
  {#if entry.note}<p class="rs-line">{entry.note}</p>{/if}
  <Evidence quotes={entry.evidence} highlight={entry.highlight} />
  {#if !entry.note && !entry.evidence.length}
    <p class="rs-none">(no evidence)</p>
  {:else if entry.highlight.length}
    <p class="rs-leg"><span class="sw" aria-hidden="true"></span>amber = the tell itself, matched as whole words</p>
  {/if}
</div>

<style>
  .rs-line {
    margin: 2px 0 4px;
    color: var(--fg-2);
    font: 500 13px/1.4 var(--font-body);
    overflow-wrap: anywhere;
  }
  .rs-none {
    margin: 2px 0 0;
    color: var(--fg-quiet);
    font: 400 12px/1.5 var(--font-body);
    font-style: italic;
  }
  .rs-leg {
    display: flex;
    align-items: center;
    gap: 7px;
    margin: 12px 0 0;
    color: var(--fg-quiet);
    font: 400 10px/1.5 var(--font-mono);
  }
  .rs-leg .sw {
    display: inline-block;
    width: 11px;
    height: 11px;
    border-radius: 3px;
    background: var(--amber-soft);
    border: 1px solid var(--amber);
  }
</style>
