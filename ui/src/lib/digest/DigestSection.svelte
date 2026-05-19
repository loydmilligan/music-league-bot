<script lang="ts">
  import type { SectionKind } from './llm.js';

  export type SectionState = 'default' | 'excluded' | 'locked' | 'regenerating';

  // Generic shape — the LLM is instructed to return per-kind objects but the
  // exact item shape varies. We render defensively: title/body/items if present.
  type SectionContent = {
    title?: string;
    body?: string;
    items?: unknown[];
  };

  type Props = {
    kind: SectionKind;
    label: string;
    sectionState: SectionState;
    content: unknown;
    onToggleExcluded: () => void;
    onToggleLocked: () => void;
    onRegen: () => void;
    onKebabAction: (action: 'edit' | 'up' | 'down' | 'delete') => void;
  };
  let {
    kind,
    label,
    sectionState,
    content,
    onToggleExcluded,
    onToggleLocked,
    onRegen,
    onKebabAction,
  }: Props = $props();

  let kebabOpen = $state(false);
  let kebabRef: HTMLDivElement | undefined;

  function toggleKebab(e: MouseEvent) {
    e.stopPropagation();
    kebabOpen = !kebabOpen;
  }
  function closeKebab() {
    kebabOpen = false;
  }
  function handleDocClick(e: MouseEvent) {
    if (!kebabOpen) return;
    if (kebabRef && !kebabRef.contains(e.target as Node)) kebabOpen = false;
  }
  function runKebab(action: 'edit' | 'up' | 'down' | 'delete') {
    kebabOpen = false;
    onKebabAction(action);
  }

  const c = $derived((content ?? {}) as SectionContent);
  const items = $derived(Array.isArray(c.items) ? c.items : []);
  const eyebrow = $derived(c.title?.trim() ? c.title : label);

  const wrapClass = $derived(
    'dg-section-wrap' +
      (sectionState === 'excluded' ? ' is-excluded' : '') +
      (sectionState === 'locked' ? ' is-locked' : '') +
      (sectionState === 'regenerating' ? ' is-regenerating' : ''),
  );

  function itemText(item: unknown): string {
    if (item === null || item === undefined) return '';
    if (typeof item === 'string') return item;
    if (typeof item === 'number' || typeof item === 'boolean') return String(item);
    return JSON.stringify(item);
  }

  type QuoteItem = { voter?: string; quote?: string };
  function isQuote(x: unknown): x is QuoteItem {
    return typeof x === 'object' && x !== null && ('voter' in x || 'quote' in x);
  }

  type PodiumItem = {
    rank?: number;
    position?: number;
    title?: string;
    artist?: string;
    submitter?: string;
    points?: number;
    vote_total?: number;
  };
  function isPodium(x: unknown): x is PodiumItem {
    return typeof x === 'object' && x !== null && ('title' in x || 'artist' in x || 'rank' in x);
  }
</script>

<svelte:document onclick={handleDocClick} />

<div class={wrapClass} data-section-kind={kind}>
  {#if sectionState === 'excluded'}
    <div class="dg-excluded-banner">⊘ excluded from final · {label}</div>
  {:else if sectionState === 'locked'}
    <div class="dg-locked-banner">🔒 locked · whole-draft regen will skip</div>
  {:else if sectionState === 'regenerating'}
    <div class="dg-regen-banner">regenerating · {label} · ~ 4s</div>
  {/if}

  <div class="dg-section-actions">
    <button
      type="button"
      class="dg-sa-btn"
      onclick={onToggleExcluded}
      title={sectionState === 'excluded' ? 'Include in final' : 'Exclude from final'}
      aria-pressed={sectionState !== 'excluded'}
      disabled={sectionState === 'regenerating'}
    >{sectionState === 'excluded' ? '+' : '⊘'}</button>
    <button
      type="button"
      class="dg-sa-btn"
      onclick={onRegen}
      title="Regenerate this section…"
      disabled={sectionState === 'regenerating' || sectionState === 'excluded'}
    >↻</button>
    <button
      type="button"
      class="dg-sa-btn"
      class:is-locked={sectionState === 'locked'}
      onclick={onToggleLocked}
      title={sectionState === 'locked' ? 'Unlock · allow whole-draft regen' : 'Lock · pin this version'}
      aria-pressed={sectionState === 'locked'}
      disabled={sectionState === 'regenerating'}
    >{sectionState === 'locked' ? '🔒' : '🔓'}</button>
    <span class="dg-sa-divider"></span>
    <div bind:this={kebabRef} style="position: relative;">
      <button
        type="button"
        class="dg-sa-btn"
        onclick={toggleKebab}
        title="More…"
        aria-haspopup="menu"
        aria-expanded={kebabOpen}
        disabled={sectionState === 'regenerating'}
      >⋯</button>
      {#if kebabOpen}
        <div class="dg-sa-kebab-pop" role="menu" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.key === 'Escape' && closeKebab()}>
          <button type="button" class="dg-sa-kebab-row" role="menuitem" onclick={() => runKebab('edit')}>
            <span class="glyph">✎</span>
            <span>Edit inline · no llm</span>
            <span class="hotkey">e</span>
          </button>
          <button type="button" class="dg-sa-kebab-row" role="menuitem" onclick={() => runKebab('up')}>
            <span class="glyph">↑</span>
            <span>Move section up</span>
            <span class="hotkey">[</span>
          </button>
          <button type="button" class="dg-sa-kebab-row" role="menuitem" onclick={() => runKebab('down')}>
            <span class="glyph">↓</span>
            <span>Move section down</span>
            <span class="hotkey">]</span>
          </button>
          <div class="dg-sa-kebab-divider"></div>
          <button type="button" class="dg-sa-kebab-row is-danger" role="menuitem" onclick={() => runKebab('delete')}>
            <span class="glyph">✕</span>
            <span>Delete from draft</span>
            <span class="hotkey">⌫</span>
          </button>
        </div>
      {/if}
    </div>
  </div>

  <section class="dg-section">
    <p class="dg-section-eyebrow">{eyebrow}</p>

    {#if kind === 'quotes' && items.length}
      <div class="dgC-quotes">
        {#each items as item, i (i)}
          {#if isQuote(item)}
            <div class="dgC-quote">
              <p class="dgC-quote-q">"{item.quote ?? ''}"</p>
              <div class="dgC-quote-em">{item.voter ?? ''}</div>
            </div>
          {:else}
            <div class="dgC-quote">
              <p class="dgC-quote-q">{itemText(item)}</p>
            </div>
          {/if}
        {/each}
      </div>
    {:else if kind === 'podium' && items.length}
      <div class="dgC-tracks">
        {#each items as item, i (i)}
          {#if isPodium(item)}
            {@const rank = item.rank ?? item.position ?? i + 1}
            {@const pts = item.vote_total ?? item.points}
            <div class="dgC-track {rank === 1 ? 'dgC-track--gold' : rank === 2 ? 'dgC-track--silver' : rank === 3 ? 'dgC-track--bronze' : ''}">
              <span class="dgC-track-num">{String(rank).padStart(2, '0')}.</span>
              <div class="dgC-track-meta">
                <span class="dgC-track-title">{item.title ?? ''}</span>
                <span class="dgC-track-artist">{item.artist ?? ''}</span>
              </div>
              {#if item.submitter}
                <span class="dgC-track-sub">submitted by <span class="name">{item.submitter}</span></span>
              {/if}
              {#if pts !== undefined}
                <span class="dgC-track-pts">{pts} pt</span>
              {/if}
            </div>
          {:else}
            <div class="dgC-track"><span class="dgC-track-meta">{itemText(item)}</span></div>
          {/if}
        {/each}
      </div>
    {:else if items.length}
      <ul class="dg-section-items">
        {#each items as item, i (i)}
          <li>{itemText(item)}</li>
        {/each}
      </ul>
    {/if}

    {#if c.body}
      <p class="dg-section-body">{c.body}</p>
    {/if}

    {#if !items.length && !c.body}
      <p class="dg-section-body dg-section-empty">(no content)</p>
    {/if}
  </section>
</div>

<style>
  .dg-sa-kebab-row {
    background: transparent;
    border: 0;
    text-align: left;
    width: 100%;
  }
  .dg-section-items {
    margin: 0;
    padding-left: 18px;
    color: var(--fg-2);
    font: 400 13px/1.55 var(--font-body);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .dg-section-body {
    margin: 12px 0 0;
    color: var(--fg-2);
    font: 400 13px/1.55 var(--font-body);
    white-space: pre-wrap;
  }
  .dg-section-empty {
    color: var(--fg-quiet);
    font-style: italic;
  }
</style>
