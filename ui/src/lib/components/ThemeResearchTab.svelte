<script lang="ts" module>
  // History → Tab 2 "Theme research". Browse every past theme/round prompt
  // across all seasons; expand one to see who submitted what + how it scored.
  // Data: GET /api/history/themes (sprint-24, backend lane). Contract:
  //   [{ theme, season, round, picks: [{ title, artist, submitter, points }] }]
  //
  // ── VIZ INTEGRATION SEAM (sprint-24, theme-patterns) ───────────────────
  // This tab owns scaffolding + data wiring ONLY. The cross-season pattern
  // encoding (recurring artists, the user's own past picks) layers on WITHOUT
  // editing this file, via the data-attributes each pick row emits:
  //     <li class="theme-pick" data-artist="…" data-submitter="…" data-points="…">
  // Write global CSS (and, if counting is needed, a small JS enhancement) keyed
  // on `.theme-pick[data-artist=…]` — same convention as the sprint-23
  // history-coloring layer on SongSearchCard. Do not refetch or re-wire data.
  // ───────────────────────────────────────────────────────────────────────
  export type ThemePick = {
    title: string;
    artist: string;
    submitter: string;
    points: number | null;
    albumArtUrl: string | null;
    popularityProxy: number | null;
    obscurity: number | null;
    obscurityBucket: string | null;
    energy: number | null;
    hasLyrics: boolean | null;
    bpm: number | null;
    musicalKey: string | null;
    scale: string | null;
    durationS: number | null;
    tags: string[];
  };
  export type ThemeRound = {
    theme: string;
    season: number;
    round: string;
    picks: ThemePick[];
  };
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import RingGauge from '$lib/song/RingGauge.svelte';
  import {
    buildIndicators,
    pointsLabel,
    lyricsHeadline,
    formatDuration,
    artInitial,
  } from '$lib/song/pickMetadata';

  let loading = $state(true);
  let loadError = $state<string | null>(null);
  let themes = $state<ThemeRound[]>([]);
  // One theme open at a time, keyed by a stable composite (season+round+theme).
  let openKey = $state<string | null>(null);
  // Per-pick metadata expand — independent, multiple may be open at once.
  let expandedPicks = $state<Set<string>>(new Set());

  const keyOf = (t: ThemeRound) => `${t.season}::${t.round}::${t.theme}`;
  const pickKey = (t: ThemeRound, p: ThemePick, i: number) =>
    `${keyOf(t)}::${i}::${p.title}::${p.submitter}`;

  function togglePick(pk: string) {
    const next = new Set(expandedPicks);
    if (next.has(pk)) next.delete(pk);
    else next.add(pk);
    expandedPicks = next;
  }

  onMount(async () => {
    try {
      const res = await fetch('/api/history/themes');
      if (!res.ok) throw new Error(`Failed to load themes (${res.status})`);
      themes = await res.json();
    } catch (err) {
      loadError = err instanceof Error ? err.message : 'Failed to load themes';
    } finally {
      loading = false;
    }
  });

  function toggle(key: string) {
    openKey = openKey === key ? null : key;
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape' || openKey === null) return;
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    openKey = null;
  }

  // Picks ranked by score so the winners read top-down inside an expanded theme.
  // Unvoted picks (points null) sort to the bottom.
  const ranked = (picks: ThemePick[]) =>
    [...picks].sort((a, b) => (b.points ?? -Infinity) - (a.points ?? -Infinity));
</script>

<svelte:window onkeydown={onKeydown} />

<div class="space-y-6">
  <section class="bg-bg-elevated border border-border-muted rounded-xl p-4">
    <h3 class="font-mono text-xs tracking-widest uppercase text-fg-faint mb-1">Theme research</h3>
    <p class="text-fg-muted text-sm leading-relaxed">
      Every past round prompt across our seasons. Expand a theme to see who chose what — and what scored.
    </p>
  </section>

  <section>
    {#if loading}
      <p class="text-fg-faint text-sm font-mono italic">Loading themes…</p>
    {:else if loadError}
      <p class="font-mono text-xs text-warn">{loadError}</p>
    {:else if !themes.length}
      <p class="text-fg-faint text-sm font-mono italic">No themes yet — once leagues are imported they show up here.</p>
    {:else}
      <h3 class="font-mono text-xs tracking-widest uppercase text-fg-faint mb-3">
        Themes [{themes.length}]
      </h3>
      <div class="flex flex-col gap-2">
        {#each themes as t (keyOf(t))}
          {@const key = keyOf(t)}
          {@const isOpen = openKey === key}
          {#if isOpen}
            <article class="bg-bg-elevated border border-accent-deep rounded-xl p-4">
              <header class="flex items-start gap-4">
                <div class="flex-1 min-w-0">
                  <div class="font-bold text-fg text-base leading-snug">{t.theme}</div>
                  <div class="font-mono text-[11px] text-fg-dim mt-0.5">
                    Season {t.season} · {t.round} · {t.picks.length} {t.picks.length === 1 ? 'pick' : 'picks'}
                  </div>
                </div>
                <button
                  type="button"
                  onclick={() => toggle(key)}
                  aria-label="Collapse theme"
                  class="flex-shrink-0 font-mono text-fg-faint hover:text-fg text-lg leading-none transition-colors"
                >×</button>
              </header>

              {#if t.picks.length}
                <ul class="mt-4 flex flex-col gap-2">
                  {#each ranked(t.picks) as p, i (pickKey(t, p, i))}
                    {@const pk = pickKey(t, p, i)}
                    {@const open = expandedPicks.has(pk)}
                    <li
                      class="theme-pick tr-pick"
                      class:tr-open={open}
                      data-artist={p.artist}
                      data-submitter={p.submitter}
                      data-points={p.points}
                    >
                      <button type="button" class="tr-pick-btn" onclick={() => togglePick(pk)} aria-expanded={open}>
                        <span class="tr-rank">{i + 1}</span>
                        {#if p.albumArtUrl}
                          <div class="usc-art-ph tr-art"><img src={p.albumArtUrl} alt="" /></div>
                        {:else}
                          <div class="usc-art-ph tr-art">{artInitial(p.title)}</div>
                        {/if}
                        <div class="tr-main">
                          <div class="tr-titleline">
                            <span class="tr-title">{p.title}</span>
                            <span class="tr-artist">{p.artist}</span>
                          </div>
                          <div class="tr-indicators">
                            {#each buildIndicators(p) as ind}
                              <RingGauge
                                kind={ind.kind}
                                pct={ind.pct}
                                colorVar={ind.colorVar}
                                opacity={ind.opacity}
                                tooltip={ind.tooltip}
                              />
                            {/each}
                            {#if p.tags.length}
                              <span class="tr-tag">{p.tags[0]}</span>
                            {/if}
                          </div>
                        </div>
                        <span class="tr-submitter">{p.submitter}</span>
                        <span class="tr-points">{pointsLabel(p.points)}</span>
                        <span class="tr-caret">{open ? '▾' : '▸'}</span>
                      </button>

                      {#if open}
                        <div class="tr-panel">
                          <div class="tr-panel-inner">
                            <div>
                              <div class="usc-layer-label">headline</div>
                              <div class="usc-stats">
                                <div class="usc-stat">
                                  <span class="k">Popularity</span>
                                  <span class="v">
                                    {#if p.popularityProxy !== null}{p.popularityProxy}<small> / obsc {p.obscurity}</small>{:else}—{/if}
                                  </span>
                                </div>
                                <div class="usc-stat">
                                  <span class="k">Tempo</span>
                                  <span class="v">
                                    {#if p.bpm !== null}{p.bpm}<small> bpm · {p.musicalKey} {p.scale}</small>{:else}—{/if}
                                  </span>
                                </div>
                                <div class="usc-stat">
                                  <span class="k">Energy</span>
                                  <span class="v" style="display:flex;align-items:center;gap:8px">
                                    {#if p.energy !== null}<span class="usc-energy"><i style={`width:${p.energy}%`}></i></span>{p.energy}{:else}—{/if}
                                  </span>
                                </div>
                                <div class="usc-stat">
                                  <span class="k">Lyrics</span>
                                  <span class="v">{lyricsHeadline(p.hasLyrics)}</span>
                                </div>
                                <div class="usc-stat">
                                  <span class="k">Duration</span>
                                  <span class="v">{formatDuration(p.durationS)}</span>
                                </div>
                              </div>
                            </div>
                            <div>
                              <div class="usc-layer-label">genre tags</div>
                              {#if p.tags.length}
                                <div class="usc-tags">
                                  {#each p.tags.slice(0, 5) as tag}
                                    <span class="usc-tag">{tag}</span>
                                  {/each}
                                </div>
                              {:else}
                                <div class="tr-note">not analyzed yet — genre tags fetch after import</div>
                              {/if}
                            </div>
                            <div class="tr-coming">
                              <div class="usc-layer-label">
                                🟡 coming soon <span class="tr-coming-note">— approved, not yet populated</span>
                              </div>
                              <div class="usc-stats">
                                <div class="usc-stat"><span class="k">Release year</span><span class="v tr-empty">—</span></div>
                                <div class="usc-stat"><span class="k">Explicit</span><span class="v tr-empty">—</span></div>
                                <div class="usc-stat"><span class="k">Tone</span><span class="v tr-empty">—</span></div>
                              </div>
                            </div>
                          </div>
                        </div>
                      {/if}
                    </li>
                  {/each}
                </ul>
              {:else}
                <p class="mt-4 text-fg-faint text-sm font-mono italic">No picks recorded for this theme.</p>
              {/if}

              <footer class="flex items-center mt-4 pt-3 border-t border-border-muted">
                <span class="ml-auto font-mono text-[10px] tracking-widest uppercase text-fg-faint">Esc to collapse</span>
              </footer>
            </article>
          {:else}
            <button
              type="button"
              onclick={() => toggle(key)}
              class="w-full flex items-center gap-3 px-3 py-2 rounded-xl bg-bg-elevated border border-border-muted hover:border-border text-left transition-colors"
            >
              <span class="flex-1 min-w-0">
                <span class="block font-bold text-fg text-sm truncate">{t.theme}</span>
                <span class="block font-mono text-[11px] text-fg-dim truncate">Season {t.season} · {t.round}</span>
              </span>
              <span class="flex-shrink-0 font-mono text-[10px] tracking-widest uppercase text-fg-faint">
                {t.picks.length} {t.picks.length === 1 ? 'pick' : 'picks'}
              </span>
            </button>
          {/if}
        {/each}
      </div>
    {/if}
  </section>
</div>

<style>
  /* Theme Research pick row — song-metadata display (sprint-25).
     Chrome/tokens per the design handoff; .usc-* and axis vars are global. */
  .tr-pick {
    border: 1px solid var(--line);
    border-radius: var(--r-3);
    background: var(--surface);
    transition: border-color 200ms;
  }
  .tr-pick.tr-open {
    border-color: var(--accent);
  }
  .tr-pick-btn {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 11px 14px;
    background: transparent;
    border: 0;
    cursor: pointer;
    text-align: left;
    font: inherit;
    color: inherit;
  }
  .tr-rank {
    flex: none;
    width: 20px;
    text-align: right;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--fg-quiet);
  }
  .tr-art {
    width: 34px;
    height: 34px;
    flex: none;
    font-size: 13px;
  }
  .tr-main {
    flex: 1;
    min-width: 0;
  }
  .tr-titleline {
    display: flex;
    align-items: baseline;
    gap: 8px;
    flex-wrap: wrap;
  }
  .tr-title {
    font-weight: 600;
    font-size: 14px;
    color: var(--fg);
  }
  .tr-artist {
    font-family: var(--font-mono);
    font-size: 11.5px;
    color: var(--fg-muted);
  }
  .tr-indicators {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 6px;
  }
  .tr-tag {
    font-family: var(--font-mono);
    font-size: 10.5px;
    font-weight: 500;
    padding: 2px 8px;
    border-radius: 999px;
    border: 1px solid color-mix(in oklch, var(--sky) 40%, var(--line));
    color: var(--sky);
    background: color-mix(in oklch, var(--sky) 12%, transparent);
  }
  .tr-submitter {
    flex: none;
    max-width: 7rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--fg-muted);
    background: var(--ink-2);
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 3px 10px;
  }
  .tr-points {
    flex: none;
    width: 26px;
    text-align: right;
    font-family: var(--font-display);
    font-weight: 700;
    font-size: 15px;
    color: var(--accent);
  }
  .tr-caret {
    flex: none;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--fg-quiet);
  }
  .tr-panel {
    padding: 0 14px 16px 66px;
  }
  .tr-panel-inner {
    padding-top: 12px;
    border-top: 1px solid var(--line);
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .tr-note {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--fg-quiet);
    font-style: italic;
  }
  .tr-coming {
    opacity: 0.55;
  }
  .tr-coming-note {
    text-transform: none;
    letter-spacing: 0;
    color: var(--fg-quiet);
    font-family: var(--font-mono);
  }
  .tr-empty {
    color: var(--fg-quiet);
  }
</style>
