<!--
  HeadToHeadCard — pairwise comparison card for the h2h picker (prototype C).
  Two variants intentionally asymmetric:
    - holding-lane: darker surface, "anointed" feel, anchors the comparison
    - challenger:   lighter surface, contender feel

  Sprint-5 h2h-rate-and-spotify additions:
    - Inline rating editor (4 × 5 dots) PATCHes /api/research/[roundId] and
      recomputes the weighted score locally via computeUnicardScore.
    - Lazy Spotify embed toggled by a Play button; iframe is only rendered
      after the user clicks Play.
-->
<script lang="ts">
  import SectionLabel from '$lib/components/SectionLabel.svelte';
  import { computeUnicardScore } from '$lib/scoring.js';
  import type { Settings } from '$lib/types.js';

  export type H2HCardSong = {
    id: number;
    artist: string;
    title: string;
    spotifyUri?: string | null;
    themeFit: number | null;
    discoveryPotential: number | null;
    quality: number | null;
    replayability: number | null;
    notes: string | null;
    weightedScore: number | null;
  };

  let { song, role, onPick, roundId, weights }: {
    song: H2HCardSong;
    role: 'holding-lane' | 'challenger';
    onPick: () => void;
    roundId?: number;
    weights?: Settings;
  } = $props();

  const isHolding = $derived(role === 'holding-lane');

  // Local mutable view of the song so dot clicks can update optimistically.
  // Re-syncs whenever the parent supplies a new song id.
  let local = $state(song);
  $effect(() => {
    local = song;
  });

  let playerOpen = $state(false);
  let saving = $state<string | null>(null);

  const dims = [
    { key: 'themeFit',           label: 'Theme'       },
    { key: 'discoveryPotential', label: 'Discovery'   },
    { key: 'quality',            label: 'Quality'     },
    { key: 'replayability',      label: 'Replayability' },
  ] as const;

  type DimKey = typeof dims[number]['key'];

  function scoreToneClass(score: number | null | undefined): string {
    if (score == null) return 'text-fg-faint';
    if (score >= 4) return 'text-health';
    if (score >= 3) return 'text-warn';
    return 'text-fg-dim';
  }

  function trackIdFor(uri: string | null | undefined): string | null {
    if (!uri) return null;
    const m = uri.match(/^spotify:track:([A-Za-z0-9]+)$/);
    return m ? m[1] : null;
  }
  const trackId = $derived(trackIdFor(local.spotifyUri));

  async function setRating(key: DimKey, n: number) {
    if (!roundId) return; // no-op when the parent didn't wire roundId
    const current = local[key];
    const next = current === n ? null : n; // click same value clears
    const prev = local;
    const optimistic: H2HCardSong = { ...local, [key]: next };
    if (weights) {
      optimistic.weightedScore = computeUnicardScore({
        discovery: optimistic.discoveryPotential,
        themeFit: optimistic.themeFit,
        quality: optimistic.quality,
        replayability: optimistic.replayability,
      }, weights);
    }
    local = optimistic;
    saving = key;
    try {
      const res = await fetch(`/api/research/${roundId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: local.id, [key]: next }),
      });
      if (!res.ok) throw new Error(`Rating save failed (${res.status})`);
      // Server-canonical response can refresh weightedScore too.
      const body = await res.json();
      if (body && typeof body === 'object') {
        local = {
          ...local,
          themeFit: body.themeFit ?? local.themeFit,
          discoveryPotential: body.discoveryPotential ?? local.discoveryPotential,
          quality: body.quality ?? local.quality,
          replayability: body.replayability ?? local.replayability,
          weightedScore:
            typeof body.score === 'number'
              ? body.score
              : weights
              ? computeUnicardScore({
                  discovery: local.discoveryPotential,
                  themeFit: local.themeFit,
                  quality: local.quality,
                  replayability: local.replayability,
                }, weights)
              : local.weightedScore,
        };
      }
    } catch {
      local = prev; // rollback
    } finally {
      saving = null;
    }
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
        {local.artist}
      </h3>
      <p
        class="text-fg-muted mt-1"
        class:text-xl={isHolding}
        class:text-lg={!isHolding}
      >
        {local.title}
      </p>
    </div>

    <!-- Rating editor: 4 dimensions × 5 dots. Clicking a dot upserts the rating. -->
    <div class="grid grid-cols-2 gap-x-4 gap-y-2 mb-4">
      {#each dims as d}
        {@const v = local[d.key]}
        <div class="flex items-center gap-2">
          <span class="font-mono text-[10px] tracking-widest uppercase text-fg-dim w-20 flex-shrink-0">
            {d.label}
          </span>
          <div class="flex gap-1 items-center" aria-label={`${d.label} ${v ?? 'unrated'}`}>
            {#each [1, 2, 3, 4, 5] as n}
              {@const active = v != null && v >= n}
              <button
                type="button"
                onclick={() => setRating(d.key, n)}
                disabled={!roundId || saving === d.key}
                aria-label={`Set ${d.label} to ${n}`}
                class="w-2.5 h-2.5 rounded-full border transition-colors disabled:cursor-not-allowed"
                class:bg-accent={active}
                class:border-accent={active}
                class:bg-transparent={!active}
                class:border-border={!active}
                class:hover:border-accent-deep={!active && roundId}
              ></button>
            {/each}
          </div>
        </div>
      {/each}
    </div>

    {#if local.notes}
      <p class="text-fg-muted text-sm leading-relaxed mb-4 line-clamp-4 flex-1">
        {local.notes}
      </p>
    {:else}
      <p class="text-fg-faint font-mono text-xs italic mb-4 flex-1">No notes recorded.</p>
    {/if}

    <!-- Spotify embed: lazy-loaded behind a Play toggle. -->
    <div class="mb-4">
      <button
        type="button"
        onclick={() => (playerOpen = !playerOpen)}
        disabled={!trackId}
        title={trackId ? (playerOpen ? 'Hide player' : 'Play preview') : 'No Spotify URI on this song'}
        class="text-accent hover:text-accent-strong disabled:text-fg-faint disabled:cursor-not-allowed font-mono text-xs tracking-widest uppercase transition-colors flex items-center gap-1.5"
      >
        <span aria-hidden="true">{playerOpen ? '▾' : '▸'}</span>
        <span>{playerOpen ? 'Hide preview' : 'Play preview ↗'}</span>
      </button>
      {#if playerOpen && trackId}
        <iframe
          title={`${local.artist} — ${local.title} (Spotify preview)`}
          src={`https://open.spotify.com/embed/track/${trackId}?utm_source=oembed`}
          width="100%"
          height="80"
          frameborder="0"
          allow="encrypted-media"
          loading="lazy"
          class="mt-2 rounded-md"
        ></iframe>
      {/if}
    </div>

    <div class="flex items-baseline justify-between mb-5 pt-4 border-t border-border-muted">
      <span class="font-mono text-[10px] tracking-widest uppercase text-fg-faint">Weighted score</span>
      <span class="font-display font-bold text-2xl {scoreToneClass(local.weightedScore)}">
        {local.weightedScore != null ? local.weightedScore.toFixed(2) : '—'}
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
