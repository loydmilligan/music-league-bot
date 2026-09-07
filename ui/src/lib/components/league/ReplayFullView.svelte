<script lang="ts">
  // Voting Replay — the whole truth at this ballot: every song with its
  // submitter, its running total, and both kinds of comment.
  //
  // `ballots` is not in the plan's prop list but is required by it: only
  // comments from ballots cast at or before this step may show, and `step`
  // alone carries just the current ballot.
  import type { ReplayBallot, ReplaySong, ReplayStep } from '$lib/league-research/replayTypes.js';

  let {
    step,
    songs,
    ballots,
  }: { step: ReplayStep; songs: ReplaySong[]; ballots: ReplayBallot[] } = $props();

  const points = $derived(new Map(step.board.map((b) => [b.uri, b.points])));

  /** Voter comments visible so far, by song. A 0-point row is the submitter's
   *  own note riding along in their ballot — it is not a vote and not shown here. */
  const said = $derived.by(() => {
    const out = new Map<string, { voter: string; points: number; text: string }[]>();
    for (const ballot of ballots.slice(0, step.index + 1)) {
      for (const v of ballot.votes) {
        if (!v.comment || v.points === 0) continue;
        const list = out.get(v.uri) ?? [];
        list.push({ voter: ballot.voter, points: v.points, text: v.comment });
        out.set(v.uri, list);
      }
    }
    return out;
  });

  const rows = $derived(
    [...songs].sort((a, b) => (points.get(b.uri) ?? 0) - (points.get(a.uri) ?? 0)),
  );
</script>

<div class="rp-full">
  {#each rows as song, i (i)}
    <article class="rp-song">
      <header class="rp-song-head">
        <span class="rp-pts">{points.get(song.uri) ?? 0}</span>
        <span class="rp-title">{song.title}</span>
        <span class="rp-artist">{song.artist}</span>
        <span class="rp-by">{song.submitter}</span>
      </header>

      {#if song.submitterComment}
        <p class="rp-say rp-say-sub">
          <span class="rp-chip">submitter</span>
          <span class="rp-who">{song.submitter}</span>
          <span class="rp-text">{song.submitterComment}</span>
        </p>
      {/if}

      {#each said.get(song.uri) ?? [] as c, j (j)}
        <p class="rp-say rp-say-voter">
          <span class="rp-vpts">{c.points > 0 ? `+${c.points}` : c.points}</span>
          <span class="rp-who">{c.voter}</span>
          <span class="rp-text">{c.text}</span>
        </p>
      {/each}
    </article>
  {/each}
</div>

<style>
  .rp-full {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .rp-song {
    border: 1px solid var(--line);
    border-radius: var(--r-2);
    padding: 7px 9px;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .rp-song-head {
    display: grid;
    grid-template-columns: 28px 1fr auto;
    align-items: baseline;
    gap: 8px;
  }
  .rp-pts {
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--accent);
    text-align: right;
  }
  .rp-title {
    font-size: 12.5px;
    color: var(--fg);
  }
  .rp-artist {
    font-size: 11px;
    color: var(--fg-muted);
    grid-column: 2;
  }
  .rp-by {
    grid-row: 1 / span 2;
    grid-column: 3;
    align-self: center;
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--sky);
  }
  .rp-say {
    display: grid;
    grid-template-columns: auto auto 1fr;
    align-items: baseline;
    gap: 6px;
    margin: 0;
    padding: 4px 6px;
    border-radius: var(--r-1);
    font-size: 11.5px;
    line-height: 1.45;
  }
  /* Submitter notes read as a different KIND of speech from voter comments. */
  .rp-say-sub {
    background: color-mix(in oklch, var(--sky) 14%, transparent);
    border-left: 2px solid var(--sky);
  }
  .rp-say-voter {
    background: var(--ink-2);
  }
  .rp-chip {
    font-family: var(--font-mono);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--sky);
    border: 1px solid var(--sky);
    border-radius: 999px;
    padding: 0 5px;
  }
  .rp-vpts {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--accent);
    min-width: 20px;
    text-align: right;
  }
  .rp-who {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--fg-quiet);
  }
  .rp-text {
    color: var(--fg-muted);
  }
</style>
