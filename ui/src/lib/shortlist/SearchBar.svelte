<script lang="ts">
  const { onadd } = $props<{
    onadd: (track: SpotifyTrack) => void;
  }>();

  type SpotifyTrack = {
    uri: string; name: string; artists: string;
    album: string; year: string; imageUrl: string | null;
  };

  let query = $state('');
  let results = $state<SpotifyTrack[]>([]);
  let keyedIndex = $state(0);
  let focused = $state(false);
  let searchEl: HTMLInputElement;
  let debounce: ReturnType<typeof setTimeout>;

  const open = $derived(focused && results.length > 0 && query.length > 1);

  async function search(q: string) {
    if (q.length <= 1) { results = []; return; }
    const res = await fetch(`/api/spotify/search?q=${encodeURIComponent(q)}`);
    if (!res.ok) return;
    results = await res.json();
    keyedIndex = 0;
  }

  function handleInput() {
    clearTimeout(debounce);
    debounce = setTimeout(() => search(query), 300);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (!open) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); keyedIndex = Math.min(keyedIndex + 1, results.length - 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); keyedIndex = Math.max(keyedIndex - 1, 0); }
    else if (e.key === 'Enter') { e.preventDefault(); commitKeyed(); }
    else if (e.key === 'Escape') { results = []; }
  }

  function commitKeyed() {
    if (!results[keyedIndex]) return;
    onadd(results[keyedIndex]);
    query = '';
    results = [];
  }

  export function focusInput() {
    searchEl?.focus();
  }
</script>

<div class="sl-search" class:is-focused={focused}>
  <div class="sl-search-row">
    <span class="sl-search-glyph">⌕</span>
    <input
      bind:this={searchEl}
      bind:value={query}
      type="text"
      class="sl-search-input"
      placeholder="Search Spotify to add a song…"
      autocomplete="off"
      onfocus={() => focused = true}
      onblur={() => setTimeout(() => { focused = false; }, 150)}
      oninput={handleInput}
      onkeydown={handleKeydown}
    />
    <span class="sl-search-meta">
      <span class="sl-source-pip"></span>
      spotify · client-credentials
    </span>
  </div>
  {#if open}
    <div class="sl-search-drop">
      {#each results as track, i}
        <button
          type="button"
          class="sl-search-result"
          class:is-keyed={i === keyedIndex}
          onmousedown={() => { onadd(track); query = ''; results = []; }}
          onmouseenter={() => keyedIndex = i}
        >
          {#if track.imageUrl}
            <img src={track.imageUrl} alt="" width="40" height="40" style="border-radius: var(--r-2)" />
          {:else}
            <span class="sl-search-result-art-placeholder"></span>
          {/if}
          <span class="sl-search-result-info">
            <span class="sl-search-result-title">{track.name}</span>
            <span class="sl-search-result-sub">{track.artists} · {track.album}</span>
          </span>
          <span class="sl-search-result-year">{track.year}</span>
          <span class="sl-search-result-add">+</span>
        </button>
      {/each}
    </div>
  {/if}
</div>
