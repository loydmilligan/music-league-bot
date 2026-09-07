<script lang="ts">
  // D2 — voter×submitter points heatmap + auto-surfaced callouts (no lens toggle,
  // per README/DECISION_LOG). Reuses digest.css .dgA-matrix/.dgA-mx-* classes;
  // grid-template-columns is set inline for the variable roster width.
  import { buildCallouts, pointIntensity, type Matrix } from '$lib/league-research/viz';
  import type { NumMatrix } from '$lib/league-research/matrices';

  let {
    roster,
    matrix,
    maxPoints,
    pct,
    rankImpact,
  }: {
    roster: string[];
    matrix: Matrix;
    maxPoints: number;
    pct: NumMatrix;
    rankImpact: NumMatrix;
  } = $props();

  // Three lenses on the same voter x submitter grid. Raw points flatter prolific
  // voters and popular recipients alike, so the derived lenses exist to answer
  // what points alone cannot.
  const LENSES = [
    {
      id: 'points' as const,
      label: 'Total points',
      tip: 'Raw points this voter gave this submitter across the scope.',
    },
    {
      id: 'pct' as const,
      label: 'Point %',
      tip: 'What share of the submitter\u2019s total points came from this voter. 10 means this voter supplied 10% of everything they received. Downvotes read as a negative share.',
    },
    {
      id: 'rank' as const,
      label: 'Rank impact',
      tip: 'How many places this submitter would DROP if the voter\u2019s whole ballot were removed, summed across rounds. Positive means the voter propped them up; negative means the voter was holding them back. The whole ballot is removed, so a cell can move even where nothing was given directly.',
    },
  ];
  let lens = $state<'points' | 'pct' | 'rank'>('points');

  const callouts = $derived(buildCallouts(matrix, roster));
  const maxPct = $derived(Math.max(1, ...pct.flat().map((v) => Math.abs(v ?? 0))));
  const maxRank = $derived(Math.max(1, ...rankImpact.flat().map((v) => Math.abs(v ?? 0))));
  // Every column is minmax(18px, 1fr) so the grid divides the container instead of
  // sizing to its content: a 28-player roster fits 926px without horizontal scroll.
  // The 18px floor only bites below ~600px, where the wrapper's scroll takes over.
  const cols = $derived(`minmax(56px, 4.5fr) repeat(${roster.length}, minmax(18px, 1fr))`);
  const tip = (v: string, s: string, pts: number, count: number) =>
    `${v} → ${s}: ${pts} pts across ${count} vote${count === 1 ? '' : 's'}`;
  const tipPct = (v: string, s: string, n: number) => `${v} supplied ${n}% of ${s}'s total points`;
  const tipRank = (v: string, s: string, n: number) =>
    n === 0
      ? `${v}'s ballots made no difference to ${s}'s finishing position`
      : n > 0
        ? `${s} would finish ${n} place${n === 1 ? '' : 's'} lower without ${v}'s ballots`
        : `${s} would finish ${-n} place${n === -1 ? '' : 's'} HIGHER without ${v}'s ballots`;
</script>

{#if !roster.length}
  <p class="lr-note">No submissions in this scope yet.</p>
{:else}
  <div class="lr-lens" role="tablist" aria-label="heatmap lens">
    {#each LENSES as l, i (i)}
      <button
        type="button"
        role="tab"
        class="lr-lens-btn"
        class:is-active={lens === l.id}
        aria-selected={lens === l.id}
        title={l.tip}
        onclick={() => (lens = l.id)}>{l.label}</button
      >
    {/each}
    <span class="lr-lens-tip">{LENSES.find((l) => l.id === lens)?.tip}</span>
  </div>
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
            {:else if lens === 'pct'}
              {@const v = pct[r]?.[c] ?? null}
              {#if v === null}
                <div class="dgA-mx-cell lr-empty"></div>
              {:else if v < 0}
                <div class="dgA-mx-cell is-down" title={tipPct(vName, sName, v)}>{v}</div>
              {:else}
                <div class="dgA-mx-cell" data-p={pointIntensity(v, maxPct)} title={tipPct(vName, sName, v)}>{v}</div>
              {/if}
            {:else if lens === 'rank'}
              {@const v = rankImpact[r]?.[c] ?? null}
              {#if v === null || v === 0}
                <div class="dgA-mx-cell lr-empty" title={tipRank(vName, sName, 0)}></div>
              {:else if v < 0}
                <div class="dgA-mx-cell is-down" title={tipRank(vName, sName, v)}>{v}</div>
              {:else}
                <div class="dgA-mx-cell" data-p={pointIntensity(v, maxRank)} title={tipRank(vName, sName, v)}>{v}</div>
              {/if}
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
  .lr-lens { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem; padding-bottom: 0.6rem; }
  .lr-lens-btn {
    font-family: var(--font-mono); font-size: 0.72rem; padding: 0.2rem 0.55rem;
    border: 1px solid var(--line-strong); border-radius: 999px;
    background: transparent; color: var(--fg-quiet); cursor: pointer;
  }
  .lr-lens-btn.is-active { color: var(--fg); border-color: var(--accent); background: color-mix(in oklch, var(--accent) 14%, transparent); }
  .lr-lens-tip { flex: 1 1 100%; font-size: 0.68rem; color: var(--fg-quiet); line-height: 1.4; }

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
