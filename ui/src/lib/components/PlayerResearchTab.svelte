<script lang="ts" module>
  // History → Tab 3 "Player research". Pick a player from the roster → see
  // their submitted songs, win rate, and taste overlap with everyone else.
  // Data (sprint-24, backend lane):
  //   GET /api/history/players        → [{ name, songsSubmitted, winRate }]
  //   GET /api/history/players/:name  → { songs:[{round,title,artist,points}],
  //                                       winRate, tasteOverlap:{ name: score } }
  //
  // ── VIZ INTEGRATION SEAM (sprint-24, taste-overlap) ────────────────────
  // This tab owns scaffolding + data wiring ONLY. The taste-overlap viz (ranked
  // overlap bars) layers on WITHOUT editing this file, via the markup the
  // overlap section emits:
  //     <div class="taste-overlap">
  //       <div class="taste-overlap-row" data-name="…" data-score="0.42">…</div>
  // Rows arrive pre-sorted (highest overlap first). Write global CSS keyed on
  // `.taste-overlap-row` (use the data-score for bar width) — reusing the
  // sprint-23 color encoding. Do not refetch; consume the data already loaded.
  // ───────────────────────────────────────────────────────────────────────
  export type PlayerSummary = {
    name: string;
    songsSubmitted: number;
    winRate: number;
  };
  export type PlayerSong = {
    round: string;
    title: string;
    artist: string;
    points: number;
  };
  export type PlayerDetail = {
    songs: PlayerSong[];
    winRate: number;
    tasteOverlap: Record<string, number>;
  };
</script>

<script lang="ts">
  import { onMount } from 'svelte';

  let loading = $state(true);
  let loadError = $state<string | null>(null);
  let players = $state<PlayerSummary[]>([]);

  let selected = $state<string | null>(null);
  let detail = $state<PlayerDetail | null>(null);
  let detailLoading = $state(false);
  let detailError = $state<string | null>(null);

  onMount(async () => {
    try {
      const res = await fetch('/api/history/players');
      if (!res.ok) throw new Error(`Failed to load players (${res.status})`);
      players = await res.json();
    } catch (err) {
      loadError = err instanceof Error ? err.message : 'Failed to load players';
    } finally {
      loading = false;
    }
  });

  async function selectPlayer(name: string) {
    if (selected === name) {
      selected = null;
      detail = null;
      return;
    }
    selected = name;
    detail = null;
    detailError = null;
    detailLoading = true;
    try {
      const res = await fetch(`/api/history/players/${encodeURIComponent(name)}`);
      if (!res.ok) throw new Error(`Failed to load ${name} (${res.status})`);
      detail = await res.json();
    } catch (err) {
      detailError = err instanceof Error ? err.message : 'Failed to load player';
    } finally {
      detailLoading = false;
    }
  }

  const pct = (winRate: number) => `${Math.round(winRate * 100)}%`;

  // Picks ranked by score; overlap rows ranked by score for the viz layer.
  const rankedSongs = (songs: PlayerSong[]) => [...songs].sort((a, b) => b.points - a.points);
  const rankedOverlap = (m: Record<string, number>) =>
    Object.entries(m).sort((a, b) => b[1] - a[1]);
</script>

<div class="space-y-6">
  <section class="bg-bg-elevated border border-border-muted rounded-xl p-4">
    <h3 class="font-mono text-xs tracking-widest uppercase text-fg-faint mb-1">Player research</h3>
    <p class="text-fg-muted text-sm leading-relaxed">
      Everyone we've played with. Pick a player to read their submissions, win rate, and whose taste they share.
    </p>
  </section>

  <!-- Player picker -->
  <section>
    {#if loading}
      <p class="text-fg-faint text-sm font-mono italic">Loading players…</p>
    {:else if loadError}
      <p class="font-mono text-xs text-warn">{loadError}</p>
    {:else if !players.length}
      <p class="text-fg-faint text-sm font-mono italic">No players yet — once leagues are imported they show up here.</p>
    {:else}
      <h3 class="font-mono text-xs tracking-widest uppercase text-fg-faint mb-3">
        Players [{players.length}]
      </h3>
      <div class="flex flex-wrap gap-2">
        {#each players as p (p.name)}
          {@const isSel = selected === p.name}
          <button
            type="button"
            onclick={() => selectPlayer(p.name)}
            aria-pressed={isSel}
            class="flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
            class:bg-accent={isSel}
            class:text-white={isSel}
            class:border-accent-deep={isSel}
            class:bg-bg-elevated={!isSel}
            class:text-fg-muted={!isSel}
            class:border-border-muted={!isSel}
            class:hover:border-border={!isSel}
          >
            <span class="font-medium whitespace-nowrap">{p.name}</span>
            <span class="font-mono text-[10px]" class:text-white={isSel} class:text-fg-faint={!isSel}>
              {p.songsSubmitted}♪ · {pct(p.winRate)}
            </span>
          </button>
        {/each}
      </div>
    {/if}
  </section>

  <!-- Per-player panel -->
  {#if selected}
    <section class="bg-bg-elevated border border-accent-deep rounded-xl p-4">
      {#if detailLoading}
        <p class="text-fg-faint text-sm font-mono italic">Loading {selected}…</p>
      {:else if detailError}
        <p class="font-mono text-xs text-warn">{detailError}</p>
      {:else if detail}
        <header class="flex items-center gap-4">
          <div class="flex-1 min-w-0">
            <div class="font-display text-xl font-bold text-fg truncate">{selected}</div>
            <div class="font-mono text-[11px] text-fg-dim mt-0.5">
              {detail.songs.length} {detail.songs.length === 1 ? 'song' : 'songs'} submitted · {pct(detail.winRate)} win rate
            </div>
          </div>
          <button
            type="button"
            onclick={() => selectPlayer(selected!)}
            aria-label="Close player"
            class="flex-shrink-0 font-mono text-fg-faint hover:text-fg text-lg leading-none transition-colors"
          >×</button>
        </header>

        <!-- Songs submitted -->
        <div class="mt-4">
          <h4 class="font-mono text-[10px] tracking-widest uppercase text-fg-faint mb-2">Songs submitted</h4>
          {#if detail.songs.length}
            <ul class="flex flex-col divide-y divide-border-muted">
              {#each rankedSongs(detail.songs) as s (s.round + '::' + s.title)}
                <li class="flex items-center gap-3 py-2 first:pt-0">
                  <span class="flex-1 min-w-0">
                    <span class="block font-bold text-fg text-sm truncate">{s.title}</span>
                    <span class="block font-mono text-[11px] text-fg-dim truncate">{s.artist} · {s.round}</span>
                  </span>
                  <span class="flex-shrink-0 font-mono text-xs tabular-nums text-accent w-10 text-right">{s.points}</span>
                </li>
              {/each}
            </ul>
          {:else}
            <p class="text-fg-faint text-sm font-mono italic">No songs recorded.</p>
          {/if}
        </div>

        <!-- Taste overlap (viz layer renders ranked bars off this markup) -->
        {#if detail.tasteOverlap && Object.keys(detail.tasteOverlap).length}
          <div class="mt-4 pt-3 border-t border-border-muted">
            <h4 class="font-mono text-[10px] tracking-widest uppercase text-fg-faint mb-2">Taste overlap</h4>
            <div class="taste-overlap flex flex-col gap-1">
              {#each rankedOverlap(detail.tasteOverlap) as [name, score] (name)}
                <div
                  class="taste-overlap-row flex items-center gap-3 py-1"
                  data-name={name}
                  data-score={score}
                >
                  <span class="flex-1 min-w-0 font-mono text-[11px] text-fg-muted truncate">{name}</span>
                  <span class="flex-shrink-0 font-mono text-xs tabular-nums text-accent w-12 text-right">{pct(score)}</span>
                </div>
              {/each}
            </div>
          </div>
        {/if}
      {/if}
    </section>
  {/if}
</div>
