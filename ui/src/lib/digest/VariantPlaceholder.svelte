<script lang="ts">
  // Frontend stub visual — the fallback that fills any section's VISUAL slot
  // until viz registers a real component for that kind. It exists so the
  // variant mechanism is always demonstrable (visual/both never render blank)
  // AND so viz has a live reference implementation of VisualComponentProps.
  //
  // viz: do NOT build on top of this. Author your own .svelte file matching
  // VisualComponentProps (see variants.ts) and hand frontend the filename.
  import type { VisualComponentProps } from './variants.js';

  let { kind, content, variant }: VisualComponentProps = $props();

  type Content = { title?: string; body?: string; items?: unknown[] };
  const c = $derived((content ?? {}) as Content);
  const items = $derived(Array.isArray(c.items) ? c.items : []);

  function line(item: unknown): string {
    if (item == null) return '';
    if (typeof item === 'string') return item;
    if (typeof item === 'object') {
      const o = item as Record<string, unknown>;
      const head = o.title ?? o.song ?? o.artist ?? o.quote ?? o.point ?? '';
      return String(head || JSON.stringify(item));
    }
    return String(item);
  }
</script>

<div class="dg-variant-placeholder" data-variant-kind={kind}>
  <div class="dg-vp-tag">▦ visual slot · {kind}{variant === 'both' ? ' · + caption' : ''}</div>
  <p class="dg-vp-note">viz visual component pending — placeholder renders content shape</p>
  {#if items.length}
    <ul class="dg-vp-list">
      {#each items.slice(0, 6) as item, i (i)}
        <li>{line(item)}</li>
      {/each}
    </ul>
  {:else if c.body}
    <p class="dg-vp-body">{c.body}</p>
  {/if}
</div>

<style>
  .dg-variant-placeholder {
    border: 1px dashed var(--line-strong);
    border-radius: var(--r-3);
    background: repeating-linear-gradient(
      135deg,
      var(--ink-0),
      var(--ink-0) 10px,
      var(--surface-2) 10px,
      var(--surface-2) 20px
    );
    padding: 14px 16px;
    margin: 8px 0 0;
  }
  .dg-vp-tag {
    font: 700 10px/1 var(--font-mono);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--mash-pulp);
  }
  .dg-vp-note {
    margin: 6px 0 0;
    font: 500 11px/1.4 var(--font-mono);
    color: var(--fg-quiet);
  }
  .dg-vp-list {
    margin: 10px 0 0;
    padding-left: 18px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    color: var(--fg-2);
    font: 600 13px/1.4 var(--font-body);
  }
  .dg-vp-body {
    margin: 10px 0 0;
    color: var(--fg-2);
    font: 400 13px/1.5 var(--font-body);
  }
</style>
