<script lang="ts">
  // `spotlight` — the message IS the tell, so it is set at display size in
  // amber with a mono caption beside it, then one supporting quote.
  import { unquote, type RegularEntry } from '../regularStyles.js';
  import Evidence from './Evidence.svelte';

  let { entry, isExport }: { entry: RegularEntry; isExport: boolean } = $props();

  const spot = $derived(entry.spotlight);
</script>

<div class="rs" data-style="spotlight" data-export={isExport}>
  {#if entry.note}<p class="rs-line">{entry.note}</p>{/if}
  {#if spot}
    <div class="rs-spot">
      <span class="big">"{unquote(spot.text)}"</span>
      {#if spot.caption}<span class="cap">{spot.caption}</span>{/if}
    </div>
  {/if}
  <Evidence quotes={entry.evidence} highlight={entry.highlight} />
</div>

<style>
  .rs-line {
    margin: 2px 0 10px;
    color: var(--fg-2);
    font: 500 13px/1.4 var(--font-body);
    overflow-wrap: anywhere;
  }
  .rs-spot {
    display: flex;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
    padding: 14px 18px;
    background: var(--surface-2);
    border: 1px solid var(--line-strong);
    border-radius: 9px;
  }
  /* a long unbroken utterance must break, not widen the 800px export frame */
  .rs-spot > * {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .rs-spot .big {
    color: var(--amber);
    font: 800 clamp(30px, 7vw, 40px) / 0.9 var(--font-display);
    letter-spacing: -0.01em;
  }
  .rs-spot .cap {
    color: var(--fg-muted);
    font: 400 11px/1.5 var(--font-mono);
  }
</style>
