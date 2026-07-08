<script lang="ts">
  // D3 — diverging/tornado genre bars: submit-share (accent, left) vs vote-share
  // (sky, right) per normalized top genre. Player picked from the roster.
  import { topGenres, tornadoBars } from '$lib/league-research/viz';

  interface PlayerGenre {
    submitCounts: Record<string, number>;
    submitTotal: number;
    voteCounts: Record<string, number>;
    voteTotal: number;
  }

  let {
    roster,
    genreByPlayer,
    player,
    onselectplayer,
  }: {
    roster: string[];
    genreByPlayer: Record<string, PlayerGenre>;
    player: string;
    onselectplayer: (p: string) => void;
  } = $props();

  const g = $derived(
    genreByPlayer[player] ?? { submitCounts: {}, submitTotal: 0, voteCounts: {}, voteTotal: 0 },
  );
  const tags = $derived(topGenres(g.submitCounts, g.voteCounts, 8));
  const bars = $derived(tornadoBars(tags, g.submitCounts, g.submitTotal, g.voteCounts, g.voteTotal));
</script>

<div class="lr-genre">
  <div class="lr-genre-head">
    <span class="lr-lbl">player</span>
    <select
      class="lr-select"
      value={player}
      onchange={(e) => onselectplayer(e.currentTarget.value)}
    >
      {#each roster as p}
        <option value={p}>{p}</option>
      {/each}
    </select>
    <span class="lr-sub">submit vs vote</span>
  </div>

  {#if !bars.length}
    <p class="lr-note">No genre data for {player} in this scope — tags are sparse for many songs.</p>
  {:else}
    {#each bars as b}
      <div class="lr-tor-row">
        <div class="lr-tor-left"><div class="lr-tor-bar lr-submit" style={`width:${b.submitPct}%`}></div></div>
        <span class="lr-tor-label">{b.label}</span>
        <div class="lr-tor-right"><div class="lr-tor-bar lr-vote" style={`width:${b.votePct}%`}></div></div>
      </div>
    {/each}
    <div class="lr-legend">
      <span><i class="lr-sw lr-sw-submit"></i>submits</span>
      <span><i class="lr-sw lr-sw-vote"></i>votes for</span>
    </div>
  {/if}
</div>

<style>
  .lr-genre {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .lr-genre-head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
  }
  .lr-lbl {
    font-family: var(--font-mono);
    font-size: 9.5px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--fg-quiet);
  }
  .lr-select {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg);
    background: var(--ink-2);
    border: 1px solid var(--line);
    border-radius: var(--r-2);
    padding: 3px 8px;
  }
  .lr-sub {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--fg-quiet);
    margin-left: auto;
  }
  .lr-tor-row {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 8px;
    height: 16px;
  }
  .lr-tor-left {
    display: flex;
    justify-content: flex-end;
  }
  .lr-tor-right {
    display: flex;
    justify-content: flex-start;
  }
  .lr-tor-bar {
    height: 10px;
    min-width: 2px;
  }
  .lr-submit {
    background: var(--accent);
    border-radius: 2px 0 0 2px;
  }
  .lr-vote {
    background: var(--sky);
    border-radius: 0 2px 2px 0;
  }
  .lr-tor-label {
    font-family: var(--font-mono);
    font-size: 9.5px;
    color: var(--fg-quiet);
    white-space: nowrap;
  }
  .lr-legend {
    display: flex;
    gap: 14px;
    padding-top: 4px;
    border-top: 1px dashed var(--line);
    margin-top: 2px;
  }
  .lr-legend span {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--fg-muted);
  }
  .lr-sw {
    display: inline-block;
    width: 9px;
    height: 9px;
    border-radius: 2px;
  }
  .lr-sw-submit {
    background: var(--accent);
  }
  .lr-sw-vote {
    background: var(--sky);
  }
  .lr-note {
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--fg-quiet);
    font-style: italic;
  }
</style>
