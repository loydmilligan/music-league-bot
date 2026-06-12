<script lang="ts">
  import '$lib/shortlist/shortlist.css';
  import SearchBar from '$lib/shortlist/SearchBar.svelte';
  import ShortlistRow from '$lib/shortlist/ShortlistRow.svelte';
  import ShortlistStrip from '$lib/shortlist/ShortlistStrip.svelte';
  import ShortlistH2HPanel from '$lib/shortlist/ShortlistH2HPanel.svelte';
  import type { PageData } from './$types.js';
  import type { ShortlistSong } from '$lib/types.js';

  const { data } = $props<{ data: PageData }>();

  type SortKey = 'date' | 'score' | 'personal';
  const SORT_OPTIONS: [SortKey, string][] = [['date', 'date added'], ['score', 'score'], ['personal', 'personal']];

  let songs = $state<ShortlistSong[]>(data.songs);
  let openId = $state<string | null>(null);
  let sortKey = $state<SortKey>('date');
  let h2hTarget = $state<{ leagueId: number; leagueName: string; roundId: number } | null>(null);
  let showHelp = $state(false);
  let searchRef: { focusInput: () => void } | undefined;
  let rKeyHeld = $state(false);
  let rTimeout: ReturnType<typeof setTimeout>;
  let personalRatingBus = $state<{ id: string; value: number } | null>(null);

  function totalScore(s: ShortlistSong) {
    return s.ratingDiscovery + s.ratingThemeFit + s.ratingNostalgia + s.ratingPersonal;
  }

  const sorted = $derived([...songs].sort((a, b) => {
    if (sortKey === 'score') return totalScore(b) - totalScore(a);
    if (sortKey === 'personal') return b.ratingPersonal - a.ratingPersonal;
    return Date.parse(b.addedAt) - Date.parse(a.addedAt);
  }));

  async function handleAdd(track: { uri: string; name: string; artists: string; album: string; year: string; imageUrl: string | null }) {
    const res = await fetch('/api/shortlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        spotify_uri: track.uri, title: track.name, artist: track.artists,
        album: track.album, album_art_url: track.imageUrl,
        year: track.year ? parseInt(track.year) : null,
      }),
    });
    if (res.ok) {
      const song = await res.json() as ShortlistSong;
      if (!songs.find(s => s.id === song.id)) songs = [song, ...songs];
    }
  }

  function handleRemoved(id: string) {
    songs = songs.filter(s => s.id !== id);
    if (openId === id) openId = null;
  }

  function handleToggle(id: string) {
    openId = openId === id ? null : id;
  }

  function handleH2hStart(leagueId: number, leagueName: string, roundId: number) {
    h2hTarget = { leagueId, leagueName, roundId };
  }

  function handleH2hAssigned(songId: string, roundId: number) {
    handleQuickAssigned(songId, roundId);
    h2hTarget = null;
  }

  function handleQuickAssigned(songId: string, roundId: number) {
    songs = songs.map((s) =>
      s.id === songId
        ? {
            ...s,
            assignments: [
              ...(s.assignments ?? []),
              { shortlistSongId: songId, roundId, assignedAt: new Date().toISOString() },
            ],
          }
        : s,
    );
  }

  function handleGlobalKeydown(e: KeyboardEvent) {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.key === '/') { e.preventDefault(); searchRef?.focusInput(); return; }
    if (e.key === 'Escape') { openId = null; showHelp = false; return; }
    if (e.key === '?') { e.preventDefault(); showHelp = !showHelp; return; }
    if (e.key === 'r') { rKeyHeld = true; clearTimeout(rTimeout); rTimeout = setTimeout(() => rKeyHeld = false, 1000); return; }
    if (rKeyHeld && openId && '12345'.includes(e.key)) {
      rKeyHeld = false;
      personalRatingBus = { id: openId, value: parseInt(e.key) };
      setTimeout(() => { personalRatingBus = null; }, 0);
    }
  }
</script>

<svelte:window onkeydown={handleGlobalKeydown} />

<div class="sl-main">
  <header class="mb-6">
    <p class="font-mono text-xs text-fg-dim mb-1">music-league-bot · /shortlist</p>
    <h1 class="font-display text-3xl font-bold text-fg">Shortlist</h1>
    <p class="text-fg-muted text-sm mt-1">Research songs for upcoming rounds. Rate, assign, track.</p>
  </header>

  <ShortlistStrip openSongId={openId} onAssigned={handleQuickAssigned} onH2hStart={handleH2hStart} />

  {#if h2hTarget}
    <ShortlistH2HPanel
      leagueName={h2hTarget.leagueName}
      roundId={h2hTarget.roundId}
      songs={songs}
      onAssigned={handleH2hAssigned}
      onClose={() => h2hTarget = null}
    />
  {/if}

  <SearchBar bind:this={searchRef} onadd={handleAdd} />

  <div class="sl-bar mt-4">
    <div class="sl-sort-pills">
      {#each SORT_OPTIONS as [key, label]}
        <button type="button" class="sl-sort-pill" class:is-active={sortKey === key} onclick={() => sortKey = key}>{label}</button>
      {/each}
    </div>
    <span class="sl-count-chip">{songs.length} songs</span>
    <button type="button" class="sl-kb-hint" onclick={() => showHelp = !showHelp}>?</button>
  </div>

  <div class="sl-rows mt-2">
    {#each sorted as song (song.id)}
      <ShortlistRow
        {song}
        open={openId === song.id}
        ontoggle={() => handleToggle(song.id)}
        onremoved={handleRemoved}
        personalRatingSignal={personalRatingBus?.id === song.id ? personalRatingBus.value : null}
      />
    {/each}
    {#if songs.length === 0}
      <p class="font-mono text-sm text-fg-faint italic mt-8 text-center">No songs yet — search above to add your first.</p>
    {/if}
  </div>

  {#if showHelp}
    <div class="sl-kb-overlay" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
      <div class="sl-kb-overlay-panel">
        <div class="sl-kb-overlay-head">
          <span>Keyboard shortcuts</span>
          <button type="button" onclick={() => showHelp = false}>✕</button>
        </div>
        <table class="sl-kb-table">
          <tbody>
            <tr><td><kbd>/</kbd></td><td>Focus search</td></tr>
            <tr><td><kbd>Esc</kbd></td><td>Close search / collapse row</td></tr>
            <tr><td><kbd>↑</kbd> <kbd>↓</kbd></td><td>Move search selection</td></tr>
            <tr><td><kbd>↵</kbd></td><td>Add keyed result / expand row</td></tr>
            <tr><td><kbd>r</kbd> <kbd>1–5</kbd></td><td>Set Personal rating (row open)</td></tr>
            <tr><td><kbd>?</kbd></td><td>Toggle this overlay</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  {/if}
</div>

<style>
  .sl-kb-overlay {
    position: fixed; inset: 0; z-index: 50;
    background: rgba(7,9,12,0.7);
    display: flex; align-items: center; justify-content: center;
  }
  .sl-kb-overlay-panel {
    background: var(--surface-2, #141921);
    border: 1px solid var(--line, #283039);
    border-radius: 8px; padding: 24px 28px; min-width: 340px;
  }
  .sl-kb-overlay-head {
    display: flex; justify-content: space-between; align-items: center;
    font: 600 14px/1 var(--font-sans, sans-serif);
    color: var(--fg, #f1f4f7); margin-bottom: 16px;
  }
  .sl-kb-table { border-collapse: collapse; width: 100%; }
  .sl-kb-table td { padding: 5px 8px; font: 13px/1.4 var(--font-mono, monospace); color: var(--fg-muted, #c2cad3); }
  .sl-kb-table td:first-child { color: var(--fg-dim, #8b97a4); white-space: nowrap; }
  kbd {
    display: inline-block; padding: 1px 5px;
    background: var(--surface-hover, #1d2128);
    border: 1px solid var(--line-strong, #3a4451);
    border-radius: 3px; font: 11px/1.4 var(--font-mono, monospace);
  }
</style>
