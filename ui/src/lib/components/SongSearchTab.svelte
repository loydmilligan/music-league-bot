<script lang="ts">
  // History → Tab 1 "Song search". Spotify search box → results as SongCards
  // using adapters.fromSearch so corpus info, badges, and history coloring all
  // flow through the universal SongCard model. statusMap + badgeMap load async
  // after search; fromSearch is called inline per-card so cards update reactively.
  import { onMount } from 'svelte';
  import { type SpotifyResult } from './SongSearchCard.svelte';
  import SongCard from '$lib/song/SongCard.svelte';
  import PromoteActions from './PromoteActions.svelte';
  import { adapters } from '$lib/song/adapters.js';
  import type { SongCardConfig } from '$lib/song/canonical.js';
  import type { SongStatusMap } from '$lib/db/songHistory.js';
  import type { BadgeMap } from '$lib/db/badges.js';

  // Promote-actions supporting data — loaded once on mount, shared across all
  // cards so the tab makes 2 requests total (not N×cards).
  type OpenRound = { id: number; name: string; description: string | null; submissionDeadline: string | null; leagueName: string };
  let activeRoundId = $state<number | null>(null);
  let openRounds = $state<OpenRound[]>([]);

  onMount(async () => {
    const [arRes, orRes] = await Promise.all([
      fetch('/api/active-rounds'),
      fetch('/api/rounds/open'),
    ]);
    if (arRes.ok) {
      const { leagues } = await arRes.json() as { leagues: { activeRound: { id: number } | null }[] };
      const first = leagues.find((l) => l.activeRound);
      activeRoundId = first?.activeRound?.id ?? null;
    }
    if (orRes.ok) openRounds = await orRes.json();
  });

  let query = $state('');
  let searching = $state(false);
  let searchError = $state<string | null>(null);
  let results = $state<SpotifyResult[]>([]);
  let hasSearched = $state(false);
  // One card open at a time, keyed by spotify uri.
  let openUri = $state<string | null>(null);
  // History + badge data keyed by uri — fetched in one batch after search.
  let statusMap = $state<SongStatusMap>({});
  let badgeMap = $state<BadgeMap>({});

  const SEARCH_CONFIG: SongCardConfig = {
    layers: ['badges', 'corpus'],
    actions: [],
    art: true,
    artPx: 72,
    ratingMode: 'none',
  };

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
      loadHistory(results);
    } catch (err) {
      searchError = err instanceof Error ? err.message : 'Search failed';
      results = [];
    } finally {
      searching = false;
      hasSearched = true;
    }
  }

  // Batch-resolve history status + badges for the result page. Non-fatal: a
  // failure just leaves cards uncoloured/unbadged — search still works.
  async function loadHistory(rows: SpotifyResult[]) {
    statusMap = {};
    badgeMap = {};
    if (!rows.length) return;
    const items = rows.map((r) => ({ uri: r.uri, artist: r.artists }));
    const [status, badges] = await Promise.allSettled([
      fetch('/api/history/song-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uris: items }),
      }).then((r) => (r.ok ? r.json() : {})),
      fetch('/api/history/badges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      }).then((r) => (r.ok ? r.json() : {})),
    ]);
    if (status.status === 'fulfilled') statusMap = status.value;
    if (badges.status === 'fulfilled') badgeMap = badges.value;
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
          {@const song = adapters.fromSearch(
            r as unknown as Record<string, unknown>,
            statusMap[r.uri],
            badgeMap[r.uri],
          )}
          <SongCard
            {song}
            config={SEARCH_CONFIG}
            expanded={openUri === r.uri}
            onToggle={() => toggle(r.uri)}
          >
            {#snippet expandedFooter()}
              <PromoteActions result={r} {activeRoundId} {openRounds} />
            {/snippet}
          </SongCard>
        {/each}
      </div>
    {:else if hasSearched && !searching && !searchError}
      <p class="text-fg-faint text-sm font-mono italic">No results — try a different search.</p>
    {:else if !hasSearched}
      <p class="text-fg-faint text-sm font-mono italic">Search Spotify above to research songs across our leagues.</p>
    {/if}
  </section>
</div>
