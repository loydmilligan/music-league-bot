<script lang="ts">
  import type { ResearchSong, Settings } from '$lib/types.js';
  import { computeScore } from '$lib/scoring.js';
  import SongCard from '$lib/song/SongCard.svelte';
  import { adapters } from '$lib/song/adapters.js';
  import type { SongRatings, SongCardConfig, Song } from '$lib/song/canonical.js';

  let { roundId, initial, weights }: {
    roundId: number;
    initial: ResearchSong[];
    weights: Settings;
  } = $props();

  type SearchResult = { uri: string; name: string; artists: string; album: string; year: string; imageUrl: string | null };

  let songs = $state<ResearchSong[]>(initial.map((s: ResearchSong) => ({ ...s, score: computeScore(s, weights) })));
  let query = $state('');
  let searching = $state(false);
  let searchResults = $state<SearchResult[]>([]);
  let searchError = $state<string | null>(null);
  let busyAddUris = $state<Set<string>>(new Set());

  const RR_CONFIG: SongCardConfig = {
    art: false,
    ratingMode: 'bars',
    ratingEditable: true,
    layers: ['state', 'rating', 'notes', 'analyze'],
    actions: ['play', 'ytm', 'save', 'remove'],
    actionStyle: 'inline',
  };

  // Sort order is user-controlled. The list does NOT re-sort on every rating
  // click — clicking jumps the active song mid-flow otherwise. Instead we hold
  // a snapshot of song ids in display order and only refresh it on:
  //   - explicit "Re-sort" button click
  //   - auto trigger (opt-in via toggle) when a song reaches all 4 ratings set
  function orderByScore(list: ResearchSong[]): number[] {
    return [...list].sort((a, b) => (b.score ?? -1) - (a.score ?? -1)).map((s) => s.id);
  }
  let orderedIds = $state<number[]>(orderByScore(songs));

  // Auto-sort preference is a client-side UX preference, persisted in
  // localStorage rather than on the server (server settings = rating weights).
  const AUTO_SORT_KEY = 'mlb.research.autoSortAfterAll4';
  let autoSortAfterAll4 = $state<boolean>(false);
  if (typeof localStorage !== 'undefined') {
    autoSortAfterAll4 = localStorage.getItem(AUTO_SORT_KEY) === '1';
  }
  function setAutoSort(on: boolean) {
    autoSortAfterAll4 = on;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(AUTO_SORT_KEY, on ? '1' : '0');
    }
  }

  function resort() {
    orderedIds = orderByScore(songs);
  }

  function hasAllFourRatings(s: ResearchSong): boolean {
    return s.discoveryPotential != null
      && s.themeFit != null
      && s.quality != null
      && s.replayability != null;
  }

  function toCard(s: ResearchSong): Song {
    return adapters.fromResearch(s as unknown as Record<string, unknown>);
  }

  async function handleRate(ratings: SongRatings, song: Song) {
    const s = songs.find(r => String(r.id) === song.id);
    if (!s) return;
    const patch = {
      discoveryPotential: ratings.discovery,
      themeFit: ratings.themeFit,
      quality: ratings.quality,
      replayability: ratings.replayability,
    };
    // optimistic update
    const wasComplete = hasAllFourRatings(s);
    const optimistic = { ...s, ...patch };
    const willBeComplete = hasAllFourRatings(optimistic as ResearchSong);
    patchSong(s.id, patch);
    if (autoSortAfterAll4 && willBeComplete && !wasComplete) resort();
  }

  async function handleNotes(text: string, song: Song) {
    const s = songs.find(r => String(r.id) === song.id);
    if (!s) return;
    patchSong(s.id, { notes: text || null });
  }

  async function handleAction(actionId: string, song: Song) {
    const s = songs.find(r => String(r.id) === song.id);
    if (!s) return;
    if (actionId === 'play') {
      const trackId = s.spotifyUri.replace('spotify:track:', '');
      window.open(`https://open.spotify.com/track/${trackId}`, '_blank');
    } else if (actionId === 'ytm') {
      const url = song.ytmUrl || `/api/ytm/${encodeURIComponent(s.spotifyUri)}?redirect=1`;
      window.open(url, '_blank');
    } else if (actionId === 'save') {
      patchSong(s.id, { saveForFuture: !s.saveForFuture });
    } else if (actionId === 'remove') {
      removeSong(s.id);
    } else if (actionId === 'analyze') {
      if (s.spotifyUri) {
        await fetch(`/api/songs/${encodeURIComponent(s.spotifyUri)}/enrich`, { method: 'POST' });
      }
    }
  }

  async function handleAnalyze(song: Song) {
    const s = songs.find(r => String(r.id) === song.id);
    if (!s || !s.spotifyUri) return;
    await fetch(`/api/songs/${encodeURIComponent(s.spotifyUri)}/enrich`, { method: 'POST' });
  }

  async function runSearch(e: SubmitEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    searching = true; searchError = null;
    try {
      const res = await fetch(`/api/spotify/search?q=${encodeURIComponent(query)}`);
      if (!res.ok) throw new Error(`Search failed (${res.status})`);
      searchResults = await res.json();
    } catch (err) {
      searchError = err instanceof Error ? err.message : 'Search failed';
      searchResults = [];
    } finally {
      searching = false;
    }
  }

  async function addCandidate(r: SearchResult) {
    if (busyAddUris.has(r.uri)) return;
    busyAddUris = new Set([...busyAddUris, r.uri]);
    try {
      const res = await fetch(`/api/research/${roundId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spotifyUri: r.uri, title: r.name, artist: r.artists, album: r.album }),
      });
      if (!res.ok) throw new Error(`Add failed (${res.status})`);
      const created = await res.json() as ResearchSong;
      if (!songs.some(s => s.id === created.id)) {
        songs = [...songs, { ...created, score: computeScore(created, weights) }];
        if (!orderedIds.includes(created.id)) orderedIds = [...orderedIds, created.id];
      }
    } catch (err) {
      searchError = err instanceof Error ? err.message : 'Add failed';
    } finally {
      const next = new Set(busyAddUris); next.delete(r.uri); busyAddUris = next;
    }
  }

  async function patchSong(id: number, patch: Record<string, unknown>) {
    const idx = songs.findIndex(s => s.id === id);
    if (idx < 0) return;
    const prev = songs[idx];
    const optimistic = { ...prev, ...patch } as ResearchSong;
    optimistic.score = computeScore(optimistic, weights);
    songs = songs.map(s => s.id === id ? optimistic : s);
    try {
      const res = await fetch(`/api/research/${roundId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...patch }),
      });
      if (!res.ok) throw new Error(`Update failed (${res.status})`);
      const updated = await res.json() as ResearchSong;
      songs = songs.map(s => s.id === id ? { ...updated, score: computeScore(updated, weights) } : s);
    } catch {
      songs = songs.map(s => s.id === id ? prev : s);
    }
  }

  async function removeSong(id: number) {
    if (!confirm('Remove this song from research?')) return;
    const prev = songs;
    const prevOrder = orderedIds;
    songs = songs.filter(s => s.id !== id);
    orderedIds = orderedIds.filter(x => x !== id);
    const res = await fetch(`/api/research/${roundId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    if (!res.ok) { songs = prev; orderedIds = prevOrder; }
  }

  // Display order = the user-controlled snapshot in `orderedIds`, with any
  // songs not yet in the snapshot (just-added) appended at the end.
  const sorted = $derived.by<ResearchSong[]>(() => {
    const byId = new Map(songs.map((s) => [s.id, s]));
    const out: ResearchSong[] = [];
    for (const id of orderedIds) {
      const s = byId.get(id);
      if (s) { out.push(s); byId.delete(id); }
    }
    for (const s of byId.values()) out.push(s);
    return out;
  });
</script>

<div class="space-y-6">
  <!-- Spotify search -->
  <section class="bg-bg-elevated border border-border-muted rounded-xl p-4">
    <h3 class="font-mono text-xs tracking-widest uppercase text-fg-faint mb-3">Search Spotify</h3>
    <form onsubmit={runSearch} class="flex gap-2 mb-3">
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
      <p class="font-mono text-xs text-warn mb-2">{searchError}</p>
    {/if}

    {#if searchResults.length}
      <div class="flex flex-col gap-1.5">
        {#each searchResults as r}
          {@const already = songs.some(s => s.spotifyUri === r.uri)}
          <div class="flex items-center gap-3 px-3 py-2 rounded bg-bg border border-border-muted">
            {#if r.imageUrl}
              <img src={r.imageUrl} alt="" class="w-10 h-10 rounded flex-shrink-0" />
            {:else}
              <div class="w-10 h-10 rounded bg-surface flex-shrink-0"></div>
            {/if}
            <div class="flex-1 min-w-0">
              <div class="font-bold text-fg text-sm truncate">{r.name}</div>
              <div class="font-mono text-[11px] text-fg-dim truncate">
                {r.artists} · {r.album}{r.year ? ` (${r.year})` : ''}
              </div>
            </div>
            <button
              type="button"
              onclick={() => addCandidate(r)}
              disabled={already || busyAddUris.has(r.uri)}
              class="text-xs font-mono tracking-widest uppercase px-3 py-1 rounded-sm flex-shrink-0 transition-colors"
              class:bg-accent={!already}
              class:hover:bg-accent-strong={!already}
              class:text-white={!already}
              class:bg-surface={already}
              class:text-fg-faint={already}
            >
              {already ? 'Added' : busyAddUris.has(r.uri) ? '…' : '+ Add'}
            </button>
          </div>
        {/each}
      </div>
    {/if}
  </section>

  <!-- Candidates -->
  <section>
    <div class="flex items-center flex-wrap gap-3 mb-3">
      <h3 class="font-mono text-xs tracking-widest uppercase text-fg-faint">
        Candidates [{songs.length}]
      </h3>
      {#if songs.length > 1}
        <button
          type="button"
          onclick={resort}
          class="bg-accent hover:bg-accent-strong text-white px-3 py-1 rounded-sm text-[11px] font-mono tracking-widest uppercase transition-colors"
        >
          Re-sort
        </button>
        <label class="flex items-center gap-1.5 text-fg-muted cursor-pointer font-mono text-[11px] ml-auto">
          <input
            type="checkbox"
            checked={autoSortAfterAll4}
            onchange={(e) => setAutoSort((e.currentTarget as HTMLInputElement).checked)}
            class="accent-accent"
          />
          Auto-sort after all 4 ratings entered
        </label>
      {/if}
    </div>
    {#if !sorted.length}
      <p class="text-fg-faint text-sm font-mono italic">No research candidates yet. Search above to add some.</p>
    {:else}
      <div class="flex flex-col gap-3">
        {#each sorted as song (song.id)}
          <SongCard
            density="expanded"
            song={toCard(song)}
            config={{ ...RR_CONFIG, noteText: song.notes ?? undefined }}
            onAction={handleAction}
            onRate={handleRate}
            onNotes={handleNotes}
            onAnalyze={handleAnalyze}
          />
        {/each}
      </div>
    {/if}
  </section>
</div>
