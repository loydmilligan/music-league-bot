<script lang="ts" module>
  // The shape returned by GET /api/spotify/search (see
  // src/routes/api/spotify/search/+server.ts). Shared with SongSearchTab.
  export type SpotifyResult = {
    uri: string;
    name: string;
    artists: string;
    album: string;
    year: string;
    imageUrl: string | null;
  };
</script>

<script lang="ts">
  // One song result in the History → Song search tab. Renders collapsed by
  // default; the parent (SongSearchTab) enforces one-open-at-a-time and Esc.
  //
  // WAVE-2 / VIZ INTEGRATION POINTS (intentionally left as stable seams):
  //   - history-coloring (viz, D3): styles the <article> border + fill and the
  //     collapsed-row status pills from song-history-api status.
  //   - badge-system (viz, D6/D7): song + artist badge areas (full set in the
  //     expanded card, a subtle hint on the collapsed row).
  //   - promote-actions (frontend wave-2): the expanded `.actions` region.
  //   - corpus-history-panel (frontend wave-2): the expanded `.history` region.
  // Wave-1 keeps these as empty seams so those lanes plug in without rework.

  const { result, open = false, ontoggle }: {
    result: SpotifyResult;
    open?: boolean;
    ontoggle: () => void;
  } = $props();

  const trackId = $derived(result.uri.replace('spotify:track:', ''));
  const sub = $derived(
    [result.artists, result.album].filter(Boolean).join(' · ') +
      (result.year ? ` (${result.year})` : ''),
  );
</script>

{#if open}
  <article class="bg-bg-elevated border border-accent-deep rounded-xl p-4">
    <header class="flex items-start gap-4">
      {#if result.imageUrl}
        <img src={result.imageUrl} alt="" width="72" height="72" class="rounded-lg flex-shrink-0" />
      {:else}
        <div class="w-[72px] h-[72px] rounded-lg bg-surface flex-shrink-0"></div>
      {/if}
      <div class="flex-1 min-w-0">
        <div class="font-bold text-fg text-base leading-snug">{result.name}</div>
        <div class="font-mono text-[11px] text-fg-dim mt-0.5">{sub}</div>
        <!-- badge-system (viz): full song + artist badge sets render here -->
      </div>
      <button
        type="button"
        onclick={ontoggle}
        aria-label="Collapse card"
        class="flex-shrink-0 font-mono text-fg-faint hover:text-fg text-lg leading-none transition-colors"
      >×</button>
    </header>

    <!-- corpus-history-panel (frontend wave-2): appearances + chat mentions -->

    <!-- promote-actions (frontend wave-2): + Shortlist / + Round / + H2H / ▶ Play -->
    <footer class="flex items-center gap-4 mt-4 pt-3 border-t border-border-muted text-xs">
      <a
        href={`https://open.spotify.com/track/${trackId}`}
        target="_blank"
        rel="noreferrer"
        class="text-health hover:text-health/80 font-mono transition-colors"
      >Spotify ↗</a>
      <span class="ml-auto font-mono text-[10px] tracking-widest uppercase text-fg-faint">Esc to collapse</span>
    </footer>
  </article>
{:else}
  <button
    type="button"
    onclick={ontoggle}
    class="w-full flex items-center gap-3 px-3 py-2 rounded-xl bg-bg-elevated border border-border-muted hover:border-border text-left transition-colors"
  >
    {#if result.imageUrl}
      <img src={result.imageUrl} alt="" width="44" height="44" class="rounded flex-shrink-0" />
    {:else}
      <span class="w-11 h-11 rounded bg-surface flex-shrink-0"></span>
    {/if}
    <span class="flex-1 min-w-0">
      <span class="block font-bold text-fg text-sm truncate">{result.name}</span>
      <span class="block font-mono text-[11px] text-fg-dim truncate">{sub}</span>
    </span>
    <!-- history-coloring (viz): collapsed-row status pills + artist-badge hint -->
  </button>
{/if}
