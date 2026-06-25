<!--
  HierarchyNavigator — league -> season -> round drill-down tree.
  Props: hierarchy, scope, onScope.
  Renders:
    - "All" root node
    - League -> Season -> Round tree with expand/collapse carets
    - Each node shows a rollup chip (monotonic status colors)
    - Selected node gets accent selection affordance (border/ring)
    - Breadcrumb reflecting current scope
    - Search input filtering rounds by name
-->
<script lang="ts">
  import type { HierarchyLeague, Scope } from '$lib/db/metadataQueue.js';
  import { untrack } from 'svelte';
  import StatusChip from '$lib/components/StatusChip.svelte';
  import { rollupChip } from '$lib/metadata-queue/ladder.js';
  import { nodeToScope, roundMatchesQuery, filterHierarchy } from '$lib/metadata-queue/hierarchyNavigator.js';

  let {
    hierarchy,
    scope,
    onScope,
  }: {
    hierarchy: HierarchyLeague[];
    scope: Scope;
    onScope: (s: Scope) => void;
  } = $props();

  // ---------------------------------------------------------------------------
  // Search state
  // ---------------------------------------------------------------------------
  let searchQuery = $state('');

  const filteredHierarchy = $derived(filterHierarchy(hierarchy, searchQuery));

  // ---------------------------------------------------------------------------
  // Expand/collapse state — leagues and seasons independently
  // ---------------------------------------------------------------------------
  let expandedLeagues = $state(new Set<number>());
  let expandedSeasons = $state(new Set<number>());

  // Auto-expand ancestors of selected scope when it changes.
  // We untrack reads of expandedLeagues/expandedSeasons so that writing to them
  // does NOT re-trigger this effect — only `scope` and `hierarchy` are tracked deps.
  $effect(() => {
    const s = scope;
    // Reading hierarchy here is intentional — if hierarchy changes we re-evaluate.
    const h = hierarchy;
    if (s.level === 'round' || s.level === 'season') {
      for (const league of h) {
        for (const season of league.seasons) {
          if (s.level === 'season' && season.id === s.id) {
            const current = untrack(() => expandedLeagues);
            if (!current.has(league.id)) {
              expandedLeagues = new Set([...current, league.id]);
            }
          }
          if (s.level === 'round') {
            const round = season.rounds.find(r => r.id === s.id);
            if (round) {
              const curLeagues = untrack(() => expandedLeagues);
              const curSeasons = untrack(() => expandedSeasons);
              if (!curLeagues.has(league.id)) {
                expandedLeagues = new Set([...curLeagues, league.id]);
              }
              if (!curSeasons.has(season.id)) {
                expandedSeasons = new Set([...curSeasons, season.id]);
              }
            }
          }
        }
      }
    }
    if (s.level === 'league') {
      const current = untrack(() => expandedLeagues);
      if (!current.has(s.id!)) {
        expandedLeagues = new Set([...current, s.id!]);
      }
    }
  });

  // When a search is active, auto-expand all leagues/seasons that have matches.
  // We untrack reads of expandedLeagues/expandedSeasons so that writing to them
  // does NOT re-trigger this effect — only `searchQuery` and `filteredHierarchy` are deps.
  $effect(() => {
    const q = searchQuery.trim();
    if (q === '') return;
    // Build candidate sets from the current state without registering them as deps.
    const curLeagues = untrack(() => expandedLeagues);
    const curSeasons = untrack(() => expandedSeasons);
    const newLeagues = new Set(curLeagues);
    const newSeasons = new Set(curSeasons);
    for (const league of filteredHierarchy) {
      newLeagues.add(league.id);
      for (const season of league.seasons) {
        if (season.rounds.some(r => roundMatchesQuery(q, r.name))) {
          newSeasons.add(season.id);
        }
      }
    }
    // Only write if the contents actually changed to avoid a needless re-render.
    if (newLeagues.size !== curLeagues.size) {
      expandedLeagues = newLeagues;
    }
    if (newSeasons.size !== curSeasons.size) {
      expandedSeasons = newSeasons;
    }
  });

  function toggleLeague(id: number) {
    const next = new Set(expandedLeagues);
    if (next.has(id)) next.delete(id); else next.add(id);
    expandedLeagues = next;
  }

  function toggleSeason(id: number) {
    const next = new Set(expandedSeasons);
    if (next.has(id)) next.delete(id); else next.add(id);
    expandedSeasons = next;
  }

  // ---------------------------------------------------------------------------
  // Breadcrumb — derive path from current scope
  // ---------------------------------------------------------------------------
  const breadcrumb = $derived.by(() => {
    const s = scope;
    const crumbs: Array<{ label: string; scope: Scope }> = [
      { label: 'All', scope: { level: 'all' } }
    ];
    if (s.level === 'all') return crumbs;

    for (const league of hierarchy) {
      if (s.level === 'league' && league.id === s.id) {
        crumbs.push({ label: league.name, scope: nodeToScope('league', league.id) });
        return crumbs;
      }
      for (const season of league.seasons) {
        if (s.level === 'season' && season.id === s.id) {
          crumbs.push({ label: league.name, scope: nodeToScope('league', league.id) });
          crumbs.push({ label: season.name, scope: nodeToScope('season', season.id) });
          return crumbs;
        }
        for (const round of season.rounds) {
          if (s.level === 'round' && round.id === s.id) {
            crumbs.push({ label: league.name, scope: nodeToScope('league', league.id) });
            crumbs.push({ label: season.name, scope: nodeToScope('season', season.id) });
            crumbs.push({ label: round.name, scope: nodeToScope('round', round.id) });
            return crumbs;
          }
        }
      }
    }
    return crumbs;
  });

  // ---------------------------------------------------------------------------
  // isSelected — check if a node matches the current scope
  // ---------------------------------------------------------------------------
  function isSelected(level: Scope['level'], id?: number): boolean {
    if (level === 'all') return scope.level === 'all';
    return scope.level === level && scope.id === id;
  }

  // ---------------------------------------------------------------------------
  // Node chip helpers — convert hierarchy node counts to rollupChip input
  // ---------------------------------------------------------------------------
  function nodeChip(node: { pending: number; processing: number; done: number; failed: number; total: number }) {
    return rollupChip({
      pending: node.pending,
      processing: node.processing,
      done24h: 0,
      failed: node.failed,
      total: node.total,
    });
  }

  // Sum all counts across the full hierarchy for the "All" root node
  const allCounts = $derived(hierarchy.reduce(
    (acc, l) => ({
      pending: acc.pending + l.pending,
      processing: acc.processing + l.processing,
      done24h: 0,
      failed: acc.failed + l.failed,
      total: acc.total + l.total,
    }),
    { pending: 0, processing: 0, done24h: 0, failed: 0, total: 0 }
  ));

  const allChip = $derived(rollupChip(allCounts));
</script>

<div class="mb-5">
  <!-- Breadcrumb -->
  {#if scope.level !== 'all'}
    <nav class="flex items-center gap-1 text-[10px] font-mono tracking-widest uppercase text-fg-faint mb-3 flex-wrap">
      {#each breadcrumb as crumb, i (crumb.label)}
        {#if i > 0}
          <span class="text-fg-faint">›</span>
        {/if}
        <button
          type="button"
          onclick={() => onScope(crumb.scope)}
          class="hover:text-fg transition-colors {i === breadcrumb.length - 1 ? 'text-fg' : 'hover:underline decoration-dotted underline-offset-2'}"
        >
          {crumb.label}
        </button>
      {/each}
    </nav>
  {/if}

  <!-- Search input -->
  <div class="relative mb-3">
    <input
      type="search"
      placeholder="Search rounds…"
      bind:value={searchQuery}
      class="w-full bg-bg-elevated border border-border-muted rounded-md px-3 py-1.5 text-sm text-fg placeholder-fg-faint focus:border-accent focus:outline-none transition-colors font-mono text-[11px]"
    />
    {#if searchQuery}
      <button
        type="button"
        onclick={() => { searchQuery = ''; }}
        class="absolute right-2.5 top-1/2 -translate-y-1/2 text-fg-faint hover:text-fg transition-colors text-xs"
        aria-label="Clear search"
      >
        ✕
      </button>
    {/if}
  </div>

  <!-- Tree -->
  <div class="space-y-0.5">
    <!-- All root node -->
    <button
      type="button"
      onclick={() => onScope(nodeToScope('all'))}
      class="w-full flex items-center gap-2 px-2 py-1.5 rounded-sm text-left transition-colors group
        {isSelected('all')
          ? 'bg-accent-bg border border-accent ring-1 ring-accent/20'
          : 'hover:bg-surface-hover border border-transparent'}"
    >
      <span class="text-[10px] text-fg-faint w-3 shrink-0"></span>
      <span class="flex-1 font-mono text-[11px] tracking-widest uppercase {isSelected('all') ? 'text-accent' : 'text-fg-muted group-hover:text-fg'}">
        All rounds
      </span>
      <StatusChip label={allChip.label} tone={allChip.tone} />
    </button>

    <!-- League nodes -->
    {#each filteredHierarchy as league (league.id)}
      {@const leagueChip = nodeChip(league)}
      {@const leagueExpanded = expandedLeagues.has(league.id)}

      <div>
        <!-- League row -->
        <div class="flex items-center gap-1">
          <button
            type="button"
            onclick={() => toggleLeague(league.id)}
            class="w-4 h-6 flex items-center justify-center shrink-0 text-fg-faint hover:text-fg transition-colors text-[10px]"
            aria-label="{leagueExpanded ? 'Collapse' : 'Expand'} {league.name}"
          >
            {leagueExpanded ? '▾' : '▸'}
          </button>
          <button
            type="button"
            onclick={() => onScope(nodeToScope('league', league.id))}
            class="flex-1 flex items-center gap-2 px-2 py-1.5 rounded-sm text-left transition-colors group
              {isSelected('league', league.id)
                ? 'bg-accent-bg border border-accent ring-1 ring-accent/20'
                : 'hover:bg-surface-hover border border-transparent'}"
          >
            <span class="flex-1 text-sm font-semibold {isSelected('league', league.id) ? 'text-accent' : 'text-fg group-hover:text-fg'}">
              {league.name}
            </span>
            <span class="font-mono text-[10px] text-fg-faint">{league.songCount} songs</span>
            <StatusChip label={leagueChip.label} tone={leagueChip.tone} />
          </button>
        </div>

        <!-- Season nodes (only if league expanded) -->
        {#if leagueExpanded}
          <div class="ml-5 space-y-0.5 mt-0.5">
            {#each league.seasons as season (season.id)}
              {@const seasonChip = nodeChip(season)}
              {@const seasonExpanded = expandedSeasons.has(season.id)}

              <div>
                <!-- Season row -->
                <div class="flex items-center gap-1">
                  <button
                    type="button"
                    onclick={() => toggleSeason(season.id)}
                    class="w-4 h-6 flex items-center justify-center shrink-0 text-fg-faint hover:text-fg transition-colors text-[10px]"
                    aria-label="{seasonExpanded ? 'Collapse' : 'Expand'} {season.name}"
                  >
                    {seasonExpanded ? '▾' : '▸'}
                  </button>
                  <button
                    type="button"
                    onclick={() => onScope(nodeToScope('season', season.id))}
                    class="flex-1 flex items-center gap-2 px-2 py-1.5 rounded-sm text-left transition-colors group
                      {isSelected('season', season.id)
                        ? 'bg-accent-bg border border-accent ring-1 ring-accent/20'
                        : 'hover:bg-surface-hover border border-transparent'}"
                  >
                    <span class="flex-1 text-sm {isSelected('season', season.id) ? 'text-accent' : 'text-fg-muted group-hover:text-fg'}">
                      {season.name}
                    </span>
                    <span class="font-mono text-[10px] text-fg-faint">{season.songCount} songs</span>
                    <StatusChip label={seasonChip.label} tone={seasonChip.tone} />
                  </button>
                </div>

                <!-- Round nodes (only if season expanded) -->
                {#if seasonExpanded}
                  <div class="ml-5 space-y-0.5 mt-0.5">
                    {#each season.rounds as round (round.id)}
                      {@const roundChip = nodeChip(round)}
                      <button
                        type="button"
                        onclick={() => onScope(nodeToScope('round', round.id))}
                        class="w-full flex items-center gap-2 px-2 py-1.5 rounded-sm text-left transition-colors group
                          {isSelected('round', round.id)
                            ? 'bg-accent-bg border border-accent ring-1 ring-accent/20'
                            : 'hover:bg-surface-hover border border-transparent'}"
                      >
                        <span class="text-[10px] text-fg-faint w-3 shrink-0"></span>
                        <span class="flex-1 text-xs {isSelected('round', round.id) ? 'text-accent' : 'text-fg-dim group-hover:text-fg'} truncate">
                          {round.name}
                        </span>
                        <span class="font-mono text-[10px] text-fg-faint shrink-0">{round.songCount}</span>
                        <StatusChip label={roundChip.label} tone={roundChip.tone} />
                      </button>
                    {/each}
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/each}

    {#if searchQuery.trim() && filteredHierarchy.length === 0}
      <p class="text-fg-faint text-xs font-mono px-2 py-2">No rounds match "{searchQuery}"</p>
    {/if}
  </div>
</div>
