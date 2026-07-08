<script lang="ts">
  // History → Tab 4 "League research" (sprint-26). One league at a time; a shared
  // league+season scope bar (deep-linked via ?league=&season=) above a single
  // visual switcher (D1: 1b) that shows one of three panels: Points heatmap (D2),
  // obscurity drift (D4), or genre tornado (D3). digest.css is imported here so
  // the heatmap can reuse its .dgA-matrix/.dgA-mx-* classes on /history.
  import '$lib/digest/digest.css';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import HeatmapPanel from './league/HeatmapPanel.svelte';
  import DriftPanel from './league/DriftPanel.svelte';
  import GenrePanel from './league/GenrePanel.svelte';
  import type { LeagueResearch } from '$lib/db/leagueResearch';

  type View = 'heatmap' | 'drift' | 'genre';
  const VIEWS: { key: View; label: string }[] = [
    { key: 'heatmap', label: 'Heatmap' },
    { key: 'drift', label: 'Drift' },
    { key: 'genre', label: 'Genre' },
  ];

  let leagues = $state<{ id: number; slug: string; name: string }[]>([]);
  let data = $state<LeagueResearch | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let view = $state<View>('heatmap');
  let genrePlayer = $state<string>('');
  let loadToken = 0;

  const slugParam = $derived(page.url.searchParams.get('league'));
  const seasonParam = $derived(page.url.searchParams.get('season'));

  async function ensureLeagues() {
    if (leagues.length) return;
    const res = await fetch('/api/history/leagues');
    if (!res.ok) throw new Error(`Failed to load leagues (${res.status})`);
    leagues = await res.json();
  }

  async function load(slug: string | null, season: string | null) {
    const token = ++loadToken;
    loading = true;
    error = null;
    try {
      await ensureLeagues();
      if (!leagues.length) {
        data = null;
        return;
      }
      const chosen = leagues.find((l) => l.slug === slug) ?? leagues[0];
      const qs = season && season !== 'all' ? `?season=${encodeURIComponent(season)}` : '';
      const res = await fetch(`/api/history/league/${chosen.id}${qs}`);
      if (!res.ok) throw new Error(`Failed to load league data (${res.status})`);
      const d: LeagueResearch = await res.json();
      if (token !== loadToken) return; // a newer scope won the race
      data = d;
      if (!d.roster.includes(genrePlayer)) genrePlayer = d.roster[0] ?? '';
    } catch (e) {
      if (token !== loadToken) return;
      error = e instanceof Error ? e.message : 'Failed to load league research';
      data = null;
    } finally {
      if (token === loadToken) loading = false;
    }
  }

  // Reload whenever the deep-linked scope changes (initial mount included).
  $effect(() => {
    load(slugParam, seasonParam);
  });

  function setScope(slug: string, season: number | null) {
    const params = new URLSearchParams(page.url.searchParams);
    params.set('tab', 'league');
    params.set('league', slug);
    if (season === null) params.delete('season');
    else params.set('season', String(season));
    goto(`?${params.toString()}`, { replaceState: true, keepFocus: true, noScroll: true });
  }
</script>

<div class="space-y-6">
  <section class="bg-bg-elevated border border-border-muted rounded-xl p-4">
    <h3 class="font-mono text-xs tracking-widest uppercase text-fg-faint mb-1">League research</h3>
    <p class="text-fg-muted text-sm leading-relaxed">
      One league at a time — who rewards whom (points heatmap), how obscure its picks run over the seasons
      (drift), and a player’s submit-vs-vote genre split. Never mixes players who don’t share a league.
    </p>
  </section>

  {#if loading && !data}
    <p class="text-fg-faint text-sm font-mono italic">Loading league research…</p>
  {:else if error}
    <p class="font-mono text-xs text-warn">{error}</p>
  {:else if !data}
    <p class="text-fg-faint text-sm font-mono italic">No leagues imported yet.</p>
  {:else}
    {@const d = data}
    <!-- Scope bar -->
    <div class="lr-scope">
      <span class="lr-scope-lbl">league</span>
      {#each leagues as l}
        <button
          type="button"
          class="lr-pill"
          class:is-active={l.slug === d.slug}
          onclick={() => setScope(l.slug, null)}
        >{l.name}</button>
      {/each}
      {#if d.seasons.length > 1}
        <span class="lr-scope-div"></span>
        <span class="lr-scope-lbl">season</span>
        <button type="button" class="lr-pill" class:is-active={d.season === null} onclick={() => setScope(d.slug, null)}>All</button>
        {#each d.seasons as s}
          <button
            type="button"
            class="lr-pill"
            class:is-active={d.season === s.season}
            onclick={() => setScope(d.slug, s.season)}
          >S{s.season}</button>
        {/each}
      {:else if d.seasons.length === 1}
        <span class="lr-scope-div"></span>
        <span class="lr-scope-lbl">season</span>
        <span class="lr-pill is-active">S{d.seasons[0].season} (only)</span>
      {/if}
    </div>

    <!-- Visual switcher -->
    <div class="lr-switcher" role="tablist" aria-label="League research visual">
      {#each VIEWS as v}
        <button
          type="button"
          role="tab"
          aria-selected={view === v.key}
          class="lr-seg"
          class:is-active={view === v.key}
          onclick={() => (view = v.key)}
        >{v.label}</button>
      {/each}
    </div>

    <!-- Active panel -->
    <div class="lr-panel">
      {#if view === 'heatmap'}
        <HeatmapPanel roster={d.roster} matrix={d.matrix} maxPoints={d.maxPoints} />
      {:else if view === 'drift'}
        <DriftPanel drift={d.drift} />
      {:else}
        <GenrePanel
          roster={d.roster}
          genreByPlayer={d.genreByPlayer}
          player={genrePlayer}
          onselectplayer={(p) => (genrePlayer = p)}
        />
      {/if}
    </div>
  {/if}
</div>

<style>
  .lr-scope {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .lr-scope-lbl {
    font-family: var(--font-mono);
    font-size: 9.5px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--fg-quiet);
  }
  .lr-scope-div {
    width: 1px;
    height: 14px;
    background: var(--line);
  }
  .lr-pill {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--fg-quiet);
    background: var(--ink-2);
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 3px 10px;
    cursor: pointer;
    transition:
      color 120ms,
      background 120ms,
      border-color 120ms;
  }
  .lr-pill:hover {
    color: var(--fg);
  }
  .lr-pill.is-active {
    color: var(--fg);
    background: var(--mash-pulp-soft);
    border-color: var(--mash-pulp-edge);
    cursor: default;
  }
  .lr-switcher {
    display: flex;
    gap: 4px;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--r-2);
    padding: 3px;
    width: fit-content;
  }
  .lr-seg {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg-quiet);
    background: transparent;
    border: 0;
    border-radius: var(--r-1);
    padding: 5px 14px;
    cursor: pointer;
    transition:
      color 120ms,
      background 120ms;
  }
  .lr-seg:hover {
    color: var(--fg);
  }
  .lr-seg.is-active {
    color: var(--accent);
    background: var(--mash-pulp-soft);
  }
  .lr-panel {
    background: var(--ink-1);
    border: 1px solid var(--line);
    border-radius: var(--r-4);
    padding: 16px;
  }
</style>
