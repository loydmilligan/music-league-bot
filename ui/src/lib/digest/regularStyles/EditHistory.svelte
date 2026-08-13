<script lang="ts">
  // `edit-history` — the HERO is the message itself, printed with its repairs
  // redlined: the wrong token struck through in --ember, the fix in --moss.
  // ("Show the final message with the red strikethroughs.")
  //
  // Everything else is support and is deliberately quiet — the owner's note on
  // the first build was that the entry was too busy to read: note + two display
  // numbers + a boxed example + a quote list is five competing things. Order is
  // now one-line note → the redline → a single compact stats line → evidence
  // only if the author supplied any.
  import { splitRepairRuns, unquote, type RegularEntry } from '../regularStyles.js';
  import Evidence from './Evidence.svelte';

  let { entry, isExport }: { entry: RegularEntry; isExport: boolean } = $props();

  const ex = $derived(entry.example);
  const runs = $derived(ex ? splitRepairRuns(unquote(ex.text), ex.repairs) : []);
  const hasExample = $derived(!!ex && runs.some((r) => r.t || r.repair));
</script>

<div class="rs" data-style="edit-history" data-export={isExport}>
  {#if entry.note}<p class="rs-line">{entry.note}</p>{/if}

  {#if hasExample && ex}
    <div class="rs-edex">
      <p class="edline">"{#each runs as run, i (i)}{#if run.repair}<span class="rl">{run.t}</span><span class="fix">{run.repair.now}</span>{:else}{run.t}{/if}{/each}"</p>
      {#if ex.caption}<p class="edcap">{ex.caption}</p>{/if}
    </div>
  {/if}

  {#if entry.stats.length}
    <p class="rs-stats">
      {#each entry.stats as s, i (i)}<span class="e"
          ><span class="v">{s.value}</span> <span class="l">{s.label}</span></span
        >{/each}
    </p>
  {/if}

  <Evidence quotes={entry.evidence} highlight={entry.highlight} />
</div>

<style>
  .rs-line {
    margin: 2px 0 10px;
    color: var(--fg-2);
    font: 500 13px/1.4 var(--font-body);
    overflow-wrap: break-word;
  }

  /* ── the hero: the message, as sent and as repaired ─────────────────────── */
  /* Panel per the CD mock: raised surface, hairline border, no side accent.
     The redline reads as the hero from its type size and its position directly
     under the note — it doesn't need a coloured tab, and the ember is already
     spent on the struck tokens inside. */
  .rs-edex {
    padding: 16px 18px;
    background: var(--surface-2);
    border: 1px solid var(--line-strong);
    border-radius: 9px;
  }
  /* the repaired tokens are misspellings — exactly the values that arrive as
     one long unbroken string — so break them rather than the export frame */
  .edline {
    margin: 0;
    color: var(--fg);
    font: 400 17px/1.65 var(--font-body);
    overflow-wrap: break-word;
  }
  /* the wrong token, kept visible and struck */
  .rl {
    margin-right: 4px;
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
    overflow-wrap: break-word;
  }

  /* ── support: one quiet line, not two display numbers ───────────────────── */
  .rs-stats {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 18px;
    margin: 11px 0 0;
    overflow-wrap: break-word;
  }
  .rs-stats .e {
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
  }
  .rs-stats .v {
    color: var(--fg-2);
    font: 700 13px/1.3 var(--font-mono);
    font-variant-numeric: tabular-nums;
  }
  .rs-stats .l {
    color: var(--fg-quiet);
    font: 500 10px/1.3 var(--font-mono);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    overflow-wrap: break-word;
  }
</style>
