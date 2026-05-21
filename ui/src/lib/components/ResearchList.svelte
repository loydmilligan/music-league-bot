<script lang="ts">
  import type { ResearchSong, Settings } from '$lib/types.js';
  import { computeScore } from '$lib/scoring.js';

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

  const dims = [
    { key: 'themeFit',           label: 'Theme'     },
    { key: 'discoveryPotential', label: 'Discovery' },
    { key: 'nostalgiaPotential', label: 'Nostalgia' },
    { key: 'personalRating',     label: 'Personal'  },
  ] as const;

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
    return s.themeFit != null
      && s.discoveryPotential != null
      && s.nostalgiaPotential != null
      && s.personalRating != null;
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

  function setRating(song: ResearchSong, key: typeof dims[number]['key'], value: number) {
    const current = song[key];
    const next = current === value ? null : value;
    const wasComplete = hasAllFourRatings(song);
    const willBeComplete = hasAllFourRatings({ ...song, [key]: next } as ResearchSong);
    patchSong(song.id, { [key]: next });
    if (autoSortAfterAll4 && willBeComplete && !wasComplete) {
      resort();
    }
  }

  function scoreToneClass(score: number | null | undefined): string {
    if (score == null) return 'text-fg-faint';
    if (score >= 4) return 'text-health';
    if (score >= 3) return 'text-warn';
    return 'text-fg-dim';
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
          <article class="bg-bg-elevated border border-border-muted rounded-xl p-4">
            <header class="flex items-start gap-3 mb-3">
              <div class="flex-1 min-w-0">
                <div class="font-bold text-fg truncate">{song.title}</div>
                <div class="font-mono text-[11px] text-fg-dim truncate">
                  {song.artist}{song.album ? ` · ${song.album}` : ''}
                </div>
                {#if song.submittedByMe || song.submittedByOther}
                  <div class="flex flex-wrap gap-1.5 mt-1.5">
                    {#if song.submittedByMe}
                      <span class="bg-accent-bg text-accent border border-accent-deep font-mono text-[10px] tracking-widest uppercase px-1.5 py-0.5 rounded-sm">
                        Submitted by me
                      </span>
                    {/if}
                    {#if song.submittedByOther}
                      <span class="bg-surface text-fg-dim border border-border-muted font-mono text-[10px] tracking-widest uppercase px-1.5 py-0.5 rounded-sm">
                        Submitted by other{song.otherSubmissionVotes != null ? ` · ${song.otherSubmissionVotes} pts` : ''}
                      </span>
                    {/if}
                  </div>
                {/if}
              </div>
              <div class="text-right flex-shrink-0">
                <div class="font-mono text-[10px] tracking-widest uppercase text-fg-faint">Score</div>
                <div class="text-3xl font-bold font-display {scoreToneClass(song.score)}">
                  {song.score != null ? song.score.toFixed(2) : '—'}
                </div>
              </div>
            </header>

            <!-- Ratings: 5-dot rows. Filled dots show current rating; clicking sets a new value, clicking same value clears. -->
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
              {#each dims as d}
                <div class="flex items-center gap-3">
                  <span class="font-mono text-[10px] tracking-widest uppercase text-fg-dim w-20 flex-shrink-0">{d.label}</span>
                  <div class="flex gap-1.5 items-center">
                    {#each [1,2,3,4,5] as n}
                      {@const active = song[d.key] != null && (song[d.key] as number) >= n}
                      <button
                        type="button"
                        onclick={() => setRating(song, d.key, n)}
                        aria-label={`${d.label} ${n}`}
                        class="w-3 h-3 rounded-full border transition-colors"
                        class:bg-accent={active}
                        class:border-accent={active}
                        class:bg-transparent={!active}
                        class:border-border={!active}
                        class:hover:border-accent-deep={!active}
                      ></button>
                    {/each}
                    {#if song[d.key] != null}
                      <button
                        type="button"
                        onclick={() => patchSong(song.id, { [d.key]: null })}
                        class="font-mono text-[10px] text-fg-faint hover:text-fg-dim ml-1 transition-colors"
                        aria-label={`Clear ${d.label}`}
                      >clear</button>
                    {/if}
                  </div>
                </div>
              {/each}
            </div>

            <textarea
              value={song.notes ?? ''}
              onchange={(e) => patchSong(song.id, { notes: (e.currentTarget as HTMLTextAreaElement).value || null })}
              placeholder="Notes…"
              rows="2"
              class="w-full bg-bg border border-border-muted focus:border-accent rounded px-2 py-1.5 text-xs text-fg placeholder-fg-faint mb-3 outline-none transition-colors"
            ></textarea>

            <footer class="flex items-center gap-4 text-xs">
              <label class="flex items-center gap-1.5 text-fg-muted cursor-pointer font-mono text-[11px]">
                <input
                  type="checkbox"
                  checked={song.saveForFuture}
                  onchange={(e) => patchSong(song.id, { saveForFuture: (e.currentTarget as HTMLInputElement).checked })}
                  class="accent-accent"
                />
                Save for future
              </label>
              <a
                href={`https://open.spotify.com/track/${song.spotifyUri.replace('spotify:track:', '')}`}
                target="_blank"
                rel="noreferrer"
                class="text-health hover:text-health/80 font-mono transition-colors"
              >Spotify ↗</a>
              <a
                href={`/api/ytm/${encodeURIComponent(song.spotifyUri)}?redirect=1`}
                target="_blank"
                rel="noreferrer"
                class="text-accent hover:text-accent-strong font-mono transition-colors"
              >YT Music ↗</a>
              <button
                type="button"
                onclick={() => removeSong(song.id)}
                class="ml-auto font-mono text-fg-faint hover:text-warn transition-colors"
              >Remove</button>
            </footer>
          </article>
        {/each}
      </div>
    {/if}
  </section>
</div>
