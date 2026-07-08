<script lang="ts">
  // D4 — obscurity drift: filled median area + per-round winner dots (ties → two
  // dots at one x). Dashed season boundaries. Geometry from viz.driftGeometry.
  import { driftGeometry, DRIFT_W, DRIFT_H, type DriftRound } from '$lib/league-research/viz';

  let { drift }: { drift: (DriftRound & { roundName?: string })[] } = $props();

  const g = $derived(driftGeometry(drift));
</script>

{#if !drift.length}
  <p class="lr-note">No rounds in this scope yet.</p>
{:else}
  <div class="lr-drift">
    <svg viewBox={`0 0 ${DRIFT_W} ${DRIFT_H}`} width="100%" role="img" aria-label="league obscurity per round over time">
      {#each g.seasonBoundaries as sb}
        <line x1={sb.x} y1="10" x2={sb.x} y2="170" stroke="var(--line-strong)" stroke-width="1" stroke-dasharray="3,3" />
        <text x={sb.labelX} y="184" font-family="var(--font-mono)" font-size="9" fill="var(--fg-quiet)">{sb.label}</text>
      {/each}
      <polygon
        points={g.medianAreaPolygon}
        fill="color-mix(in oklch, var(--accent) 20%, transparent)"
        stroke="var(--accent)"
        stroke-width="1.5"
      />
      {#each g.winnerDots as d}
        <circle cx={d.x} cy={d.y} r="3.5" fill="var(--sky)" />
      {/each}
    </svg>
    <div class="lr-legend">
      <span><i class="lr-sw lr-sw-area"></i>league median (area)</span>
      <span><i class="lr-sw lr-sw-dot"></i>round winner</span>
    </div>
  </div>
{/if}

<style>
  .lr-drift {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .lr-legend {
    display: flex;
    gap: 14px;
  }
  .lr-legend span {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--fg-muted);
  }
  .lr-sw {
    display: inline-block;
  }
  .lr-sw-area {
    width: 10px;
    height: 8px;
    background: color-mix(in oklch, var(--accent) 40%, transparent);
    border: 1px solid var(--accent);
  }
  .lr-sw-dot {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: var(--sky);
  }
  .lr-note {
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--fg-quiet);
    font-style: italic;
  }
</style>
