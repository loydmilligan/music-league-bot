<script lang="ts">
  // D2 — voter×submitter points heatmap + auto-surfaced callouts (no lens toggle,
  // per README/DECISION_LOG). Reuses digest.css .dgA-matrix/.dgA-mx-* classes;
  // grid-template-columns is set inline for the variable roster width.
  import { buildCallouts, pointIntensity, type Matrix } from '$lib/league-research/viz';

  let { roster, matrix, maxPoints }: { roster: string[]; matrix: Matrix; maxPoints: number } = $props();

  const callouts = $derived(buildCallouts(matrix, roster));
  // Every column is minmax(18px, 1fr) so the grid divides the container instead of
  // sizing to its content: a 28-player roster fits 926px without horizontal scroll.
  // The 18px floor only bites below ~600px, where the wrapper's scroll takes over.
  const cols = $derived(`minmax(56px, 4.5fr) repeat(${roster.length}, minmax(18px, 1fr))`);
  const tip = (v: string, s: string, pts: number, count: number) =>
    `${v} → ${s}: ${pts} pts across ${count} vote${count === 1 ? '' : 's'}`;
</script>

{#if !roster.length}
  <p class="lr-note">No submissions in this scope yet.</p>
{:else}
  <div class="lr-mx-scroll">
    <div class="dgA-matrix">
      <div class="lr-mx-grid" style={`grid-template-columns:${cols}`}>
        <div class="dgA-mx-cell lr-corner" title="rows = voter · columns = submitter">▦</div>
        {#each roster as sName}
          <div class="dgA-mx-cell dgA-mx-head lr-vhead" title={sName}><span>{sName}</span></div>
        {/each}

        {#each roster as vName, r}
          <div class="dgA-mx-cell dgA-mx-row-head lr-clip" title={vName}><span>{vName}</span></div>
          {#each roster as sName, c}
            {@const cell = matrix[r][c]}
            {#if r === c}
              <div class="dgA-mx-cell is-self" aria-hidden="true"></div>
            {:else if !cell || cell.points === null}
              <div class="dgA-mx-cell lr-empty"></div>
            {:else if cell.points < 0}
              <div class="dgA-mx-cell is-down" title={tip(vName, sName, cell.points, cell.count)}>{cell.points}</div>
            {:else}
              <div class="dgA-mx-cell" data-p={pointIntensity(cell.points, maxPoints)} title={tip(vName, sName, cell.points, cell.count)}>{cell.points}</div>
            {/if}
          {/each}
        {/each}
      </div>
    </div>
  </div>

  {#if callouts.length}
    <div class="dgA-mx-callouts">
      {#each callouts as co}
        <div class="dgA-mx-callout">
          <span class="dgA-mx-callout-tag">{co.tag}</span>
          <span class="dgA-mx-callout-text">{co.text}</span>
        </div>
      {/each}
    </div>
  {/if}
{/if}

<style>
  .lr-mx-scroll {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }
  /* width:100% (not max-content) is what makes the grid DIVIDE the container
     instead of sizing every 1fr column to its header text. min-width:min-content
     is the escape hatch: it resolves to the sum of the track minimums, so on a
     phone — where 28 columns can't fit at 18px — the grid outgrows the wrapper
     and .lr-mx-scroll scrolls it rather than .dgA-matrix clipping it away. */
  .lr-mx-scroll :global(.dgA-matrix) {
    width: 100%;
    min-width: min-content;
  }
  .lr-mx-grid {
    display: grid;
    width: 100%;
    min-width: min-content;
  }
  /* Column headers run bottom-to-top so a full name fits above a ~30px column.
     Horizontal headers were what forced the grid to content width — a roster of
     28 made it 4011px wide inside a 926px panel. */
  .lr-vhead {
    writing-mode: vertical-rl;
    transform: rotate(180deg);
  }
  /* The cap is on the span, not the cell, so the header row sizes to the longest
     name a roster actually has instead of always reserving the maximum. */
  .lr-vhead span {
    display: block;
    max-height: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* Compact the shared .dgA-mx-cell for a wide roster (scoped → wins specificity). */
  .lr-mx-grid :global(.dgA-mx-cell) {
    min-height: 28px;
    padding: 5px 3px;
    font-size: 11px;
  }
  .lr-clip {
    overflow: hidden;
  }
  .lr-clip span {
    display: block;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .lr-corner {
    background: var(--surface-2);
    color: var(--fg-quiet);
  }
  .lr-empty {
    background: var(--ink-2);
  }
  .lr-note {
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--fg-quiet);
    font-style: italic;
  }
</style>
