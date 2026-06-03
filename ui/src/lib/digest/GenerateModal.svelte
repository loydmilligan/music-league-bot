<script lang="ts">
  // Initial-generation modal (sprint-14 generate-modal). Per-section checkbox
  // (default checked) + expandable per-section controls (style words / context /
  // Textual·Visual·Both picker), plus a dedicated paste-WhatsApp-chat box.
  // On submit it posts the **Generation params** contract to POST /draft:
  //   { sections: [{ id, enabled, style, variant, context }], pastedChat }
  // where `id` is the section KIND (backend validates against SECTION_KINDS,
  // honors `enabled`, injects style/context, respects variant, and uses
  // pastedChat as the chat section's source).
  import { SECTION_KINDS, type SectionKind } from './llm.js';
  import {
    VISUAL_CAPABLE,
    VARIANT_ICON,
    VARIANT_LABEL,
    SECTION_VARIANTS,
    DEFAULT_VARIANT,
    type SectionVariant,
  } from './variants.js';

  export type GenSection = {
    id: SectionKind;
    enabled: boolean;
    style: string[];
    variant: SectionVariant;
    context: string;
  };
  export type GenerateParams = { sections: GenSection[]; pastedChat: string };

  type Props = {
    sectionLabels: Record<SectionKind, string>;
    busy?: boolean;
    onCancel: () => void;
    onSubmit: (params: GenerateParams) => void;
  };
  let { sectionLabels, busy = false, onCancel, onSubmit }: Props = $props();

  // Style / focus tags — plain descriptors (replaces the regen modal's
  // "more/less ___" phrasing). Combinable per section.
  const STYLE_TAGS = ['mean', 'nice', 'negative', 'positive', 'concise', 'funny', 'dramatic', 'factual'];

  let sections = $state<GenSection[]>(
    SECTION_KINDS.map((k) => ({
      id: k,
      enabled: true,
      style: [],
      variant: DEFAULT_VARIANT,
      context: '',
    })),
  );
  let pastedChat = $state('');
  let expanded = $state<Record<string, boolean>>({});

  function toggleExpand(id: string) {
    expanded[id] = !expanded[id];
  }
  function toggleStyle(s: GenSection, tag: string) {
    s.style = s.style.includes(tag) ? s.style.filter((t) => t !== tag) : [...s.style, tag];
  }

  const enabledCount = $derived(sections.filter((s) => s.enabled).length);

  function submit() {
    onSubmit({ sections: $state.snapshot(sections), pastedChat });
  }

  function handleScrim(e: MouseEvent) {
    if (e.target === e.currentTarget) onCancel();
  }
  function handleKey(e: KeyboardEvent) {
    if (e.key === 'Escape') onCancel();
  }
</script>

<svelte:window onkeydown={handleKey} />

<div
  class="dg-modal-scrim"
  onclick={handleScrim}
  role="dialog"
  aria-modal="true"
  aria-label="Generate digest"
  tabindex="-1"
>
  <div class="dg-modal dg-genmodal">
    <header class="dg-modal-head">
      <h3>Generate digest · <span style="color: var(--mash-pulp);">{enabledCount}/{sections.length} sections</span></h3>
      <button type="button" class="x" onclick={onCancel} aria-label="Close">✕</button>
    </header>

    <div class="dg-modal-body">
      <span class="dg-modal-eyebrow">Sections · check to include · expand for style / context / layout</span>
      <div class="dg-gen-sections">
        {#each sections as s (s.id)}
          {@const canVisual = VISUAL_CAPABLE[s.id]}
          <div class="dg-gen-row" class:is-off={!s.enabled}>
            <div class="dg-gen-rowhead">
              <label class="dg-gen-check">
                <input type="checkbox" bind:checked={s.enabled} />
                <span class="dg-gen-name">{sectionLabels[s.id] ?? s.id}</span>
              </label>
              <div class="dg-gen-rowmeta">
                {#if s.style.length}<span class="dg-gen-count">{s.style.length} style</span>{/if}
                {#if s.context.trim()}<span class="dg-gen-count">context</span>{/if}
                {#if canVisual && s.variant !== 'textual'}<span class="dg-gen-count">{VARIANT_ICON[s.variant]}</span>{/if}
                <button
                  type="button"
                  class="dg-gen-expand"
                  onclick={() => toggleExpand(s.id)}
                  aria-expanded={!!expanded[s.id]}
                  title="Expand controls"
                >{expanded[s.id] ? '▾' : '▸'}</button>
              </div>
            </div>

            {#if expanded[s.id]}
              <div class="dg-gen-controls">
                <span class="dg-gen-label">style / focus</span>
                <div class="dg-modal-chips">
                  {#each STYLE_TAGS as tag (tag)}
                    <button
                      type="button"
                      class="dg-modal-chip"
                      class:is-on={s.style.includes(tag)}
                      onclick={() => toggleStyle(s, tag)}
                      disabled={!s.enabled}
                    >{tag}</button>
                  {/each}
                </div>

                <span class="dg-gen-label">context · optional</span>
                <textarea
                  class="dg-modal-textarea dg-gen-context"
                  bind:value={s.context}
                  placeholder="Anything this section should know or focus on…"
                  disabled={!s.enabled}
                ></textarea>

                <span class="dg-gen-label">layout</span>
                {#if canVisual}
                  <div class="dg-variant-pick" role="group" aria-label="Layout variant">
                    {#each SECTION_VARIANTS as v (v)}
                      <button
                        type="button"
                        class="dg-vpk-btn"
                        class:is-on={s.variant === v}
                        onclick={() => (s.variant = v)}
                        disabled={!s.enabled}
                      >
                        <span class="dg-vpk-icon">{VARIANT_ICON[v]}</span>
                        <span>{VARIANT_LABEL[v]}</span>
                      </button>
                    {/each}
                  </div>
                {:else}
                  <p class="dg-gen-note">{VARIANT_ICON.textual} textual only — this section has no visual form</p>
                {/if}
              </div>
            {/if}
          </div>
        {/each}
      </div>

      <span class="dg-modal-eyebrow">Paste WhatsApp chat · feeds the back-cover chat section</span>
      <textarea
        class="dg-modal-textarea"
        bind:value={pastedChat}
        placeholder="Paste the round's WhatsApp chat here. Used as the chat section's source (overrides the flaky auto-capture)."
      ></textarea>
      <p class="dg-modal-hint">
        Unchecked sections are skipped. Style words + context steer each section. The full source data (votes, comments) is always passed alongside.
      </p>
    </div>

    <footer class="dg-modal-foot">
      <span class="cost">posts Generation params · regenerates the draft</span>
      <div style="display: flex; gap: 8px;">
        <button type="button" class="mash-btn mash-btn--ghost mash-btn--sm" onclick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" class="mash-btn mash-btn--primary mash-btn--sm" onclick={submit} disabled={busy || enabledCount === 0}>
          {busy ? '… generating' : '✎ Generate'}
        </button>
      </div>
    </footer>
  </div>
</div>

<style>
  .dg-genmodal {
    max-width: 600px;
  }
  .dg-modal-body {
    max-height: min(70vh, 720px);
    overflow: auto;
  }
  .dg-gen-sections {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .dg-gen-row {
    border: 1px solid var(--line);
    border-radius: var(--r-2);
    background: var(--ink-0);
    transition: opacity var(--dur-fast) var(--ease-out);
  }
  .dg-gen-row.is-off {
    opacity: 0.55;
  }
  .dg-gen-rowhead {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 9px 12px;
    gap: 10px;
  }
  .dg-gen-check {
    display: flex;
    align-items: center;
    gap: 9px;
    cursor: pointer;
    flex: 1;
  }
  .dg-gen-check input {
    width: 15px;
    height: 15px;
    accent-color: var(--mash-pulp);
    cursor: pointer;
  }
  .dg-gen-name {
    font: 600 13px/1.2 var(--font-body);
    color: var(--fg);
  }
  .dg-gen-rowmeta {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .dg-gen-count {
    font: 600 10px/1 var(--font-mono);
    letter-spacing: 0.04em;
    color: var(--mash-pulp);
    text-transform: uppercase;
  }
  .dg-gen-expand {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--r-2);
    color: var(--fg-muted);
    cursor: pointer;
    padding: 3px 8px;
    font: 700 11px/1 var(--font-mono);
  }
  .dg-gen-expand:hover { color: var(--fg); }
  .dg-gen-controls {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 4px 12px 12px;
    border-top: 1px solid var(--line);
  }
  .dg-gen-label {
    font: 700 9.5px/1 var(--font-mono);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--fg-muted);
    margin-top: 4px;
  }
  .dg-gen-context {
    min-height: 56px;
  }
  .dg-gen-note {
    margin: 0;
    font: 500 11px/1.4 var(--font-mono);
    color: var(--fg-quiet);
  }
  .dg-variant-pick {
    display: inline-flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .dg-vpk-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 11px;
    border-radius: var(--r-2);
    border: 1px solid var(--line-strong);
    background: var(--surface-2);
    color: var(--fg-2);
    font: 600 11px/1 var(--font-body);
    cursor: pointer;
    transition: all var(--dur-fast) var(--ease-out);
  }
  .dg-vpk-btn:hover:not(:disabled) {
    color: var(--fg);
    border-color: var(--mash-pulp);
  }
  .dg-vpk-btn.is-on {
    background: var(--mash-pulp-soft);
    color: var(--mash-pulp);
    border-color: var(--mash-pulp-edge);
  }
  .dg-vpk-btn:disabled {
    cursor: default;
    opacity: 0.5;
  }
  .dg-vpk-icon {
    font: 700 13px/1 var(--font-mono);
  }
</style>
