<script lang="ts" module>
  import type { VisualComponentProps } from './variants.js';
  import type { RoundInsights } from '../db/roundInsights.js';

  export type DigestInsightsData = RoundInsights & {
    recap?: boolean;
    songs?: number;
    votes?: number;
    rounds?: number;
    players?: number;
    biggestRoundVotes?: number;
  };
</script>

<script lang="ts">
  let { data }: VisualComponentProps = $props();
  const insights = $derived((data ?? {}) as DigestInsightsData);
  const audio = $derived(insights.audio);
  const timing = $derived(insights.submissionTiming);
  const artists = $derived(insights.artists);
  const words = $derived(insights.wordCloud ?? []);
  const hasAudio = $derived(!!audio && (audio.analyzedSongs > 0 || audio.topKeys?.length > 0));
  const hasTiming = $derived(!!timing && timing.measuredCount > 0);
  const hasArtists = $derived(!!artists && artists.songCount > 0);
  const hasWords = $derived(words.length > 0);
  const hasAny = $derived(hasAudio || hasTiming || hasArtists || hasWords);

  function fmtHours(value: number | null): string {
    if (value == null) return '—';
    if (value < 0) return `${Math.abs(value)}h late`;
    return `${value}h early`;
  }

  function wordSize(weight: number): string {
    return `${0.75 + weight * 0.75}rem`;
  }
</script>

{#if hasAny}
  <div class="di" data-component="digest-insights">
    <header class="di-head">
      <div>
        <span class="di-kicker">Round intelligence</span>
        <h3>What this round sounded like</h3>
      </div>
      <span class="di-note">deterministic · no LLM gloss</span>
    </header>

    <div class="di-grid">
      {#if hasWords}
        <section class="di-card di-card--words">
          <div class="di-card-head"><span>Language of the room</span><span>{words.length} signals</span></div>
          <div class="di-cloud" aria-label="Most frequent words in round comments and chat">
            {#each words as item (item.word)}
              <span style={`font-size:${wordSize(item.weight)}`}>{item.word}</span>
            {/each}
          </div>
        </section>
      {/if}

      {#if hasAudio}
        <section class="di-card">
          <div class="di-card-head"><span>Sound profile</span><span>{audio.coveragePercent}% mapped</span></div>
          <div class="di-metric"><strong>{audio.medianBpm ?? '—'}</strong><span>BPM center</span></div>
          {#if audio.bpmMin != null && audio.bpmMax != null}
            <p class="di-copy">Range {audio.bpmMin}–{audio.bpmMax} BPM · energy {audio.averageEnergy ?? '—'}</p>
          {/if}
          {#if audio.topKeys.length}
            <p class="di-copy">Key center: {audio.topKeys[0].value} · {audio.topScales[0]?.value ?? 'mixed'}</p>
          {/if}
        </section>
      {/if}

      {#if hasTiming}
        <section class="di-card">
          <div class="di-card-head"><span>Deadline behavior</span><span>{timing.measuredCount}/{timing.submissionCount} timed</span></div>
          <div class="di-metric"><strong>{fmtHours(timing.medianHoursBeforeDeadline)}</strong><span>median submission</span></div>
          <p class="di-copy">
            {timing.finalSixHoursCount ?? 0} arrived in the final six hours
            {#if timing.lateCount} · {timing.lateCount} after cutoff{/if}
          </p>
          <p class="di-copy di-copy--muted">Range: {fmtHours(timing.earliestHoursBeforeDeadline)} → {fmtHours(timing.latestHoursBeforeDeadline)}</p>
        </section>
      {/if}

      {#if hasArtists}
        <section class="di-card">
          <div class="di-card-head"><span>Artist landscape</span><span>{artists.uniqueArtistCount} artists</span></div>
          <div class="di-metric"><strong>{artists.repeatedArtistCount}</strong><span>repeated artists</span></div>
          {#if artists.topArtists.length}
            <p class="di-copy">Most recurring: {artists.topArtists.slice(0, 3).map((item) => `${item.value} ×${item.count}`).join(' · ')}</p>
          {/if}
          <p class="di-copy di-copy--muted">{artists.repeatRatePercent}% of artist names recur in the round</p>
        </section>
      {/if}
    </div>
  </div>
{/if}

<style>
  .di { padding: 16px; background: linear-gradient(135deg, var(--surface), var(--ink-0)); border: 1px solid var(--line); border-radius: var(--r-3); }
  .di-head { display:flex; align-items:end; justify-content:space-between; gap:12px; margin-bottom:14px; }
  .di-kicker { display:block; margin-bottom:5px; color:var(--mash-pulp); font:700 9px/1 var(--font-mono); letter-spacing:.13em; text-transform:uppercase; }
  .di-head h3 { margin:0; color:var(--fg); font:600 16px/1.1 var(--font-display); }
  .di-note, .di-card-head span:last-child { color:var(--fg-quiet); font:600 9px/1.2 var(--font-mono); text-transform:uppercase; letter-spacing:.04em; }
  .di-grid { display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:8px; }
  .di-card { min-width:0; padding:12px; background:var(--surface); border:1px solid var(--line); border-radius:var(--r-2); }
  .di-card--words { grid-column:span 2; background:var(--mash-pulp-soft); border-color:var(--mash-pulp-edge); }
  .di-card-head { display:flex; justify-content:space-between; gap:8px; margin-bottom:10px; color:var(--fg-muted); font:700 10px/1.2 var(--font-mono); text-transform:uppercase; letter-spacing:.06em; }
  .di-cloud { display:flex; align-items:center; justify-content:center; flex-wrap:wrap; gap:5px 11px; min-height:82px; padding:4px; color:var(--mash-pulp); font:700 1rem/1.05 var(--font-display); }
  .di-cloud span:nth-child(3n) { color:var(--amber); }
  .di-cloud span:nth-child(4n) { color:var(--moss); }
  .di-metric { display:flex; align-items:baseline; gap:7px; }
  .di-metric strong { color:var(--fg); font:700 22px/1 var(--font-mono); font-variant-numeric:tabular-nums; }
  .di-metric span { color:var(--fg-muted); font:600 10px/1.2 var(--font-mono); text-transform:uppercase; }
  .di-copy { margin:9px 0 0; color:var(--fg-2); font:500 11px/1.4 var(--font-body); }
  .di-copy--muted { color:var(--fg-quiet); }
  @media (max-width:520px) { .di-head { align-items:start; flex-direction:column; } .di-note { display:none; } .di-grid { grid-template-columns:1fr; } .di-card--words { grid-column:auto; } }
  :global(.dg-export--mobile) .di-grid { grid-template-columns:1fr; }
  :global(.dg-export--mobile) .di-card--words { grid-column:auto; }
</style>
