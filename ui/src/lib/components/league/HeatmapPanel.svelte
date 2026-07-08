<script lang="ts">
  // D2 — voter×submitter points heatmap + auto-surfaced callouts (no lens toggle,
  // per README/DECISION_LOG). Reuses digest.css .dgA-matrix/.dgA-mx-* classes;
  // grid-template-columns is set inline for the variable roster width.
  import { buildCallouts, pointIntensity, type Matrix } from '$lib/league-research/viz';

  let { roster, matrix, maxPoints }: { roster: string[]; matrix: Matrix; maxPoints: number } = $props();

  const callouts = $derived(buildCallouts(matrix, roster));
  const cols = $derived(`minmax(72px, 1.3fr) repeat(${roster.length}, minmax(34px, 1fr))`);
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
          <div class="dgA-mx-cell dgA-mx-head lr-clip" title={sName}><span>{sName}</span></div>
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
  /* .dgA-matrix ships overflow:hidden (rounded-corner clip) which would clip the
     wide grid instead of letting the wrapper scroll. Let it grow to content width
     so .lr-mx-scroll gets real horizontal overflow to scroll on mobile. */
  .lr-mx-scroll :global(.dgA-matrix) {
    width: max-content;
    max-width: none;
  }
  .lr-mx-grid {
    display: grid;
    width: max-content;
    min-width: 100%;
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
