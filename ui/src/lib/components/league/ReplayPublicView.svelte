<script lang="ts">
  // Voting Replay — the results page as it stood at this ballot.
  //
  // This view is deliberately starved: its only props are the running board and
  // a uri -> title lookup, so there is nothing here to leak even by accident.
  // Totals and how many people have scored each song; nothing else. Keep it
  // that way — the whole point of the view is what it does NOT show.
  import type { ReplayStep } from '$lib/league-research/replayTypes.js';

  let { step, titles }: { step: ReplayStep; titles: Record<string, string> } = $props();

  // step.board arrives sorted by points descending; keep that order.
  const rows = $derived(step.board);
</script>

<div class="rp-public">
  {#if !rows.length}
    <p class="rp-note">Nothing on the board yet.</p>
  {:else}
    <ol class="rp-list">
      {#each rows as row, i (i)}
        <li class="rp-row">
          <span class="rp-rank">{i + 1}</span>
          <span class="rp-title">{titles[row.uri] ?? row.uri}</span>
          <span class="rp-pts">{row.points}</span>
          <span class="rp-voters">{row.voterCount} {row.voterCount === 1 ? 'voter' : 'voters'}</span>
        </li>
      {/each}
    </ol>
  {/if}
  <p class="rp-caption">This is exactly what the results page showed at this moment.</p>
</div>

<style>
  .rp-public {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .rp-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .rp-row {
    display: grid;
    grid-template-columns: 22px 1fr auto auto;
    align-items: baseline;
    gap: 8px;
    padding: 4px 6px;
    border-radius: var(--r-1);
  }
  .rp-row:nth-child(odd) {
    background: var(--ink-2);
  }
  .rp-rank {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--fg-quiet);
    text-align: right;
  }
  .rp-title {
    font-size: 12.5px;
    color: var(--fg);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .rp-pts {
    font-family: var(--font-mono);
    font-size: 12.5px;
    color: var(--accent);
    min-width: 26px;
    text-align: right;
  }
  .rp-voters {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--fg-quiet);
    min-width: 58px;
    text-align: right;
  }
  .rp-caption,
  .rp-note {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--fg-quiet);
    font-style: italic;
  }
</style>
