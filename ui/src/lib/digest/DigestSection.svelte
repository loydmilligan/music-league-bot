<script lang="ts">
  import type { SectionKind } from './llm.js';
  import VariantPlaceholder from './VariantPlaceholder.svelte';
  import SectionInlineEditor from './SectionInlineEditor.svelte';
  import {
    VISUAL_CAPABLE,
    VARIANT_ICON,
    VARIANT_LABEL,
    SECTION_VARIANTS,
    effectiveVariant,
    showsTextual,
    showsVisual,
    type SectionVariant,
    type VisualComponent,
  } from './variants.js';

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
    /** Requested layout variant for this section (DB/modal choice or client override). */
    variant?: SectionVariant;
    /** Visual-only side payload (e.g. Standings payload) forwarded to the visual slot. */
    visualData?: unknown;
    /** Registered visual component for this kind, if any (frontend wires from the page). */
    visualComponent?: VisualComponent;
    onToggleExcluded: () => void;
    onToggleLocked: () => void;
    onRegen: () => void;
    onVariantChange?: (v: SectionVariant) => void;
    /** Persist a non-LLM inline content edit. The page PATCHes + invalidates. */
    onEditSave?: (content: unknown) => void;
    onKebabAction: (action: 'edit' | 'up' | 'down' | 'delete') => void;
  };
  let {
    kind,
    label,
    sectionState,
    content,
    variant = 'textual',
    visualData,
    visualComponent,
    onToggleExcluded,
    onToggleLocked,
    onRegen,
    onVariantChange,
    onEditSave,
    onKebabAction,
  }: Props = $props();

  // Inline (non-LLM) edit mode, toggled by the kebab "Edit inline" action.
  let editing = $state(false);

  // Effective variant: a visual-incapable kind collapses any visual request to
  // textual. The visual slot uses the registered component, else the placeholder.
  const effVariant = $derived(effectiveVariant(variant, kind));
  const canVisual = $derived(VISUAL_CAPABLE[kind]);
  const VisualSlot = $derived(visualComponent ?? VariantPlaceholder);
  const renderTextual = $derived(showsTextual(effVariant));
  const renderVisual = $derived(showsVisual(effVariant));

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
    if (action === 'edit') {
      editing = true;
      return;
    }
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

  // Consensus items have varied across drafts:
  //  - {title, artist, note}     (round 14)
  //  - {song, note}              (rounds 98, 102 — `song` is "Title — Artist")
  //  - {point | statement, ...}  (defensive fallback if a future draft uses that)
  type ConsensusItem = {
    title?: string;
    artist?: string;
    song?: string;
    point?: string;
    statement?: string;
    note?: string;
    detail?: string;
    body?: string;
    agreement?: string;
    supporters?: unknown;
  };
  function consensusHeadline(x: ConsensusItem): string {
    if (x.title && x.artist) return `${x.title} — ${x.artist}`;
    if (x.title) return x.title;
    if (x.song) return x.song;
    if (x.point) return x.point;
    if (x.statement) return x.statement;
    return '';
  }
  function consensusNote(x: ConsensusItem): string {
    return x.note ?? x.detail ?? x.body ?? x.agreement ?? '';
  }
  function isConsensus(x: unknown): x is ConsensusItem {
    return typeof x === 'object' && x !== null;
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
    {#if canVisual}
      <span class="dg-sa-divider"></span>
      <div class="dg-variant-switch" role="group" aria-label="Layout variant" data-export-hide="1">
        {#each SECTION_VARIANTS as v (v)}
          <button
            type="button"
            class="dg-vsw-btn"
            class:is-on={effVariant === v}
            onclick={() => onVariantChange?.(v)}
            title={`${VARIANT_LABEL[v]} layout`}
            aria-pressed={effVariant === v}
            disabled={sectionState === 'regenerating' || !onVariantChange}
          >{VARIANT_ICON[v]}</button>
        {/each}
      </div>
    {/if}
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

    {#if editing}
      <SectionInlineEditor
        {kind}
        {content}
        onSave={(c) => { editing = false; onEditSave?.(c); }}
        onCancel={() => (editing = false)}
      />
    {:else}
    {#if renderVisual}
      <VisualSlot {kind} {content} data={visualData} variant={effVariant === 'both' ? 'both' : 'visual'} />
    {/if}

    {#if renderTextual}
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
    {:else if kind === 'consensus' && items.length}
      <div class="dgC-consensus">
        {#each items as item, i (i)}
          {#if isConsensus(item)}
            {@const head = consensusHeadline(item)}
            {@const note = consensusNote(item)}
            <div class="dgC-consensus-row">
              {#if head}
                <p class="dgC-consensus-head">{head}</p>
              {/if}
              {#if note}
                <p class="dgC-consensus-note">{note}</p>
              {/if}
              {#if !head && !note}
                <p class="dgC-consensus-note">{itemText(item)}</p>
              {/if}
            </div>
          {:else}
            <div class="dgC-consensus-row">
              <p class="dgC-consensus-note">{itemText(item)}</p>
            </div>
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
    {/if}
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
  .dg-variant-switch {
    display: inline-flex;
    border: 1px solid var(--line);
    border-radius: var(--r-2);
    overflow: hidden;
  }
  .dg-vsw-btn {
    background: var(--surface);
    border: 0;
    padding: 3px 7px;
    font: 600 12px/1 var(--font-mono);
    color: var(--fg-muted);
    cursor: pointer;
    transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
  }
  .dg-vsw-btn + .dg-vsw-btn {
    border-left: 1px solid var(--line);
  }
  .dg-vsw-btn:hover:not(:disabled) {
    color: var(--fg);
  }
  .dg-vsw-btn.is-on {
    background: var(--mash-pulp-soft);
    color: var(--mash-pulp);
  }
  .dg-vsw-btn:disabled {
    cursor: default;
    opacity: 0.5;
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
  .dgC-consensus {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .dgC-consensus-row {
    padding: 10px 12px;
    border-left: 2px solid var(--moss, var(--ink-3));
    background: var(--ink-0);
    border-radius: 0 var(--r-2) var(--r-2) 0;
  }
  .dgC-consensus-head {
    margin: 0 0 4px;
    font: 700 14px/1.3 var(--font-body);
    color: var(--fg);
    font-style: italic;
  }
  .dgC-consensus-note {
    margin: 0;
    font: 400 12.5px/1.5 var(--font-body);
    color: var(--fg-2);
  }
</style>
