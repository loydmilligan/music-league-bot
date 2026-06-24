<script lang="ts">
  import type { Song, SongRatings, SongCardConfig } from './canonical.js';
  import SongCard from './SongCard.svelte';

  const {
    songs,
    density = 'row',
    config = {},
    accordion = true,
    emptyLabel = 'No songs.',
    onAction,
    onRate,
    onAnalyze,
  } = $props<{
    songs: Song[];
    density?: 'row' | 'expanded';
    config?: SongCardConfig;
    accordion?: boolean;
    emptyLabel?: string;
    onAction?: (actionId: string, song: Song) => void;
    onRate?: (ratings: SongRatings, song: Song) => void;
    onAnalyze?: (song: Song) => void;
  }>();

  // Managed accordion: only one song open at a time
  let openId = $state<string | null>(null);
</script>

{#if !songs || !songs.length}
  <div class="usc-empty">{emptyLabel}</div>
{:else if density === 'expanded' || !accordion}
  <div class="usc-list">
    {#each songs as song (song.id)}
      <SongCard {song} {density} {config} {onAction} {onRate} {onAnalyze} />
    {/each}
  </div>
{:else}
  <!-- Accordion: parent controls which row is open so only one expands at a time -->
  <div class="usc-list">
    {#each songs as song (song.id)}
      <SongCard
        {song}
        density="row"
        {config}
        expanded={openId === song.id}
        onToggle={() => { openId = openId === song.id ? null : song.id; }}
        {onAction}
        {onRate}
        {onAnalyze}
      />
    {/each}
  </div>
{/if}
