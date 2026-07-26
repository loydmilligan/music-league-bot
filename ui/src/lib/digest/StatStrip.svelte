<script lang="ts" module>
  // Legacy season-recap stat strip. Normal round digests use DigestInsights.
  import type { VisualComponentProps } from './variants.js';

  export type DigestStats = {
    totalVotes?: number;
    submitters?: number;
    blowoutMargin?: number;
    closestRace?: number;
    uniqueArtists?: number;
    recap?: boolean;
    songs?: number;
    votes?: number;
    rounds?: number;
    players?: number;
    biggestRoundVotes?: number;
  };

  type Tile = { key: keyof DigestStats; label: string; suffix?: string };
  const TILES: Tile[] = [
    { key: 'totalVotes', label: 'Votes cast' },
    { key: 'submitters', label: 'Submitters' },
    { key: 'blowoutMargin', label: 'Biggest blowout', suffix: 'pt' },
    { key: 'closestRace', label: 'Closest race', suffix: 'pt' },
    { key: 'uniqueArtists', label: 'Unique artists' },
  ];
  const RECAP_TILES: Tile[] = [
    { key: 'songs', label: 'Songs' },
    { key: 'votes', label: 'Votes cast' },
    { key: 'rounds', label: 'Rounds' },
    { key: 'players', label: 'Players' },
    { key: 'biggestRoundVotes', label: 'Biggest round', suffix: ' votes' },
  ];
</script>

<script lang="ts">
  let { data }: VisualComponentProps = $props();
  const stats = $derived((data ?? {}) as DigestStats);
  const tiles = $derived(stats.recap ? RECAP_TILES : TILES);
  const shown = $derived(tiles.filter((t) => typeof stats[t.key] === 'number'));
</script>

{#if shown.length}
  <div class="ss" data-component="stats-strip-viz">
    {#each shown as t (t.key)}
      <div class="ss-tile">
        <span class="ss-val">{stats[t.key]}{#if t.suffix}<span class="ss-suffix">{t.suffix}</span>{/if}</span>
        <span class="ss-label">{t.label}</span>
      </div>
    {/each}
  </div>
{/if}

<style>
  .ss { display:grid; grid-template-columns:repeat(5,1fr); gap:8px; }
  .ss-tile { display:flex; flex-direction:column; gap:3px; padding:12px 10px; background:var(--surface); border:1px solid var(--line); border-radius:var(--r-3); min-width:0; }
  .ss-val { font:700 22px/1 var(--font-mono); color:var(--fg); letter-spacing:-.02em; font-variant-numeric:tabular-nums; white-space:nowrap; }
  .ss-suffix { font-size:11px; color:var(--fg-quiet); font-weight:500; margin-left:2px; }
  .ss-label { font:700 9px/1.2 var(--font-mono); letter-spacing:.06em; text-transform:uppercase; color:var(--fg-muted); }
  :global(.dg-export--mobile) .ss { grid-template-columns:1fr; }
  @media (max-width:520px) { .ss { grid-template-columns:1fr; } }
</style>
