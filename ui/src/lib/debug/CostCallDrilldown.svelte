<!--
  CostCallDrilldown.svelte
  Table of individual LLM call records — time / category / label / model / tokens / cost / latency.
  Sorted newest-first. On mobile (412px) the model column is hidden via CSS.
  Translated from cost-proto.jsx call table patterns.
  Uses Svelte 5 runes ($props, $derived).
-->
<script lang="ts">
  import type { CostCall } from './costApi.js';

  let { calls }: { calls: CostCall[] } = $props();

  function money(n: number): string {
    if (n === 0) return '$0';
    if (n >= 0.01) return `$${n.toFixed(3)}`;
    return `$${n.toFixed(5)}`;
  }

  function fmt_time(ts: string): string {
    const d = new Date(ts);
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function fmt_tokens(prompt: number, completion: number): string {
    const total = prompt + completion;
    if (total >= 1000) return `${(total / 1000).toFixed(1)}k`;
    return String(total);
  }

  function fmt_latency(ms: number | null | undefined): string {
    if (ms == null) return '—';
    if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
    return `${ms}ms`;
  }

  // Abbreviate model id to a readable short form
  function abbr_model(modelId: string): string {
    return modelId
      .replace('anthropic/', '')
      .replace('google/', '')
      .replace('openai/', '')
      .replace('meta-llama/', '')
      .replace('deepseek/', '')
      .replace('minimax/', '');
  }
</script>

<div class="cdd-wrap">
  <div class="cdd-title">
    Call drilldown
    <span class="cdd-count">{calls.length} calls</span>
  </div>

  {#if calls.length === 0}
    <div class="cdd-empty">(no calls today)</div>
  {:else}
    <div class="cdd-table-wrap">
      <table class="cdd-table">
        <thead>
          <tr>
            <th class="cdd-th">Time</th>
            <th class="cdd-th">Cat</th>
            <th class="cdd-th cdd-th--label">Label</th>
            <th class="cdd-th cdd-th--model">Model</th>
            <th class="cdd-th cdd-th--right">Tokens</th>
            <th class="cdd-th cdd-th--right">Cost</th>
            <th class="cdd-th cdd-th--right">Latency</th>
          </tr>
        </thead>
        <tbody>
          {#each calls as call (call.ts + call.label + call.model)}
            <tr class="cdd-row">
              <td class="cdd-td cdd-td--time">{fmt_time(call.ts)}</td>
              <td class="cdd-td">
                <span class="cdd-cat cdd-cat--{call.category}">{call.category}</span>
              </td>
              <td class="cdd-td cdd-td--label" title={call.label}>{call.label}</td>
              <td class="cdd-td cdd-td--model" title={call.model}>{abbr_model(call.model)}</td>
              <td class="cdd-td cdd-td--right cdd-td--mono">{fmt_tokens(call.prompt_tokens, call.completion_tokens)}</td>
              <td class="cdd-td cdd-td--right cdd-td--mono">{money(call.cost_usd)}</td>
              <td class="cdd-td cdd-td--right cdd-td--mono">{fmt_latency(call.latency_ms)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

<style>
  .cdd-wrap {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--r-4);
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .cdd-title {
    font: 700 13px/1.2 var(--font-body);
    color: var(--fg);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .cdd-count {
    font: 500 10px/1 var(--font-mono);
    color: var(--fg-quiet);
    letter-spacing: 0.02em;
  }

  .cdd-empty {
    font: 400 12px/1.4 var(--font-body);
    color: var(--fg-quiet);
    font-style: italic;
  }

  .cdd-table-wrap {
    overflow-x: auto;
    margin: 0 -14px;
    padding: 0 14px;
  }

  .cdd-table {
    width: 100%;
    border-collapse: collapse;
    font: 500 11px/1.4 var(--font-body);
  }

  .cdd-th {
    font: 700 9px/1 var(--font-mono);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--fg-muted);
    padding: 6px 8px 6px 0;
    text-align: left;
    border-bottom: 1px solid var(--line);
    white-space: nowrap;
  }

  .cdd-th--right { text-align: right; }

  .cdd-row {
    border-bottom: 1px solid var(--line);
    transition: background 0.12s ease;
  }

  .cdd-row:last-child { border-bottom: none; }
  .cdd-row:hover { background: var(--surface-hover); }

  .cdd-td {
    padding: 7px 8px 7px 0;
    color: var(--fg-muted);
    vertical-align: middle;
    white-space: nowrap;
  }

  .cdd-td--time {
    font: 500 10px/1 var(--font-mono);
    color: var(--fg-quiet);
  }

  .cdd-td--label {
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--fg-2);
    white-space: nowrap;
  }

  .cdd-td--model {
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font: 500 10px/1 var(--font-mono);
    color: var(--fg-quiet);
  }

  .cdd-td--right { text-align: right; }

  .cdd-td--mono {
    font: 600 11px/1 var(--font-mono);
    color: var(--fg);
    letter-spacing: -0.01em;
  }

  /* category badge */
  .cdd-cat {
    font: 700 8px/1 var(--font-mono);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 3px 5px;
    border-radius: var(--r-1);
  }

  .cdd-cat--digest  { background: var(--mash-pulp-soft); color: var(--mash-pulp); }
  .cdd-cat--archive { background: var(--moss-soft);      color: var(--moss); }
  .cdd-cat--predict { background: var(--sky-soft);       color: var(--sky); }

  /* On mobile (≤460px): hide model column */
  @media (max-width: 460px) {
    .cdd-th--model,
    .cdd-td--model {
      display: none;
    }
    .cdd-td--label {
      max-width: 90px;
    }
  }
</style>
