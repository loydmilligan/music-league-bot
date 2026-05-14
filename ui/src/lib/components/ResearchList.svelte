<script lang="ts">
  import type { ResearchSong, Settings } from '$lib/types.js';
  import { computeScore } from '$lib/scoring.js';

  let { roundId, initial, weights } = $props<{
    roundId: number;
    initial: ResearchSong[];
    weights: Settings;
  }>();

  type SearchResult = { uri: string; name: string; artists: string; album: string; year: string; imageUrl: string | null };

  let songs = $state<ResearchSong[]>(initial.map((s: ResearchSong) => ({ ...s, score: computeScore(s, weights) })));
  let query = $state('');
  let searching = $state(false);
  let searchResults = $state<SearchResult[]>([]);
  let searchError = $state<string | null>(null);
  let busyAddUris = $state<Set<string>>(new Set());

  const dims = [
    { key: 'themeFit',           label: 'Theme',     color: 'text-blue-400'   },
    { key: 'discoveryPotential', label: 'Discovery', color: 'text-green-400'  },
    { key: 'nostalgiaPotential', label: 'Nostalgia', color: 'text-orange-400' },
    { key: 'personalRating',     label: 'Personal',  color: 'text-purple-400' },
  ] as const;

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
    songs = songs.filter(s => s.id !== id);
    const res = await fetch(`/api/research/${roundId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    if (!res.ok) songs = prev;
  }

  function setRating(song: ResearchSong, key: typeof dims[number]['key'], value: number) {
    const current = song[key];
    const next = current === value ? null : value;
    patchSong(song.id, { [key]: next });
  }

  function scoreClass(score: number | null | undefined): string {
    if (score == null) return 'text-slate-500';
    if (score >= 4) return 'text-green-400';
    if (score >= 3) return 'text-amber-400';
    return 'text-slate-400';
  }

  let sorted = $derived([...songs].sort((a, b) => (b.score ?? -1) - (a.score ?? -1)));
</script>

<div class="space-y-6">
  <section class="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
    <h3 class="text-sm font-semibold text-slate-200 mb-3">Search Spotify</h3>
    <form onsubmit={runSearch} class="flex gap-2 mb-3">
      <input
        type="text"
        bind:value={query}
        placeholder="Song, artist, album…"
        class="flex-1 bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 placeholder-slate-500"
      />
      <button
        type="submit"
        disabled={searching || !query.trim()}
        class="bg-green-700 hover:bg-green-600 disabled:bg-slate-700 disabled:text-slate-400 text-white px-4 py-1.5 rounded text-sm"
      >
        {searching ? 'Searching…' : 'Search'}
      </button>
    </form>

    {#if searchError}
      <p class="text-xs text-red-400 mb-2">{searchError}</p>
    {/if}

    {#if searchResults.length}
      <div class="flex flex-col gap-1.5">
        {#each searchResults as r}
          {@const already = songs.some(s => s.spotifyUri === r.uri)}
          <div class="flex items-center gap-3 px-3 py-2 rounded bg-slate-900/60 border border-slate-700">
            {#if r.imageUrl}
              <img src={r.imageUrl} alt="" class="w-10 h-10 rounded flex-shrink-0" />
            {:else}
              <div class="w-10 h-10 rounded bg-slate-700 flex-shrink-0"></div>
            {/if}
            <div class="flex-1 min-w-0">
              <div class="font-medium text-slate-100 text-sm truncate">{r.name}</div>
              <div class="text-xs text-slate-400 truncate">{r.artists} · {r.album}{r.year ? ` (${r.year})` : ''}</div>
            </div>
            <button
              type="button"
              onclick={() => addCandidate(r)}
              disabled={already || busyAddUris.has(r.uri)}
              class="text-xs px-3 py-1 rounded flex-shrink-0"
              class:bg-purple-700={!already}
              class:hover:bg-purple-600={!already}
              class:text-white={!already}
              class:bg-slate-700={already}
              class:text-slate-400={already}
            >
              {already ? 'Added' : busyAddUris.has(r.uri) ? '…' : '+ Add'}
            </button>
          </div>
        {/each}
      </div>
    {/if}
  </section>

  <section>
    <h3 class="text-sm font-semibold text-slate-200 mb-3">
      Candidates ({songs.length})
    </h3>
    {#if !sorted.length}
      <p class="text-slate-500 text-sm">No research candidates yet. Search above to add some.</p>
    {:else}
      <div class="flex flex-col gap-3">
        {#each sorted as song (song.id)}
          <article class="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
            <header class="flex items-start gap-3 mb-3">
              <div class="flex-1 min-w-0">
                <div class="font-medium text-slate-100 truncate">{song.title}</div>
                <div class="text-xs text-slate-400 truncate">
                  {song.artist}{song.album ? ` · ${song.album}` : ''}
                </div>
                {#if song.submittedByMe || song.submittedByOther}
                  <div class="flex gap-2 mt-1 text-[10px]">
                    {#if song.submittedByMe}
                      <span class="bg-purple-900/60 text-purple-300 px-1.5 py-0.5 rounded">submitted by me</span>
                    {/if}
                    {#if song.submittedByOther}
                      <span class="bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded">
                        submitted by other{song.otherSubmissionVotes != null ? ` · ${song.otherSubmissionVotes} pts` : ''}
                      </span>
                    {/if}
                  </div>
                {/if}
              </div>
              <div class="text-right flex-shrink-0">
                <div class="text-xs text-slate-500">Score</div>
                <div class="text-2xl font-bold {scoreClass(song.score)}">
                  {song.score != null ? song.score.toFixed(2) : '—'}
                </div>
              </div>
            </header>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
              {#each dims as d}
                <div class="flex items-center gap-2">
                  <span class="text-xs w-20 {d.color}">{d.label}</span>
                  <div class="flex gap-1">
                    {#each [1,2,3,4,5] as n}
                      {@const active = song[d.key] != null && (song[d.key] as number) >= n}
                      <button
                        type="button"
                        onclick={() => setRating(song, d.key, n)}
                        aria-label={`${d.label} ${n}`}
                        class="w-6 h-6 rounded text-xs font-semibold border transition-colors"
                        class:bg-purple-600={active}
                        class:border-purple-500={active}
                        class:text-white={active}
                        class:bg-slate-900={!active}
                        class:border-slate-700={!active}
                        class:text-slate-500={!active}
                        class:hover:border-slate-500={!active}
                      >
                        {n}
                      </button>
                    {/each}
                    {#if song[d.key] != null}
                      <button
                        type="button"
                        onclick={() => patchSong(song.id, { [d.key]: null })}
                        class="text-[10px] text-slate-500 hover:text-slate-300 ml-1"
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
              class="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-200 placeholder-slate-500 mb-3"
            ></textarea>

            <footer class="flex items-center gap-3 text-xs">
              <label class="flex items-center gap-1.5 text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={song.saveForFuture}
                  onchange={(e) => patchSong(song.id, { saveForFuture: (e.currentTarget as HTMLInputElement).checked })}
                  class="accent-purple-500"
                />
                Save for future
              </label>
              <a
                href={`https://open.spotify.com/track/${song.spotifyUri.replace('spotify:track:', '')}`}
                target="_blank"
                rel="noreferrer"
                class="text-green-400 hover:underline"
              >Spotify ↗</a>
              <a
                href={`/api/ytm/${encodeURIComponent(song.spotifyUri)}?redirect=1`}
                target="_blank"
                rel="noreferrer"
                class="text-red-400 hover:underline"
              >YT Music ↗</a>
              <button
                type="button"
                onclick={() => removeSong(song.id)}
                class="ml-auto text-slate-500 hover:text-red-400"
              >Remove</button>
            </footer>
          </article>
        {/each}
      </div>
    {/if}
  </section>
</div>
