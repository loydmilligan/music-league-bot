<script lang="ts">
  /**
   * Pre-generation material for a round: what exists to build the digest from.
   *
   * Sits below the prep-checks list on the prepare stage and answers a
   * different question — checks ask "is the data imported?", this asks "what
   * material do we hold?". Same visual language on purpose.
   */
  import type { MaterialRow } from './prepMaterial.js';

  let { material }: { material: MaterialRow[]; roundId: number } = $props();

  let open = $state<Record<string, boolean>>({});
  const toggle = (id: string) => { open = { ...open, [id]: !open[id] }; };

  function glyph(status: MaterialRow['status']): string {
    return status === 'present' ? '✓' : status === 'not-enabled' ? '–' : '!';
  }
  function colour(status: MaterialRow['status']): string {
    return status === 'present' ? 'var(--moss)'
      : status === 'not-enabled' ? 'var(--fg-quiet)' : 'var(--amber)';
  }
  const presentCount = $derived(material.filter((m) => m.status === 'present').length);
</script>

<div class="dg-prep-material">
  <header class="dg-prep-material-hd">
    <span class="dg-prep-material-label">
      Pre-generation material · {presentCount}/{material.length}
    </span>
  </header>

  <div class="dg-prep-material-list">
    {#each material as row (row.id)}
      <div class="dg-prep-material-row">
        <span class="dg-prep-material-glyph" style="color: {colour(row.status)};">
          {glyph(row.status)}
        </span>
        <span class="dg-prep-material-name">
          {row.name}{row.count !== undefined ? ` · ${row.count}` : ''}
          {#if row.status === 'not-enabled'}<em> (not enabled for this league)</em>{/if}
        </span>
        <span class="dg-prep-material-src">{row.src}</span>
        {#if row.preview !== undefined}
          <button type="button" class="mash-btn mash-btn--ghost mash-btn--sm"
                  onclick={() => toggle(row.id)}>
            {open[row.id] ? 'hide' : 'preview'}
          </button>
        {/if}
      </div>
      {#if open[row.id] && row.preview !== undefined}
        <pre class="dg-prep-material-preview">{JSON.stringify(row.preview, null, 2)}</pre>
      {/if}
    {/each}
  </div>
</div>

<style>
  .dg-prep-material { display: flex; flex-direction: column; gap: 6px; }
  .dg-prep-material-hd { display: flex; justify-content: space-between; align-items: baseline; }
  .dg-prep-material-label { font: 600 11px/1 var(--font-mono); color: var(--fg-quiet); text-transform: uppercase; letter-spacing: 0.04em; }
  .dg-prep-material-list { display: flex; flex-direction: column; gap: 6px; }
  .dg-prep-material-row {
    display: grid; grid-template-columns: 22px 1fr auto auto; gap: 12px; align-items: baseline;
    padding: 8px 10px; background: var(--ink-0); border: 1px solid var(--line); border-radius: var(--r-2);
  }
  .dg-prep-material-glyph { text-align: center; font: 700 14px/1 var(--font-mono); }
  .dg-prep-material-name { font: 500 13px/1.4 var(--font-body); color: var(--fg); }
  .dg-prep-material-name em { color: var(--fg-quiet); font-style: normal; }
  .dg-prep-material-src { font: 500 11px/1 var(--font-mono); color: var(--fg-quiet); }
  .dg-prep-material-preview {
    margin: 0 0 4px; padding: 10px 12px; background: var(--ink-0);
    border: 1px solid var(--line); border-radius: var(--r-2);
    font: 500 11px/1.5 var(--font-mono); color: var(--fg-quiet);
    max-height: 320px; overflow: auto; white-space: pre-wrap;
  }
</style>
