<script lang="ts">
  // `call-response` — a small mono prompt feeding a big right-aligned reply.
  // The tell is the *answer*, so the reply carries the display type in amber.
  import { unquote, type RegularEntry } from '../regularStyles.js';
  import Evidence from './Evidence.svelte';

  let { entry, isExport }: { entry: RegularEntry; isExport: boolean } = $props();

  /** "Matt: well that was…" → the speaker prefix is set apart, not injected. */
  function splitWho(prompt: string): { who: string; rest: string } {
    const p = unquote(prompt);
    const m = p.match(/^([^:]{1,24}):\s*([\s\S]*)$/);
    return m ? { who: `${m[1]}:`, rest: ` ${m[2]}` } : { who: '', rest: p };
  }
</script>

<div class="rs" data-style="call-response" data-export={isExport}>
  {#if entry.note}<p class="rs-line">{entry.note}</p>{/if}
  <div class="rs-cr">
    {#each entry.exchanges as x, i (i)}
      {@const p = splitWho(x.prompt)}
      <div class="crx">
        <span class="prompt">{#if p.who}<b class="who">{p.who}</b>{/if}{p.rest}</span>
        <span class="reply">"{unquote(x.reply)}"</span>
      </div>
    {/each}
  </div>
  <Evidence quotes={entry.evidence} highlight={entry.highlight} />
</div>

<style>
  .rs-line {
    margin: 2px 0 6px;
    color: var(--fg-2);
    font: 500 13px/1.4 var(--font-body);
    overflow-wrap: break-word;
  }
  .rs-cr {
    display: flex;
    flex-direction: column;
  }
  .crx {
    display: grid;
    /* the prompt keeps a floor of the row so a freakishly long reply squeezes
       itself (breaking, since it's one token) instead of crushing the prompt
       column down to a couple of characters */
    grid-template-columns: minmax(30%, 1fr) auto;
    gap: 16px;
    align-items: center;
    padding: 10px 0;
  }
  .crx + .crx {
    border-top: 1px solid var(--line);
  }
  /* grid items must be allowed to shrink below their content, or one long
     unbroken reply widens .dg-export past the 800px frame and clips the PNG.
     break-word, never `anywhere` — `anywhere` also collapses min-content
     sizing, which breaks an ordinary multi-word reply mid-word. */
  .crx > * {
    min-width: 0;
    overflow-wrap: break-word;
  }
  .prompt {
    color: var(--fg-quiet);
    font: 400 12px/1.5 var(--font-mono);
  }
  .prompt .who {
    color: var(--fg-muted);
    font-weight: 700;
  }
  /* deliberately NOT white-space: nowrap — real replies are one or two words
     and stay on one line anyway; nowrap would guarantee overflow on a long one */
  .reply {
    color: var(--amber);
    font: 800 clamp(26px, 6.5vw, 34px) / 0.9 var(--font-display);
    letter-spacing: -0.01em;
    text-align: right;
  }

  /* 430px reflow: stack the reply under its prompt rather than squeeze it.
     The mobile PNG renders at a 520px viewport with the .dg-export--mobile
     frame class, so the media query alone would never fire there. */
  :global(.dg-export--mobile) .crx {
    grid-template-columns: 1fr;
    gap: 6px;
  }
  :global(.dg-export--mobile) .reply {
    text-align: left;
  }
  @media (max-width: 460px) {
    .crx {
      grid-template-columns: 1fr;
      gap: 6px;
    }
    .reply {
      text-align: left;
    }
  }
</style>
