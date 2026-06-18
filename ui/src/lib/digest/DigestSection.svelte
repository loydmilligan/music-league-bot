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
    /** digest_sections.id — required to POST delight signals. */
    sectionId: string;
    /** round id from the route — required to POST delight signals. */
    roundId: number;
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
    sectionId,
    roundId,
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

  // -------- Delight control (sprint-42 b1-delight-control) ----------
  // Three states: idle → open (modal) → marked (transient success badge).
  type DelightPhase = 'idle' | 'open' | 'saving' | 'marked' | 'error';
  let delightPhase = $state<DelightPhase>('idle');
  let delightNote = $state('');
  let delightPickIdx = $state(0);
  let delightError = $state('');

  // Extract sentence-level spans from the section's body text for the span-picker.
  // Falls back to the whole body as a single span when there are no sentence breaks.
  const delightSpans = $derived.by<string[]>(() => {
    const body = (content as { body?: string } | null)?.body?.trim() ?? '';
    if (!body) return [];
    // Split on sentence-ending punctuation followed by a space or end-of-string.
    const raw = body.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) ?? [];
    const spans = raw.map((s) => s.trim()).filter(Boolean);
    return spans.length ? spans : [body];
  });

  // Only show the ▲ button on sections that have rendered AI content (non-empty body)
  // and are not excluded or regenerating.
  const showDelightBtn = $derived(
    sectionState !== 'excluded' &&
    sectionState !== 'regenerating' &&
    delightSpans.length > 0,
  );

  function openDelight(e: MouseEvent) {
    e.stopPropagation();
    delightPickIdx = 0;
    delightNote = '';
    delightError = '';
    delightPhase = 'open';
  }
  function closeDelight() {
    delightPhase = 'idle';
  }
  function handleDelightScrimClick() {
    if (delightPhase === 'open') closeDelight();
  }

  async function saveDelight() {
    if (delightPhase !== 'open') return;
    const span = delightSpans[delightPickIdx] ?? '';
    if (!span) { delightError = 'Pick a span first.'; return; }
    delightPhase = 'saving';
    delightError = '';
    try {
      const res = await fetch(`/api/digest/${roundId}/sections/${sectionId}/delight`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sectionId,
          span,
          subsection: kind,
          note: delightNote.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`delight POST failed (${res.status}) ${txt.slice(0, 120)}`);
      }
      delightPhase = 'marked';
      // Badge is transient — fade back to idle after 4 s.
      setTimeout(() => {
        if (delightPhase === 'marked') delightPhase = 'idle';
      }, 4000);
    } catch (err) {
      delightError = err instanceof Error ? err.message : String(err);
      delightPhase = 'open'; // roll back so user can retry / dismiss
    }
  }

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

{#if delightPhase === 'open' || delightPhase === 'saving'}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="dg-delight-scrim"
    onclick={handleDelightScrimClick}
    role="dialog"
    aria-modal="true"
    aria-label="Mark a standout"
    tabindex="-1"
  >
    <div
      class="dg-delight-modal"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.key === 'Escape' && closeDelight()}
      role="presentation"
    >
      <div class="dg-delight-grab" aria-hidden="true"></div>
      <div class="dg-delight-head">
        <div class="dg-delight-ttl">✦ Mark a standout</div>
        <div class="dg-delight-sub">{label} · pick the exact line that earned it.</div>
      </div>
      <div class="dg-delight-body">
        <div class="dg-delight-sect">
          <span class="dg-delight-k">The standout line</span>
          <div class="dg-spanpick" role="listbox" aria-label="Select a standout span">
            {#each delightSpans as span, i (i)}
              <span
                class="dg-spanopt"
                class:is-pick={i === delightPickIdx}
                onclick={() => (delightPickIdx = i)}
                onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && (delightPickIdx = i)}
                role="option"
                aria-selected={i === delightPickIdx}
                tabindex="0"
              >{span} </span>
            {/each}
          </div>
        </div>
        <div class="dg-delight-sect">
          <span class="dg-delight-k">Why it is good <span class="dg-delight-opt">· optional</span></span>
          <textarea
            class="dg-delight-note"
            rows="2"
            placeholder="e.g. 'ran the table' — vivid, specific, not generic AI phrasing"
            bind:value={delightNote}
            disabled={delightPhase === 'saving'}
          ></textarea>
        </div>
        {#if delightError}
          <div class="dg-delight-err" role="alert">{delightError}</div>
        {/if}
      </div>
      <div class="dg-delight-foot">
        <button type="button" class="dg-delight-cancel" onclick={closeDelight} disabled={delightPhase === 'saving'}>
          Cancel
        </button>
        <button type="button" class="dg-delight-save" onclick={saveDelight} disabled={delightPhase === 'saving'}>
          {delightPhase === 'saving' ? '…' : '✦ Save signal'}
        </button>
      </div>
    </div>
  </div>
{/if}

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
    {#if showDelightBtn}
      <span class="dg-sa-divider" data-export-hide="1"></span>
      <button
        type="button"
        class="dg-sa-btn dg-delight-btn"
        class:is-marked={delightPhase === 'marked'}
        onclick={openDelight}
        title="Mark a standout · log a delight signal"
        data-export-hide="1"
      >
        {#if delightPhase === 'marked'}
          <span class="dg-delight-star">✦</span><span class="dg-delight-label">marked</span>
        {:else}
          ▲
        {/if}
      </button>
    {/if}
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

  /* -------- Delight ▲ button ---------- */
  .dg-delight-btn {
    font: 600 13px/1 var(--font-mono);
    color: var(--fg-muted);
    transition: color var(--dur-fast) var(--ease-out);
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .dg-delight-btn:hover:not(:disabled) {
    color: var(--amber);
  }
  .dg-delight-btn.is-marked {
    color: var(--amber);
  }
  .dg-delight-star {
    font-size: 11px;
  }
  .dg-delight-label {
    font: 700 10px/1 var(--font-mono);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  /* -------- Delight modal (bottom-sheet style) ---------- */
  .dg-delight-scrim {
    position: fixed;
    inset: 0;
    background: rgba(7, 9, 12, 0.72);
    z-index: 200;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    padding: 0 0 env(safe-area-inset-bottom, 0);
  }
  .dg-delight-modal {
    background: var(--surface-2);
    border: 1px solid var(--line-strong);
    border-bottom: none;
    border-radius: var(--r-6) var(--r-6) 0 0;
    width: 100%;
    max-width: 560px;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .dg-delight-grab {
    width: 40px;
    height: 4px;
    background: var(--line-strong);
    border-radius: var(--r-full);
    margin: 12px auto 0;
    flex-shrink: 0;
  }
  .dg-delight-head {
    padding: 14px 18px 10px;
    flex-shrink: 0;
    border-bottom: 1px solid var(--line);
  }
  .dg-delight-ttl {
    font: 700 15px/1.2 var(--font-body);
    color: var(--fg);
    letter-spacing: -0.01em;
  }
  .dg-delight-sub {
    font: 400 12px/1.4 var(--font-body);
    color: var(--fg-muted);
    margin-top: 3px;
  }
  .dg-delight-body {
    overflow-y: auto;
    padding: 12px 18px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    flex: 1 1 auto;
    min-height: 0;
  }
  .dg-delight-sect {
    display: flex;
    flex-direction: column;
    gap: 7px;
  }
  .dg-delight-k {
    font: 700 10px/1 var(--font-mono);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--fg-muted);
  }
  .dg-delight-opt {
    color: var(--fg-quiet);
    text-transform: none;
    letter-spacing: 0;
    font-weight: 500;
  }
  .dg-spanpick {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--r-3);
    padding: 10px 12px;
    line-height: 1.7;
    font: 400 13px/1.7 var(--font-body);
    color: var(--fg-2);
    cursor: pointer;
  }
  .dg-spanopt {
    border-radius: var(--r-1);
    padding: 1px 2px;
    transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
    cursor: pointer;
  }
  .dg-spanopt:hover {
    background: var(--amber-soft);
    color: var(--fg);
  }
  .dg-spanopt.is-pick {
    background: var(--amber-soft);
    color: var(--amber);
    outline: 1px solid var(--amber);
    outline-offset: 1px;
  }
  .dg-delight-note {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--r-3);
    color: var(--fg);
    font: 400 13px/1.5 var(--font-body);
    padding: 9px 12px;
    resize: vertical;
    width: 100%;
    box-sizing: border-box;
    transition: border-color var(--dur-fast) var(--ease-out);
  }
  .dg-delight-note:focus {
    outline: none;
    border-color: var(--amber);
  }
  .dg-delight-note:disabled {
    opacity: 0.6;
  }
  .dg-delight-err {
    font: 500 12px/1.4 var(--font-mono);
    color: var(--ember);
    background: var(--ember-soft);
    border: 1px solid var(--ember);
    border-radius: var(--r-2);
    padding: 8px 10px;
  }
  .dg-delight-foot {
    display: flex;
    gap: 8px;
    padding: 12px 18px;
    border-top: 1px solid var(--line);
    flex-shrink: 0;
    background: var(--surface-2);
  }
  .dg-delight-cancel {
    background: var(--surface);
    border: 1px solid var(--line-strong);
    border-radius: var(--r-3);
    color: var(--fg-muted);
    cursor: pointer;
    padding: 9px 16px;
    font: 600 13px/1 var(--font-body);
    flex: 1;
    transition: color var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);
  }
  .dg-delight-cancel:hover:not(:disabled) {
    color: var(--fg);
    border-color: var(--line-strong);
  }
  .dg-delight-cancel:disabled { cursor: default; opacity: 0.5; }
  .dg-delight-save {
    background: var(--amber-soft);
    border: 1px solid var(--amber);
    border-radius: var(--r-3);
    color: var(--amber);
    cursor: pointer;
    padding: 9px 20px;
    font: 700 13px/1 var(--font-body);
    flex: 2;
    transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
  }
  .dg-delight-save:hover:not(:disabled) {
    background: var(--amber);
    color: var(--ink-0);
  }
  .dg-delight-save:disabled { cursor: default; opacity: 0.6; }
</style>
