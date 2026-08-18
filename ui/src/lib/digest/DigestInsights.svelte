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
  import { markRuns } from './regularStyles.js';
  import { page } from '$app/state';
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
  // The Coinage — same card idiom as "Language of the room", rendered as a
  // dictionary entry. `style:` is forward-compatible and today always this layout.
  const phrase = $derived(insights.statsContent?.phrase ?? (content as { phrase?: import('../db/roundInsights.js').PhraseOfRound })?.phrase);
  // PNG/PDF export screenshots the page — video elements never capture, so the
  // export path prints the poster still instead.
  const isExport = $derived(page?.url?.searchParams?.get('export') === '1');
  const phraseDefinition = $derived(phrase?.definition?.trim() || phrase?.gloss?.trim() || '');
  // New `usages[]`, else the pre-redesign `quotes[]` the live R147 draft carries.
  const phraseUsages = $derived(
    (phrase?.usages?.length
      ? phrase.usages
      : (phrase?.quotes ?? []).map((q) => ({ label: '', speaker: q.speaker, text: q.text }))
    ).filter((u) => !!u?.text?.trim()),
  );
  // The term itself is the amber highlight; the plural is listed first so the
  // alternation prefers it ("chopped uncs" over a \b-blocked "chopped unc").
  const phraseTokens = $derived(phrase?.term ? [`${phrase.term}s`, phrase.term] : []);
  // Legacy row: the numbers live in the flag line now, so it only renders for
  // payloads written before `stats:` existed.
  const phraseMetrics = $derived(phrase?.stats ? [] : (phrase?.metrics?.filter((m) => !!m?.value) ?? []));
  // Export prints the poster still; without one there is nothing safe to print,
  // so the slot is dropped rather than showing a video that captures blank.
  const phraseMedia = $derived(
    (isExport ? phrase?.media?.poster : phrase?.media?.src || phrase?.media?.poster) ? phrase?.media : null,
  );
  const phraseFlag = $derived.by(() => {
    const parts: string[] = [];
    const date = coinedDate(phrase?.coined?.date);
    if (date) parts.push(`coined ${date}`);
    const stats = phrase?.stats;
    if (present(stats?.speakers)) parts.push(`${stats?.speakers} speakers`);
    if (present(stats?.prior_rounds)) parts.push(`${stats?.prior_rounds} prior rounds`);
    // `uses` stays off the flag line on purpose: the section's claim is novelty
    // and spread, not frequency. A use-count here would read as "the word we
    // said most", the opposite of what a coinage is.
    return parts.length ? parts.join(' · ') : (phrase?.meta ?? '');
  });
  // "coined by Steiny at Jensen, over an Outside Lands gif · 8/9" — every part
  // optional, and no stray punctuation when only some of them are authored.
  const phraseOrigin = $derived.by(() => {
    const by = phrase?.coined?.by?.trim();
    const at = phrase?.coined?.at?.trim();
    const context = phrase?.coined?.context?.trim();
    const date = coinedDate(phrase?.coined?.date);
    if (!by && !at && !context && !date) return '';
    const who = ['coined', by && `by ${by}`, at && `at ${at}`].filter(Boolean).join(' ');
    const said = context ? `${who}, ${context}` : who;
    if (!date) return said;
    return said === 'coined' ? `coined ${date}` : `${said} · ${date}`;
  });
  // `source` is hand-authored and the digest is published publicly, so a
  // `javascript:` URL would otherwise become a live link. Only http(s) survives;
  // anything else renders no link at all.
  const phraseSourceHref = $derived(safeUrl(phrase?.source));
  const lateShare = $derived(timing?.submissionCount ? Math.round(((timing.finalSixHoursCount ?? 0) / timing.submissionCount) * 100) : 0);
  const heroLine = $derived(lateShare >= 45 ? "A late-running round with a packed final stretch." : artists && artists.uniqueArtistCount >= Math.max(1, artists.songCount * 0.8) ? "A wide-open artist field with very little recycling." : audio?.medianBpm != null && audio.medianBpm < 90 ? "A slower, moodier set with room to breathe." : "A round with a distinct sonic and social fingerprint.");

  // ── Clip lightbox (web only) ───────────────────────────────────────────
  // Interactivity can never survive the PNG, so every part of this is behind
  // `!isExport`: no trigger, no dialog, no listener.
  let clipOpen = $state(false);
  let clipTrigger = $state<HTMLButtonElement | null>(null);
  let clipDialog = $state<HTMLDivElement | null>(null);
  let clipClose = $state<HTMLButtonElement | null>(null);

  function openClip() {
    if (isExport) return;
    clipOpen = true;
  }

  function closeClip() {
    if (!clipOpen) return;
    clipOpen = false;
    clipTrigger?.focus();
  }

  function onWindowKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && clipOpen) closeClip();
  }

  /** Keep Tab inside the dialog while it's open. */
  function trapTab(e: KeyboardEvent) {
    if (e.key !== 'Tab' || !clipDialog) return;
    const focusable = clipDialog.querySelectorAll<HTMLElement>(
      'button, [href], video[controls], [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !clipDialog.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  // Move focus into the dialog when it opens; `closeClip` hands it back.
  $effect(() => {
    if (clipOpen) clipClose?.focus();
  });

  /** `0 prior rounds` is a real, load-bearing stat — presence, not truthiness. */
  function present(value: number | string | undefined): boolean {
    return value != null && String(value).trim() !== '';
  }

  /** `2026-08-09` reads as `8/9` on the flag line; anything else prints verbatim. */
  function coinedDate(value: string | undefined): string {
    const raw = (value ?? '').trim();
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
    return iso ? `${Number(iso[2])}/${Number(iso[3])}` : raw;
  }

  /** The URL, but only if it is one and only if it is http(s). Else empty. */
  function safeUrl(url: string | undefined): string {
    const raw = (url ?? '').trim();
    if (!raw) return '';
    try {
      const parsed = new URL(raw);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? raw : '';
    } catch {
      return '';
    }
  }

  /**
   * "original" → "original usage · Steiny", but a label that is already a
   * phrase ("the lookup") stands on its own — "the lookup usage" reads like a
   * form field, and three of those in a row read like a list.
   */
  function usageLabel(label: string | undefined, speaker: string | undefined): string {
    const l = (label ?? '').trim();
    const base = l && !l.includes(' ') && !/usage/i.test(l) ? `${l} usage` : l;
    return [base, (speaker ?? '').trim()].filter(Boolean).join(' · ');
  }

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

<!-- Top-level by necessity; the handler no-ops unless a lightbox is open, and
     the lightbox can only open when not exporting. -->
<svelte:window onkeydown={onWindowKey} />

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

    {#each visuals as visual, i (i)}
    {#if visual === "sound" && hasAudio}
      <section class="di-feature"><div class="di-card-head"><span>Sound profile</span><span>{audio.coveragePercent}% mapped</span></div><div class="di-range"><span>{audio.bpmMin ?? "—"}</span><div><i></i></div><span>{audio.bpmMax ?? "—"} BPM</span></div><div class="di-feature-metrics"><strong>{audio.medianBpm ?? "—"} <small>BPM center</small></strong><strong>{audio.averageEnergy ?? "—"} <small>energy</small></strong><span>{audio.topKeys[0]?.value ?? "mixed"} · {audio.topScales[0]?.value ?? "tonality"}</span></div></section>
    {:else if visual === "race" && hasTiming}
      <section class="di-feature"><div class="di-card-head"><span>Submission race</span><span>{timing.measuredCount}/{timing.submissionCount} timed</span></div><div class="di-race"><em>early</em><div class="di-race-track"><b class="median"></b><b class="latest"></b></div><em>deadline</em></div><div class="di-feature-metrics"><strong>{fmtHours(timing.medianHoursBeforeDeadline)} <small>median lead</small></strong><strong>{lateShare}% <small>final six hours</small></strong><span>{timing.finalSixHoursCount ?? 0} late stretch entries</span></div></section>
    {:else if visual === "language" && hasWords}
      <section class="di-feature di-feature--words"><div class="di-card-head"><span>Language of the room</span><span>{words.length} signals</span></div><div class="di-cloud" aria-label="Most frequent words in round comments and chat">{#each words.slice(0, 12) as item, i (i)}<span class="di-word"><b>{item.word}</b><small>{item.count}</small></span>{/each}</div></section>
    {:else if visual === "hero"}
      <section class="di-feature"><div class="di-card-head"><span>Round signals</span><span>selected automatically</span></div><div class="di-mini-grid">{#if hasWords}<div><b>{words[0]?.word ?? "—"}</b><span>top room signal</span></div>{/if}{#if hasArtists}<div><b>{artists.uniqueArtistCount}/{artists.songCount}</b><span>artist variety</span></div>{/if}{#if hasTiming}<div><b>{fmtHours(timing.earliestHoursBeforeDeadline)}</b><span>earliest submission</span></div>{/if}{#if hasAudio}<div><b>{audio.topKeys[0]?.value ?? "mixed"}</b><span>key center</span></div>{/if}</div></section>
    {/if}
    {/each}

    {#if phrase?.term}
      <section class="di-feature di-feature--phrase">
        <div class="di-card-head"><span>The Coinage</span>{#if phraseFlag}<span>{phraseFlag}</span>{/if}</div>
        <p class="di-term">{phrase.term}</p>
        {#if phrase.pronunciation || phrase.part_of_speech}
          <p class="di-pron">{phrase.pronunciation ?? ''}{#if phrase.part_of_speech}<span class="di-pos">{phrase.part_of_speech}</span>{/if}</p>
        {/if}
        <!-- The clip floats: definition, metrics and usages all flow up beside
             it, so a short definition can't leave a hole above the usages. -->
        <div class="di-phrase-body">
          {#if phraseMedia}
            <figure class="di-clip">
              {#if isExport}
                <img src={phraseMedia.poster} alt={phraseMedia.alt ?? phrase.term} />
              {:else}
                <button
                  type="button"
                  class="di-clip-btn"
                  bind:this={clipTrigger}
                  onclick={openClip}
                  aria-label={`Open ${phrase.term} clip larger`}
                >
                  {#if phraseMedia.src}
                    <video
                      src={phraseMedia.src}
                      poster={phraseMedia.poster}
                      autoplay
                      loop
                      muted
                      playsinline
                      aria-label={phraseMedia.alt ?? phrase.term}
                    ></video>
                  {:else}
                    <img src={phraseMedia.poster} alt={phraseMedia.alt ?? phrase.term} />
                  {/if}
                </button>
              {/if}
              {#if phraseMedia.caption}<figcaption>{phraseMedia.caption}</figcaption>{/if}
            </figure>
          {/if}
          {#if phraseDefinition}<p class="di-def"><span class="di-def-num">1.</span>{phraseDefinition}</p>{/if}
          {#if phraseMetrics.length}
            <div class="di-feature-metrics">{#each phraseMetrics as m, i (i)}<strong>{m.value} <small>{m.label}</small></strong>{/each}</div>
          {/if}
          {#if phraseUsages.length}
            <div class="di-usages">
              {#each phraseUsages as usage, i (i)}
                <div class="di-usage">
                  {#if usageLabel(usage.label, usage.speaker)}<span class="di-usage-label">{usageLabel(usage.label, usage.speaker)}</span>{/if}
                  <span class="di-usage-text">{#each markRuns(usage.text ?? '', phraseTokens) as run, r (r)}{#if run.hit}<b>{run.t}</b>{:else}{run.t}{/if}{/each}</span>
                </div>
              {/each}
            </div>
          {/if}
        </div>
        {#if phraseOrigin}
          <p class="di-origin">
            <b>origin</b> —
            {#if phraseSourceHref && !isExport}
              <a href={phraseSourceHref} target="_blank" rel="noopener noreferrer">{phraseOrigin}</a>
            {:else}{phraseOrigin}{/if}
          </p>
        {/if}
        <!-- No separate explainer line: the origin sentence above IS the link,
             and two links to one URL is exactly the busyness being cut. -->
      </section>
    {/if}

    {#if hasArtists && callbacks.length}<div class="di-callbacks"><span>Season callbacks</span>{#each callbacks.slice(0, 3) as item, i (i)}<span><b>{item.artist}</b> · {item.sameSubmitter ? "self callback" : "artist revival"}</span>{/each}</div>{/if}
  </div>

  <!-- Web-only clip enlargement. `?export=1` never renders the trigger or this
       markup at all — the PNG prints the poster inline exactly as before. -->
  {#if clipOpen && phraseMedia && !isExport}
    <div
      class="di-scrim"
      role="presentation"
      onclick={(e) => { if (e.target === e.currentTarget) closeClip(); }}
    >
      <div
        class="di-lightbox"
        role="dialog"
        aria-modal="true"
        aria-label={phraseMedia.alt ?? phrase?.term ?? 'clip'}
        tabindex="-1"
        bind:this={clipDialog}
        onkeydown={trapTab}
      >
        {#if phraseMedia.src}
          <video src={phraseMedia.src} poster={phraseMedia.poster} autoplay loop muted playsinline aria-label={phraseMedia.alt ?? phrase?.term}></video>
        {:else}
          <img src={phraseMedia.poster} alt={phraseMedia.alt ?? phrase?.term ?? ''} />
        {/if}
        <div class="di-lightbox-foot">
          {#if phraseMedia.caption}<span>{phraseMedia.caption}</span>{/if}
          <button type="button" class="di-lightbox-x" bind:this={clipClose} onclick={closeClip}>Close</button>
        </div>
      </div>
    </div>
  {/if}
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
  /* flow-root contains the floated clip so the origin rule sits below both columns */
  .di-phrase-body { display:flow-root; margin-top:16px; }
  .di-clip { float:right; width:150px; margin:0 0 12px 18px; }
  .di-clip video, .di-clip img { display:block; width:150px; height:150px; object-fit:cover; border:1px solid var(--line); border-radius:var(--r-2); background:var(--ink-0); }
  .di-clip-btn { display:block; padding:0; border:0; background:none; cursor:zoom-in; }
  .di-clip-btn:focus-visible { outline:2px solid var(--mash-pulp); outline-offset:3px; }
  .di-clip figcaption { margin-top:6px; color:var(--fg-quiet); font:600 9px/1.3 var(--font-mono); text-transform:uppercase; letter-spacing:.04em; text-align:center; }
  @media(max-width:520px){ .di-clip { float:none; width:100%; margin:0 0 12px; } .di-clip video, .di-clip img { width:100%; height:auto; aspect-ratio:1; } }
  .di-scrim { position:fixed; inset:0; z-index:120; display:flex; align-items:center; justify-content:center; padding:20px; background:rgba(7,9,12,.62); }
  .di-lightbox { width:100%; max-width:520px; padding:12px; background:var(--surface); border:1px solid var(--line-strong); border-radius:var(--r-3); }
  .di-lightbox video, .di-lightbox img { display:block; width:100%; max-height:70vh; object-fit:contain; border-radius:var(--r-2); background:var(--ink-0); }
  .di-lightbox-foot { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-top:10px; color:var(--fg-quiet); font:600 9px/1.3 var(--font-mono); text-transform:uppercase; letter-spacing:.04em; }
  .di-lightbox-x { padding:7px 12px; color:var(--fg); background:var(--ink-0); border:1px solid var(--line-strong); border-radius:999px; font:700 10px/1 var(--font-mono); text-transform:uppercase; letter-spacing:.06em; cursor:pointer; }
  .di-lightbox-x:hover { border-color:var(--mash-pulp); }
  /* The word is the whole card, so the word carries the accent; the
     pronunciation line stays legible but steps back to muted/secondary. */
  .di-term { margin:2px 0 0; color:var(--mash-pulp); font:800 clamp(28px,6.5vw,34px)/.95 var(--font-display); letter-spacing:-.02em; }
  .di-pron { margin:7px 0 0; color:var(--fg-quiet); font:400 14px/1.4 var(--font-mono); }
  .di-pos { margin-left:8px; color:var(--fg-muted); font-weight:600; }
  .di-def { margin:0; max-width:60ch; color:var(--fg-2); font:400 14px/1.6 var(--font-body); }
  .di-def-num { margin-right:8px; color:var(--mash-pulp); font:700 12px/1 var(--font-mono); }
  .di-usages { margin-top:14px; display:grid; gap:10px; }
  .di-usage { padding-left:13px; border-left:2px solid var(--line-strong); }
  .di-usage-label { display:block; margin-bottom:5px; color:var(--mash-pulp); font:700 8.5px/1 var(--font-mono); letter-spacing:.12em; text-transform:uppercase; }
  .di-usage-text { color:var(--fg-2); font:italic 400 13px/1.5 var(--font-body); }
  .di-usage-text b { padding:0 3px; color:var(--amber); background:var(--amber-soft); border-radius:3px; font-style:normal; font-weight:700; }
  .di-origin { margin:16px 0 0; padding-top:14px; border-top:1px solid var(--line); color:var(--fg-quiet); font:400 11.5px/1.5 var(--font-mono); }
  .di-origin b { color:var(--fg-muted); font-weight:700; }
  /* the origin sentence is the link — it stays prose, it doesn't turn blue */
  .di-origin a { color:inherit; text-decoration:underline; text-decoration-color:var(--line-strong); text-underline-offset:3px; }
  .di-origin a:hover { color:var(--fg-muted); text-decoration-color:var(--mash-pulp); }
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
