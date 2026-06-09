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
    points: number;
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

  let loading = $state(true);
  let loadError = $state<string | null>(null);
  let themes = $state<ThemeRound[]>([]);
  // One theme open at a time, keyed by a stable composite (season+round+theme).
  let openKey = $state<string | null>(null);

  const keyOf = (t: ThemeRound) => `${t.season}::${t.round}::${t.theme}`;

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
  const ranked = (picks: ThemePick[]) => [...picks].sort((a, b) => b.points - a.points);
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
                <ul class="mt-4 flex flex-col divide-y divide-border-muted">
                  {#each ranked(t.picks) as p (p.title + '::' + p.submitter)}
                    <li
                      class="theme-pick flex items-center gap-3 py-2 first:pt-0"
                      data-artist={p.artist}
                      data-submitter={p.submitter}
                      data-points={p.points}
                    >
                      <span class="flex-1 min-w-0">
                        <span class="block font-bold text-fg text-sm truncate">{p.title}</span>
                        <span class="block font-mono text-[11px] text-fg-dim truncate">{p.artist}</span>
                      </span>
                      <span class="flex-shrink-0 font-mono text-[11px] text-fg-muted truncate max-w-[8rem] text-right">{p.submitter}</span>
                      <span class="flex-shrink-0 font-mono text-xs tabular-nums text-accent w-10 text-right">{p.points}</span>
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
