<!--
  CostSummaryCard.svelte
  Today's LLM spend split by category (digest / archive / predict) + total.
  Translated from cost-proto.jsx (MobileHome stats strip) and cost-q1.jsx legend.
  Uses Svelte 5 runes ($props, $derived).
-->
<script lang="ts">
  import type { DaySummary } from './costApi.js';

  let { summary }: { summary: DaySummary | null } = $props();

  function money(n: number): string {
    if (n >= 1) return `$${n.toFixed(2)}`;
    if (n >= 0.01) return `$${n.toFixed(3)}`;
    return `$${n.toFixed(4)}`;
  }

  const cats = $derived(
    summary
      ? [
          { key: 'digest',  label: 'Digest',  value: summary.digest,  mod: 'cd-cat--digest' },
          { key: 'archive', label: 'Archive', value: summary.archive, mod: 'cd-cat--archive' },
          { key: 'predict', label: 'Predict', value: summary.predict, mod: 'cd-cat--predict' },
          { key: 'avatar',  label: 'Avatar',  value: summary.avatar,  mod: 'cd-cat--avatar' },
        ]
      : []
  );
</script>

<div class="cd-summary-card">
  <div class="cd-card-title">
    Today's spend
    {#if summary}
      <span class="cd-card-total">{money(summary.total)}</span>
    {/if}
  </div>

  {#if summary === null}
    <div class="cd-empty">(loading...)</div>
  {:else if summary.total === 0}
    <div class="cd-empty">(no calls today)</div>
  {:else}
    <div class="cd-cats">
      {#each cats as cat (cat.key)}
        <div class="cd-cat {cat.mod}">
          <div class="cd-cat-dot"></div>
          <div class="cd-cat-label">{cat.label}</div>
          <div class="cd-cat-value">{money(cat.value)}</div>
          {#if summary.total > 0}
            <div class="cd-cat-bar-wrap">
              <div
                class="cd-cat-bar"
                style:width="{Math.max(0, (cat.value / summary.total) * 100)}%"
              ></div>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .cd-summary-card {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--r-4);
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .cd-card-title {
    font: 700 13px/1.2 var(--font-body);
    color: var(--fg);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .cd-card-total {
    font: 800 18px/1 var(--font-mono);
    color: var(--fg);
    letter-spacing: -0.03em;
  }

  .cd-empty {
    font: 400 12px/1.4 var(--font-body);
    color: var(--fg-quiet);
    font-style: italic;
  }

  .cd-cats {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .cd-cat {
    display: grid;
    grid-template-columns: 10px 1fr auto;
    grid-template-rows: auto 6px;
    gap: 0 8px;
    align-items: center;
  }

  .cd-cat-dot {
    width: 9px;
    height: 9px;
    border-radius: 999px;
    grid-row: 1;
    grid-column: 1;
    margin-top: 1px;
  }

  .cd-cat-label {
    font: 700 11px/1 var(--font-body);
    color: var(--fg-muted);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    grid-row: 1;
    grid-column: 2;
    align-self: center;
  }

  .cd-cat-value {
    font: 700 13px/1 var(--font-mono);
    color: var(--fg);
    letter-spacing: -0.02em;
    grid-row: 1;
    grid-column: 3;
    text-align: right;
  }

  .cd-cat-bar-wrap {
    grid-row: 2;
    grid-column: 2 / 4;
    height: 4px;
    background: var(--ink-3);
    border-radius: 999px;
    overflow: hidden;
    margin-top: 4px;
  }

  .cd-cat-bar {
    height: 100%;
    border-radius: 999px;
    transition: width 0.3s ease;
  }

  /* category colors */
  .cd-cat--digest .cd-cat-dot { background: var(--mash-pulp); }
  .cd-cat--digest .cd-cat-label { color: var(--mash-pulp); }
  .cd-cat--digest .cd-cat-bar { background: var(--mash-pulp); }

  .cd-cat--archive .cd-cat-dot { background: var(--moss); }
  .cd-cat--archive .cd-cat-label { color: var(--moss); }
  .cd-cat--archive .cd-cat-bar { background: var(--moss); }

  .cd-cat--predict .cd-cat-dot { background: var(--sky); }
  .cd-cat--predict .cd-cat-label { color: var(--sky); }
  .cd-cat--predict .cd-cat-bar { background: var(--sky); }

  .cd-cat--avatar .cd-cat-dot { background: var(--amber); }
  .cd-cat--avatar .cd-cat-label { color: var(--amber); }
  .cd-cat--avatar .cd-cat-bar { background: var(--amber); }
</style>
