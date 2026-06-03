<script lang="ts" module>
  // ── stats-strip-viz · sprint-17 (viz) ─────────────────────────────────────
  // "By-the-numbers" stat strip — a compact row of round-stat tiles.
  // Implements the variant slot interface (`VisualComponentProps`, variants.ts);
  // data-driven via the section's `visualData` → the `data` prop. Backend
  // `stats` payload:
  //   { totalVotes, submitters, blowoutMargin, closestRace, uniqueArtists }
  //
  // Variants: the tiles render in a row in the web/wide view and **reflow to a
  // single column** in the mobile PNG + PDF export — keyed off the global
  // `.dg-export--mobile` frame class (the page applies it at ?format=mobile,
  // which the PDF render uses too) plus a narrow-viewport media query. Static
  // content — no interactivity needed; the reflow IS the export variant.
  import type { VisualComponentProps } from './variants.js';

  export type DigestStats = {
    totalVotes?: number;
    submitters?: number;
    blowoutMargin?: number;
    closestRace?: number;
    uniqueArtists?: number;
  };

  type Tile = { key: keyof DigestStats; label: string; suffix?: string };
  const TILES: Tile[] = [
    { key: 'totalVotes', label: 'Votes cast' },
    { key: 'submitters', label: 'Submitters' },
    { key: 'blowoutMargin', label: 'Biggest blowout', suffix: 'pt' },
    { key: 'closestRace', label: 'Closest race', suffix: 'pt' },
    { key: 'uniqueArtists', label: 'Unique artists' },
  ];
</script>

<script lang="ts">
  let { data }: VisualComponentProps = $props();

  const stats = $derived((data ?? {}) as DigestStats);
  // Render only the tiles whose value is present (defensive against a partial
  // payload); suppress the whole strip if nothing is populated.
  const shown = $derived(TILES.filter((t) => typeof stats[t.key] === 'number'));
</script>

{#if shown.length}
  <div class="ss" data-component="stats-strip-viz">
    {#each shown as t (t.key)}
      <div class="ss-tile">
        <span class="ss-val"
          >{stats[t.key]}{#if t.suffix}<span class="ss-suffix">{t.suffix}</span>{/if}</span
        >
        <span class="ss-label">{t.label}</span>
      </div>
    {/each}
  </div>
{/if}

<style>
  .ss {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 8px;
  }
  .ss-tile {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 12px 10px;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--r-3);
    min-width: 0;
  }
  .ss-val {
    font: 700 22px/1 var(--font-mono);
    color: var(--fg);
    letter-spacing: -0.02em;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .ss-suffix {
    font-size: 11px;
    color: var(--fg-quiet);
    font-weight: 500;
    margin-left: 2px;
  }
  .ss-label {
    font: 700 9px/1.2 var(--font-mono);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--fg-muted);
  }

  /* Reflow: single column inside the mobile/PDF export frame, and on a
     genuinely narrow browser. The wide PNG (export, format=wide) keeps the row. */
  :global(.dg-export--mobile) .ss {
    grid-template-columns: 1fr;
  }
  @media (max-width: 520px) {
    .ss {
      grid-template-columns: 1fr;
    }
  }
</style>
