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
  import { resolveTopSectionVariant, TOP_SECTION_VARIANT_META } from './topSectionVariants.js';
  let { data, content }: VisualComponentProps = $props();
  const insights = $derived((data ?? {}) as DigestInsightsData);
  const audio = $derived(insights.audio);
  const timing = $derived(insights.submissionTiming);
  const artists = $derived(insights.artists);
  const words = $derived(insights.wordCloud ?? []);
  const hasAudio = $derived(!!audio && (audio.analyzedSongs > 0 || audio.topKeys?.length > 0));
  const hasTiming = $derived(!!timing && timing.measuredCount > 0);
  const hasArtists = $derived(!!artists && artists.songCount > 0);
  const callbacks = $derived(artists?.callbacks ?? []);
  const hasWords = $derived(words.length > 0);
  const hasAny = $derived(hasAudio || hasTiming || hasArtists || hasWords);
  const variant = $derived(resolveTopSectionVariant(insights.topSectionVariant, insights.roundId ?? 0, { hero: true, sound: hasAudio, race: hasTiming, language: hasWords }));
  const selectedVisuals = $derived(insights.topSectionVisuals ?? []);
  const visuals = $derived(insights.topSectionVariant === "auto" && selectedVisuals.length ? selectedVisuals.filter((v) => v === "hero" || (v === "sound" && hasAudio) || (v === "race" && hasTiming) || (v === "language" && hasWords)) : [variant]);
  const variantLabel = $derived(visuals.map((v) => TOP_SECTION_VARIANT_META[v].label).join(" · "));
  const editorContent = $derived((content ?? {}) as { title?: string; body?: string });
  const lateShare = $derived(timing?.submissionCount ? Math.round(((timing.finalSixHoursCount ?? 0) / timing.submissionCount) * 100) : 0);
  const heroLine = $derived(lateShare >= 45 ? "A late-running round with a packed final stretch." : artists && artists.uniqueArtistCount >= Math.max(1, artists.songCount * 0.8) ? "A wide-open artist field with very little recycling." : audio?.medianBpm != null && audio.medianBpm < 90 ? "A slower, moodier set with room to breathe." : "A round with a distinct sonic and social fingerprint.");

  function fmtHours(value: number | null): string {
    if (value == null) return '—';
    if (value < 0) return `${Math.abs(value)}h late`;
    return `${value}h early`;
  }

  function seasonLabel(seasonNumber: number | null): string {
    return seasonNumber == null ? 'an earlier season' : `S${seasonNumber}`;
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

    {#if editorContent.body}<p class="di-user-note">{editorContent.body}</p>{/if}

    <div class="di-hero">
      <div><span class="di-feature-label">{variantLabel}</span><p>{heroLine}</p></div>
      <div class="di-signals">{#if hasAudio}<span><b>{audio.medianBpm ?? "—"}</b> BPM center</span>{/if}{#if hasAudio}<span><b>{audio.averageEnergy ?? "—"}</b> energy</span>{/if}{#if hasTiming}<span><b>{timing.finalSixHoursCount ?? 0}</b> late entries</span>{/if}{#if hasArtists}<span><b>{artists.callbackCount}</b> artist callbacks</span>{/if}</div>
    </div>

    {#each visuals as visual (visual)}
    {#if visual === "sound" && hasAudio}
      <section class="di-feature"><div class="di-card-head"><span>Sound profile</span><span>{audio.coveragePercent}% mapped</span></div><div class="di-range"><span>{audio.bpmMin ?? "—"}</span><div><i></i></div><span>{audio.bpmMax ?? "—"} BPM</span></div><div class="di-feature-metrics"><strong>{audio.medianBpm ?? "—"} <small>BPM center</small></strong><strong>{audio.averageEnergy ?? "—"} <small>energy</small></strong><span>{audio.topKeys[0]?.value ?? "mixed"} · {audio.topScales[0]?.value ?? "tonality"}</span></div></section>
    {:else if visual === "race" && hasTiming}
      <section class="di-feature"><div class="di-card-head"><span>Submission race</span><span>{timing.measuredCount}/{timing.submissionCount} timed</span></div><div class="di-race"><em>early</em><div class="di-race-track"><b class="median"></b><b class="latest"></b></div><em>deadline</em></div><div class="di-feature-metrics"><strong>{fmtHours(timing.medianHoursBeforeDeadline)} <small>median lead</small></strong><strong>{lateShare}% <small>final six hours</small></strong><span>{timing.finalSixHoursCount ?? 0} late stretch entries</span></div></section>
    {:else if visual === "language" && hasWords}
      <section class="di-feature di-feature--words"><div class="di-card-head"><span>Language of the room</span><span>{words.length} signals</span></div><div class="di-cloud" aria-label="Most frequent words in round comments and chat">{#each words.slice(0, 12) as item (item.word)}<span class="di-word"><b>{item.word}</b><small>{item.count}</small></span>{/each}</div></section>
    {:else if visual === "hero"}
      <section class="di-feature"><div class="di-card-head"><span>Round signals</span><span>selected automatically</span></div><div class="di-mini-grid">{#if hasWords}<div><b>{words[0]?.word ?? "—"}</b><span>top room signal</span></div>{/if}{#if hasArtists}<div><b>{artists.uniqueArtistCount}/{artists.songCount}</b><span>artist variety</span></div>{/if}{#if hasTiming}<div><b>{fmtHours(timing.earliestHoursBeforeDeadline)}</b><span>earliest submission</span></div>{/if}{#if hasAudio}<div><b>{audio.topKeys[0]?.value ?? "mixed"}</b><span>key center</span></div>{/if}</div></section>
    {/if}
    {/each}

    {#if hasArtists && callbacks.length}<div class="di-callbacks"><span>Season callbacks</span>{#each callbacks.slice(0, 3) as item (item.artist + item.priorTitle)}<span><b>{item.artist}</b> · {item.sameSubmitter ? "self callback" : "artist revival"}</span>{/each}</div>{/if}
  </div>
{/if}

<style>
  .di { padding: 16px; background: linear-gradient(135deg, var(--surface), var(--ink-0)); border: 1px solid var(--line); border-radius: var(--r-3); }
  .di-head { display:flex; align-items:end; justify-content:space-between; gap:12px; margin-bottom:14px; }
  .di-kicker { display:block; margin-bottom:5px; color:var(--mash-pulp); font:700 9px/1 var(--font-mono); letter-spacing:.13em; text-transform:uppercase; }
  .di-head h3 { margin:0; color:var(--fg); font:600 16px/1.1 var(--font-display); }
  .di-note, .di-card-head span:last-child { color:var(--fg-quiet); font:600 9px/1.2 var(--font-mono); text-transform:uppercase; letter-spacing:.04em; }
  .di-feature-label { display:block; color:var(--mash-pulp); font:700 10px/1 var(--font-mono); letter-spacing:.08em; text-transform:uppercase; }
  .di-hero { display:grid; grid-template-columns:minmax(0,1.2fr) minmax(0,1fr); gap:12px; align-items:center; padding:14px; background:var(--surface); border:1px solid var(--line); border-radius:var(--r-2); }
  .di-hero p { margin:5px 0 0; color:var(--fg); font:600 18px/1.12 var(--font-display); }
  .di-signals { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:6px; }
  .di-signals span { padding:7px 8px; color:var(--fg-muted); background:var(--ink-0); border:1px solid var(--line); border-radius:999px; font:600 9px/1.2 var(--font-mono); text-transform:uppercase; }
  .di-signals b, .di-feature-metrics strong { color:var(--fg); }
  .di-feature { margin-top:8px; padding:12px; background:var(--surface); border:1px solid var(--line); border-radius:var(--r-2); }
  .di-card-head { display:flex; justify-content:space-between; gap:8px; margin-bottom:10px; color:var(--fg-muted); font:700 10px/1.2 var(--font-mono); text-transform:uppercase; letter-spacing:.06em; }
  .di-cloud { display:flex; align-items:baseline; flex-wrap:wrap; gap:8px 14px; min-height:80px; padding:5px; }
  .di-word { display:inline-flex; align-items:baseline; gap:4px; color:var(--mash-pulp); font:700 1rem/1.05 var(--font-display); }
  .di-word:nth-child(3n) { color:var(--amber); } .di-word:nth-child(4n) { color:var(--moss); }
  .di-word small { color:var(--fg-quiet); font:600 9px/1 var(--font-mono); }
  .di-range, .di-race { display:flex; align-items:center; gap:8px; color:var(--fg-muted); font:600 10px/1 var(--font-mono); }
  .di-range > div, .di-race-track { position:relative; flex:1; height:8px; background:linear-gradient(90deg,var(--mash-pulp-soft),var(--mash-pulp)); border-radius:99px; }
  .di-range i, .di-race-track b { position:absolute; top:50%; width:12px; height:12px; background:var(--fg); border:2px solid var(--mash-pulp); border-radius:50%; transform:translate(-50%,-50%); }
  .di-race-track { background:linear-gradient(90deg,var(--mash-pulp-soft) 0 75%,var(--amber-soft) 75%); }
  .di-race-track .latest { left:2%; background:var(--amber); border-color:var(--amber); } .di-race-track .median { left:50%; }
  .di-feature-metrics { display:flex; align-items:baseline; flex-wrap:wrap; gap:16px; margin-top:13px; }
  .di-feature-metrics strong { font:700 20px/1 var(--font-mono); font-variant-numeric:tabular-nums; }
  .di-feature-metrics small, .di-feature-metrics span { color:var(--fg-muted); font:600 9px/1.2 var(--font-mono); text-transform:uppercase; }
  .di-mini-grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:8px; }
  .di-mini-grid div { padding:9px; background:var(--ink-0); border-radius:var(--r-1); } .di-mini-grid b { display:block; color:var(--fg); font:700 14px/1.1 var(--font-mono); } .di-mini-grid span, .di-callbacks { color:var(--fg-muted); font:600 9px/1.3 var(--font-mono); text-transform:uppercase; }
  .di-callbacks { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; } .di-callbacks > span { padding:5px 7px; background:var(--surface); border:1px solid var(--line); border-radius:999px; } .di-callbacks > span:first-child { color:var(--mash-pulp); border:0; padding-left:0; }
  .di-metric { display:flex; align-items:baseline; gap:7px; }
  .di-metric strong { color:var(--fg); font:700 22px/1 var(--font-mono); font-variant-numeric:tabular-nums; }
  .di-metric span { color:var(--fg-muted); font:600 10px/1.2 var(--font-mono); text-transform:uppercase; }
  .di-copy { margin:9px 0 0; color:var(--fg-2); font:500 11px/1.4 var(--font-body); }
  .di-copy--muted { color:var(--fg-quiet); }
  @media (max-width:520px) { .di-head { align-items:start; flex-direction:column; } .di-note { display:none; } .di-grid { grid-template-columns:1fr; } .di-card--words { grid-column:auto; } }
  :global(.dg-export--mobile) .di-grid { grid-template-columns:1fr; }
  :global(.dg-export--mobile) .di-card--words { grid-column:auto; }
</style>
