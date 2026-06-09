<script lang="ts">
  // History — research & brainstorming surface (milestone Phase 1: shell only).
  // Three tabs (Song search / Theme research / Player research) present here as
  // STUBS; their internals land in milestone phases 2–4. Tab selection is
  // deep-linkable via ?tab=songs|themes|players so each subscreen has its own URL.
  // Full vision: docs/brainstorming/history-research-tool.md
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import SongSearchTab from '$lib/components/SongSearchTab.svelte';
  import ThemeResearchTab from '$lib/components/ThemeResearchTab.svelte';
  import PlayerResearchTab from '$lib/components/PlayerResearchTab.svelte';

  type TabKey = 'songs' | 'themes' | 'players';
  type Tab = { key: TabKey; label: string; glyph: string; blurb: string };

  const TABS: Tab[] = [
    {
      key: 'songs',
      label: 'Song search',
      glyph: '♪',
      blurb:
        'Spotify search → song cards, every result flagged by its history across our leagues (submitted, your-artist, chat-mentioned). Promote into the shortlist or a round list.',
    },
    {
      key: 'themes',
      label: 'Theme research',
      glyph: '◈',
      blurb:
        'Seed a theme (active round or free text) → find historically related themes by property-tag overlap → see which songs did well or poorly, and the telling comments.',
    },
    {
      key: 'players',
      label: 'Player research',
      glyph: '◑',
      blurb:
        'Per-player summaries for everyone we have played with — songs submitted, votes given, comment counts, placements. Numbers-only to start; read their tendencies.',
    },
  ];

  function isTab(v: string | null): v is TabKey {
    return v === 'songs' || v === 'themes' || v === 'players';
  }

  // Tab is driven by the URL so it survives refresh / back-forward and is shareable.
  const activeTab = $derived<TabKey>(
    isTab(page.url.searchParams.get('tab')) ? (page.url.searchParams.get('tab') as TabKey) : 'songs',
  );

  function selectTab(key: TabKey) {
    if (key === activeTab) return;
    const params = new URLSearchParams(page.url.searchParams);
    if (key === 'songs') params.delete('tab');
    else params.set('tab', key);
    const qs = params.toString();
    goto(qs ? `?${qs}` : page.url.pathname, { replaceState: true, keepFocus: true, noScroll: true });
  }

  const activeMeta = $derived(TABS.find((t) => t.key === activeTab) ?? TABS[0]);

  function onTabKeydown(e: KeyboardEvent, idx: number) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const next = (idx + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length;
      selectTab(TABS[next].key);
    }
  }
</script>

<div class="max-w-5xl">
  <header class="mb-6">
    <p class="font-mono text-xs text-fg-dim mb-1">music-league-bot · /history</p>
    <h1 class="font-display text-3xl font-bold text-fg">History</h1>
    <p class="text-fg-muted text-sm mt-1">
      Research the corpus of songs and themes from our leagues to pick what to submit next.
    </p>
  </header>

  <!-- Tab strip -->
  <div role="tablist" aria-label="History subscreens" class="flex items-center gap-1 border-b border-border-muted overflow-x-auto">
    {#each TABS as tab, idx}
      {@const current = tab.key === activeTab}
      <button
        type="button"
        role="tab"
        id="history-tab-{tab.key}"
        aria-selected={current}
        aria-controls="history-panel-{tab.key}"
        tabindex={current ? 0 : -1}
        class="group relative flex items-center gap-2 px-3 py-2 -mb-px text-sm rounded-t-sm border-b-2 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
        class:border-accent={current}
        class:text-accent={current}
        class:border-transparent={!current}
        class:text-fg-muted={!current}
        class:hover:text-fg={!current}
        onclick={() => selectTab(tab.key)}
        onkeydown={(e) => onTabKeydown(e, idx)}
      >
        <span class="text-xs" class:text-accent={current} class:text-fg-faint={!current} aria-hidden="true">{tab.glyph}</span>
        <span class="whitespace-nowrap font-medium">{tab.label}</span>
      </button>
    {/each}
  </div>

  <!-- Active panel (stub) -->
  <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
  <section
    role="tabpanel"
    id="history-panel-{activeMeta.key}"
    aria-labelledby="history-tab-{activeMeta.key}"
    tabindex="0"
    class="mt-8 focus:outline-none"
  >
    {#if activeTab === 'songs'}
      <SongSearchTab />
    {:else if activeTab === 'themes'}
      <ThemeResearchTab />
    {:else}
      <PlayerResearchTab />
    {/if}
  </section>
</div>
