<script lang="ts">
  // Voting Replay — what a chosen observer could have worked out by this ballot.
  //
  // The ethics of the feature live here. A pool is rendered AS A POOL; the only
  // time one name stands alone is when the engine proved it. Anything the
  // analyst's hunches cut is labelled "ruled out by you" and never dressed up
  // as a deduction. The view can only print what the engine exposes, and the
  // engine never resolves a submitter it has not proven.
  import type { ReplayAnalysis, ReplayStep } from '$lib/league-research/replayTypes.js';

  let {
    step,
    analysis,
    titles,
    target,
    nearMisses,
    onHunch,
  }: {
    step: ReplayStep;
    analysis: ReplayAnalysis;
    titles: Record<string, string>;
    /** The observer the outcome pattern is anchored on. */
    target: string;
    /** justEnough() flags — an outcome pattern, never a deduction. */
    nearMisses: { uri: string; submitter: string; margin: number }[];
    onHunch: (uri: string, player: string) => void;
  } = $props();

  /** "Tommy, Brian and Jac" — partial intervals are read out loud, not tabulated. */
  function names(xs: string[]): string {
    if (xs.length <= 1) return xs[0] ?? '';
    return `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`;
  }

  const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

  // Ballots cast so far, each tagged by how well it is known.
  const ledger = $derived.by(() => {
    const known = new Set(step.knownBallots);
    const summed = new Set(step.partialIntervals.flatMap((iv) => iv.voters));
    return analysis.steps.slice(0, step.index + 1).map((s) => ({
      voter: s.ballot.voter,
      state: known.has(s.ballot.voter)
        ? ('exact' as const)
        : summed.has(s.ballot.voter)
          ? ('sum' as const)
          : ('unknown' as const),
    }));
  });

  const LEDGER_LABEL = { exact: 'exact', sum: 'part of a sum', unknown: 'unknown' };

  const pools = $derived(
    [...step.knowledge].sort(
      (a, b) =>
        a.afterHunches.length - b.afterHunches.length ||
        (titles[a.uri] ?? a.uri).localeCompare(titles[b.uri] ?? b.uri),
    ),
  );

  /** Provenance is mandatory: a hunch-cut pool never reads as a deduction. */
  function poolLabel(n: number, cut: number): string {
    const head = `${n} ${n === 1 ? 'candidate' : 'candidates'}`;
    return cut ? `${head} — ${cut} ruled out by you` : head;
  }
</script>

<div class="rp-ded">
  <p class="rp-lev">
    {analysis.hunchesApplied}
    {analysis.hunchesApplied === 1 ? 'hunch' : 'hunches'} → {analysis.songsResolvedByHunches}
    {analysis.songsResolvedByHunches === 1 ? 'song' : 'songs'} resolved
  </p>

  <section class="rp-sec">
    <h4 class="rp-h">Ballot ledger</h4>
    <div class="rp-ledger">
      {#each ledger as row, i (i)}
        <span class="rp-tag rp-tag-{row.state}">
          {row.voter}<i>{LEDGER_LABEL[row.state]}</i>
        </span>
      {/each}
    </div>
    {#if step.partialIntervals.length}
      <ul class="rp-sums">
        {#each step.partialIntervals as iv, i (i)}
          <li>
            {names(iv.voters)} together gave
            {Object.entries(iv.delta)
              .filter(([, d]) => d !== 0)
              .map(([uri, d]) => `${titles[uri] ?? uri} ${signed(d)}`)
              .join(', ')}
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="rp-sec">
    <h4 class="rp-h">Candidate pools</h4>
    {#each pools as k, i (i)}
      <div class="rp-pool">
        <div class="rp-pool-head">
          <span class="rp-pool-song">{titles[k.uri] ?? k.uri}</span>
          <span class="rp-pool-n" class:is-hunched={k.ruledOutByYou.length > 0}>
            {poolLabel(k.afterHunches.length, k.ruledOutByYou.length)}
          </span>
        </div>
        <div class="rp-cands">
          {#each k.afterHunches as p, j (j)}
            <button type="button" class="rp-cand" title="Rule {p} out" onclick={() => onHunch(k.uri, p)}
              >{p}</button
            >
          {/each}
          {#each k.ruledOutByYou as p, j (j)}
            <button type="button" class="rp-cand is-out" title="Put {p} back" onclick={() => onHunch(k.uri, p)}
              >{p}</button
            >
          {/each}
        </div>
      </div>
    {/each}
  </section>

  {#if target && nearMisses.length}
    <section class="rp-sec">
      <h4 class="rp-h">Outcome pattern — not a deduction</h4>
      <p class="rp-note">
        Songs that finished 1–2 points under {target}'s own song. This exists only once the round
        closed; no observer could know it while voting, and it says nothing about anyone's intent.
      </p>
      <ul class="rp-sums">
        {#each nearMisses as f, i (i)}
          <li>{titles[f.uri] ?? f.uri} ({f.submitter}) landed {f.margin} under</li>
        {/each}
      </ul>
    </section>
  {/if}

  <p class="rp-caption">
    Mechanical deduction alone rarely resolves a submitter — under 1% even with every ballot known.
    The pools are the honest answer.
  </p>
</div>

<style>
  .rp-ded {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .rp-sec {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .rp-h {
    font-family: var(--font-mono);
    font-size: 9.5px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--fg-quiet);
    margin: 0;
  }
  .rp-lev {
    font-family: var(--font-mono);
    font-size: 11.5px;
    color: var(--accent);
    margin: 0;
  }
  .rp-ledger {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .rp-tag {
    display: inline-flex;
    align-items: baseline;
    gap: 5px;
    font-family: var(--font-mono);
    font-size: 10.5px;
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 2px 8px;
    color: var(--fg-muted);
  }
  .rp-tag i {
    font-style: normal;
    font-size: 9px;
    color: var(--fg-quiet);
  }
  .rp-tag-exact {
    border-color: var(--accent);
    color: var(--fg);
  }
  .rp-tag-sum {
    border-color: var(--sky);
  }
  .rp-sums {
    margin: 0;
    padding-left: 16px;
    font-size: 11.5px;
    color: var(--fg-muted);
    line-height: 1.5;
  }
  .rp-pool {
    border-top: 1px solid var(--line);
    padding: 6px 0 2px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .rp-pool-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 10px;
  }
  .rp-pool-song {
    font-size: 12px;
    color: var(--fg);
  }
  .rp-pool-n {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--fg-quiet);
    white-space: nowrap;
  }
  /* A hunch-narrowed pool is coloured as YOUR work, not as deduction. */
  .rp-pool-n.is-hunched {
    color: var(--warn, var(--sky));
  }
  .rp-cands {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .rp-cand {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--fg-muted);
    background: var(--ink-2);
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 2px 8px;
    cursor: pointer;
  }
  .rp-cand:hover {
    color: var(--fg);
  }
  .rp-cand.is-out {
    text-decoration: line-through;
    color: var(--fg-quiet);
    opacity: 0.6;
  }
  .rp-note {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--fg-quiet);
    line-height: 1.5;
    margin: 0;
  }
  .rp-caption {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--fg-quiet);
    font-style: italic;
    margin: 0;
  }
</style>
