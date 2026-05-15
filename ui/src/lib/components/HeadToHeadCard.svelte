<!--
  HeadToHeadCard — pairwise comparison card for the h2h picker (prototype C).
  Two variants intentionally asymmetric:
    - holding-lane: darker surface, "anointed" feel, anchors the comparison
    - challenger:   lighter surface, contender feel
  Example:
    <HeadToHeadCard
      song={holdingLane}
      role="holding-lane"
      onPick={() => pick(holdingLane.id)}
    />
-->
<script lang="ts">
  import SectionLabel from '$lib/components/SectionLabel.svelte';

  export type H2HCardSong = {
    id: number;
    artist: string;
    title: string;
    themeFit: number | null;
    discoveryPotential: number | null;
    nostalgiaPotential: number | null;
    personalRating: number | null;
    notes: string | null;
    weightedScore: number | null;
  };

  let { song, role, onPick }: {
    song: H2HCardSong;
    role: 'holding-lane' | 'challenger';
    onPick: () => void;
  } = $props();

  const isHolding = $derived(role === 'holding-lane');

  const dims = [
    { key: 'themeFit',           label: 'Theme'     },
    { key: 'discoveryPotential', label: 'Discovery' },
    { key: 'nostalgiaPotential', label: 'Nostalgia' },
    { key: 'personalRating',     label: 'Personal'  },
  ] as const;

  function scoreToneClass(score: number | null | undefined): string {
    if (score == null) return 'text-fg-faint';
    if (score >= 4) return 'text-health';
    if (score >= 3) return 'text-warn';
    return 'text-fg-dim';
  }
</script>

<article
  class="flex flex-col rounded-xl border p-6 transition-colors"
  class:bg-bg={isHolding}
  class:border-accent-deep={isHolding}
  class:bg-surface={!isHolding}
  class:border-border-muted={!isHolding}
>
  <header class="mb-4">
    {#if isHolding}
      <div class="text-accent">
        <SectionLabel>Holding lane</SectionLabel>
      </div>
    {:else}
      <SectionLabel>Challenger</SectionLabel>
    {/if}
  </header>

  <div class="flex-1 flex flex-col">
    <div class="mb-4">
      <h3
        class="font-bold text-fg leading-tight"
        class:text-3xl={isHolding}
        class:text-2xl={!isHolding}
      >
        {song.artist}
      </h3>
      <p
        class="text-fg-muted mt-1"
        class:text-xl={isHolding}
        class:text-lg={!isHolding}
      >
        {song.title}
      </p>
    </div>

    <!-- Rating dots: one row per dimension. -->
    <div class="grid grid-cols-2 gap-x-4 gap-y-2 mb-4">
      {#each dims as d}
        {@const v = song[d.key]}
        <div class="flex items-center gap-2">
          <span class="font-mono text-[10px] tracking-widest uppercase text-fg-dim w-20 flex-shrink-0">
            {d.label}
          </span>
          <div class="flex gap-1 items-center" aria-label={`${d.label} ${v ?? 'unrated'}`}>
            {#each [1, 2, 3, 4, 5] as n}
              {@const active = v != null && v >= n}
              <span
                class="w-2 h-2 rounded-full border"
                class:bg-accent={active}
                class:border-accent={active}
                class:bg-transparent={!active}
                class:border-border={!active}
              ></span>
            {/each}
          </div>
        </div>
      {/each}
    </div>

    {#if song.notes}
      <p class="text-fg-muted text-sm leading-relaxed mb-4 line-clamp-4 flex-1">
        {song.notes}
      </p>
    {:else}
      <p class="text-fg-faint font-mono text-xs italic mb-4 flex-1">No notes recorded.</p>
    {/if}

    <div class="flex items-baseline justify-between mb-5 pt-4 border-t border-border-muted">
      <span class="font-mono text-[10px] tracking-widest uppercase text-fg-faint">Weighted score</span>
      <span class="font-display font-bold text-2xl {scoreToneClass(song.weightedScore)}">
        {song.weightedScore != null ? song.weightedScore.toFixed(2) : '—'}
      </span>
    </div>
  </div>

  <button
    type="button"
    onclick={onPick}
    class="bg-accent hover:bg-accent-strong text-bg-elevated px-4 py-3 rounded-md font-bold font-mono tracking-widest uppercase text-sm transition-colors"
  >
    Pick winner
  </button>
</article>
