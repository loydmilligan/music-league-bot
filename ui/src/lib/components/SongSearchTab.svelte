<script lang="ts">
  // History → Tab 1 "Song search". Spotify search box → results as collapsed
  // cards (one open at a time, Esc collapses — card model mirrors shortlist).
  // Wires to the EXISTING GET /api/spotify/search; no new search backend.
  //
  // History coloring (D3), badges (D6/D7), promote actions, and the
  // corpus-history panel layer onto SongSearchCard in later waves — this tab
  // owns search + the open-one-at-a-time card model only.
  import SongSearchCard, { type SpotifyResult } from './SongSearchCard.svelte';

  let query = $state('');
  let searching = $state(false);
  let searchError = $state<string | null>(null);
  let results = $state<SpotifyResult[]>([]);
  let hasSearched = $state(false);
  // One card open at a time, keyed by spotify uri (results have no db id yet).
  let openUri = $state<string | null>(null);

  async function runSearch(e: SubmitEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    searching = true;
    searchError = null;
    try {
      const res = await fetch(`/api/spotify/search?q=${encodeURIComponent(query)}`);
      if (!res.ok) throw new Error(`Search failed (${res.status})`);
      results = await res.json();
      openUri = null;
    } catch (err) {
      searchError = err instanceof Error ? err.message : 'Search failed';
      results = [];
    } finally {
      searching = false;
      hasSearched = true;
    }
  }

  function toggle(uri: string) {
    openUri = openUri === uri ? null : uri;
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape' || openUri === null) return;
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    openUri = null;
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="space-y-6">
  <!-- Spotify search -->
  <section class="bg-bg-elevated border border-border-muted rounded-xl p-4">
    <h3 class="font-mono text-xs tracking-widest uppercase text-fg-faint mb-3">Search Spotify</h3>
    <form onsubmit={runSearch} class="flex gap-2">
      <input
        type="text"
        bind:value={query}
        placeholder="Song, artist, album…"
        class="flex-1 bg-bg border border-border-muted focus:border-accent rounded px-3 py-1.5 text-sm text-fg placeholder-fg-faint outline-none transition-colors"
      />
      <button
        type="submit"
        disabled={searching || !query.trim()}
        class="bg-accent hover:bg-accent-strong disabled:bg-surface disabled:text-fg-faint disabled:cursor-not-allowed text-white px-4 py-1.5 rounded-sm text-xs font-mono tracking-widest uppercase transition-colors"
      >
        {searching ? 'Searching…' : 'Search'}
      </button>
    </form>
    {#if searchError}
      <p class="font-mono text-xs text-warn mt-2">{searchError}</p>
    {/if}
  </section>

  <!-- Results -->
  <section>
    {#if results.length}
      <h3 class="font-mono text-xs tracking-widest uppercase text-fg-faint mb-3">
        Results [{results.length}]
      </h3>
      <div class="flex flex-col gap-2">
        {#each results as r (r.uri)}
          <SongSearchCard result={r} open={openUri === r.uri} ontoggle={() => toggle(r.uri)} />
        {/each}
      </div>
    {:else if hasSearched && !searching && !searchError}
      <p class="text-fg-faint text-sm font-mono italic">No results — try a different search.</p>
    {:else if !hasSearched}
      <p class="text-fg-faint text-sm font-mono italic">Search Spotify above to research songs across our leagues.</p>
    {/if}
  </section>
</div>
