<script lang="ts">
  // Non-LLM inline editor (sprint-14 inline-edit-fix). Edits a section's
  // content in place — no LLM call — and emits the rebuilt content object.
  // Generic over content shape: EVERY top-level string field (title, summary,
  // body, …) becomes a text field and EVERY top-level array field (items,
  // moments, …) becomes an editable list. Other types are preserved untouched.
  // This is what lets the chat section ({title, summary, moments[]}) be edited,
  // not just title/body/items.
  //
  // Shapes the generic form can't reach (cast[].exchanges[], phrase.media.poster,
  // …) are edited in YAML mode instead — same onSave, same JSON in the DB.
  import type { DigestKind } from './variants.js';
  import { toYaml, fromYaml, YAML_FIRST_KINDS } from './yamlContent.js';

  type Props = {
    // Every kind the renderer can host, not just the LLM-authored ones —
    // `stats` (which carries the Coinage phrase block) is edited here too.
    kind: DigestKind;
    content: unknown;
    onSave: (content: unknown) => void;
    onCancel: () => void;
  };
  let { kind, content, onSave, onCancel }: Props = $props();

  type Content = Record<string, unknown>;
  // Base object every rebuild starts from, so keys the form can't show survive
  // a save. Replaced when YAML mode hands back a fresh object.
  let src = $state<Content>((content ?? {}) as Content);

  // Items: keep originals so we can preserve non-edited fields/types on save.
  type ItemEntry =
    | { type: 'string'; value: string }
    | { type: 'object'; original: Record<string, unknown>; fields: { key: string; value: string; kind: 'string' | 'number' }[] }
    | { type: 'other'; original: unknown };

  function toEntry(item: unknown): ItemEntry {
    if (typeof item === 'string') return { type: 'string', value: item };
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const o = item as Record<string, unknown>;
      const fields = Object.entries(o)
        .filter(([, v]) => typeof v === 'string' || typeof v === 'number')
        .map(([key, v]) => ({ key, value: String(v), kind: (typeof v === 'number' ? 'number' : 'string') as 'string' | 'number' }));
      return { type: 'object', original: o, fields };
    }
    return { type: 'other', original: item };
  }

  // One ordered list of editable fields — preserves the content's original key
  // order (title before items before body, etc.). `title` stays single-line;
  // every other string field is prose → textarea.
  type Field =
    | { kind: 'string'; key: string; value: string; multiline: boolean }
    | { kind: 'array'; key: string; entries: ItemEntry[] };

  function buildFields(o: Content): Field[] {
    return Object.entries(o).flatMap(([key, v]): Field[] => {
      if (typeof v === 'string') return [{ kind: 'string', key, value: v, multiline: key !== 'title' }];
      if (Array.isArray(v)) return [{ kind: 'array', key, entries: v.map(toEntry) }];
      return [];
    });
  }

  let fields = $state<Field[]>(buildFields(src));

  const hasEditable = $derived(fields.length > 0);

  // --- Fields ⇄ YAML -------------------------------------------------------
  // YAML mode edits the whole content object as text: the only way to reach
  // nested shapes. Sections in YAML_FIRST_KINDS open there.
  let mode = $state<'fields' | 'yaml'>(YAML_FIRST_KINDS.has(kind) ? 'yaml' : 'fields');
  let yamlText = $state(mode === 'yaml' ? toYaml(src) : '');
  const parsed = $derived(mode === 'yaml' ? fromYaml(yamlText) : null);
  const yamlError = $derived(parsed && !parsed.ok ? parsed.error : null);
  const canSave = $derived(mode !== 'yaml' || !yamlError);

  // Half-written YAML held across a toggle. Never re-serialise over it: a
  // syntax error mid-edit must not cost the owner the block he was typing.
  let pendingYaml = $state<string | null>(null);

  function toYamlMode() {
    // Unparsed edits win; otherwise serialise what's on screen now, not the
    // content we were handed.
    yamlText = pendingYaml ?? toYaml(buildFromFields());
    mode = 'yaml';
  }

  function toFieldsMode() {
    // Carry valid YAML edits across; invalid text is parked verbatim and the
    // form keeps showing the last parse that worked.
    if (parsed?.ok) {
      src = parsed.value as Content;
      fields = buildFields(src);
      pendingYaml = null;
    } else {
      pendingYaml = yamlText;
    }
    mode = 'fields';
  }

  function handleYamlKey(e: KeyboardEvent) {
    if (e.key !== 'Tab' || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    const el = e.currentTarget as HTMLTextAreaElement;
    const { selectionStart: start, selectionEnd: end } = el;
    yamlText = yamlText.slice(0, start) + '  ' + yamlText.slice(end);
    // Restore the caret after Svelte writes the new value back.
    requestAnimationFrame(() => el.setSelectionRange(start + 2, start + 2));
  }

  function rebuildItem(entry: ItemEntry): unknown {
    if (entry.type === 'string') return entry.value;
    if (entry.type === 'other') return entry.original;
    // object: start from original, overwrite the editable string/number fields.
    const out: Record<string, unknown> = { ...entry.original };
    for (const f of entry.fields) {
      out[f.key] = f.kind === 'number' ? (f.value.trim() === '' ? null : Number(f.value)) : f.value;
    }
    return out;
  }

  function buildFromFields(): Content {
    // Start from the original so non-editable fields/types survive untouched.
    const out: Content = { ...src };
    for (const f of fields) {
      if (f.kind === 'string') out[f.key] = f.value;
      else out[f.key] = f.entries.map(rebuildItem);
    }
    return out;
  }

  function save() {
    if (mode === 'yaml') {
      if (!parsed?.ok) return;
      onSave(parsed.value);
      return;
    }
    onSave(buildFromFields());
  }

  function handleKey(e: KeyboardEvent) {
    if (e.key === 'Escape') onCancel();
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save();
  }
</script>

<div class="dg-inline-editor" role="form" aria-label="Edit section inline" onkeydown={handleKey}>
  <div class="dg-ie-head">
    <div class="dg-ie-tag">✎ editing inline · no llm · {kind}</div>
    <div class="dg-ie-modes" role="group" aria-label="Edit mode">
      <button
        type="button"
        class="dg-ie-mode"
        class:dg-ie-mode--on={mode === 'fields'}
        aria-pressed={mode === 'fields'}
        onclick={toFieldsMode}>Fields</button
      >
      <button
        type="button"
        class="dg-ie-mode"
        class:dg-ie-mode--on={mode === 'yaml'}
        aria-pressed={mode === 'yaml'}
        onclick={toYamlMode}>YAML</button
      >
    </div>
  </div>

  {#if mode === 'yaml'}
    <label class="dg-ie-field">
      <span class="dg-ie-label">content · yaml</span>
      <textarea
        class="dg-ie-yaml"
        spellcheck="false"
        autocapitalize="off"
        aria-invalid={yamlError ? 'true' : 'false'}
        bind:value={yamlText}
        onkeydown={handleYamlKey}
      ></textarea>
    </label>
    {#if yamlError}
      <p class="dg-ie-yamlerr" role="alert">✗ {yamlError}</p>
    {:else}
      <p class="dg-ie-yamlok">✓ valid yaml</p>
    {/if}
  {:else}

  {#each fields as field (field.key)}
    {#if field.kind === 'string'}
      <label class="dg-ie-field">
        <span class="dg-ie-label">{field.key}</span>
        {#if field.multiline}
          <textarea class="dg-ie-textarea" bind:value={field.value}></textarea>
        {:else}
          <input class="dg-ie-input" bind:value={field.value} />
        {/if}
      </label>
    {:else}
      <div class="dg-ie-items">
        <span class="dg-ie-label">{field.key}</span>
        {#each field.entries as item, i (i)}
          <div class="dg-ie-item">
            {#if item.type === 'string'}
              <input class="dg-ie-input" bind:value={item.value} />
            {:else if item.type === 'object'}
              <div class="dg-ie-objfields">
                {#each item.fields as f (f.key)}
                  <label class="dg-ie-field">
                    <span class="dg-ie-sublabel">{f.key}</span>
                    {#if f.kind === 'number'}
                      <input class="dg-ie-input" type="number" bind:value={f.value} />
                    {:else}
                      <input class="dg-ie-input" bind:value={f.value} />
                    {/if}
                  </label>
                {/each}
              </div>
            {:else}
              <p class="dg-ie-readonly">(non-text item preserved as-is)</p>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  {/each}

    {#if !hasEditable}
      <p class="dg-ie-readonly">This section has no editable text fields. Switch to YAML to edit it.</p>
    {/if}
  {/if}

  <div class="dg-ie-actions">
    <span class="dg-ie-hint">⌘↵ save · esc cancel</span>
    <div style="display: flex; gap: 8px;">
      <button type="button" class="mash-btn mash-btn--ghost mash-btn--sm" onclick={onCancel}>Cancel</button>
      <button type="button" class="mash-btn mash-btn--primary mash-btn--sm" disabled={!canSave} onclick={save}
        >✓ Save edit</button
      >
    </div>
  </div>
</div>

<style>
  .dg-inline-editor {
    margin: 8px 0 0;
    padding: 14px 16px;
    border: 1px solid var(--mash-pulp-edge, var(--line-strong));
    border-radius: var(--r-3);
    background: var(--ink-0);
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .dg-ie-tag {
    font: 700 10px/1 var(--font-mono);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--mash-pulp);
  }
  .dg-ie-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
  }
  .dg-ie-modes {
    display: flex;
    gap: 2px;
    padding: 2px;
    border: 1px solid var(--line-strong);
    border-radius: var(--r-2);
    background: var(--surface);
  }
  .dg-ie-mode {
    border: 0;
    border-radius: calc(var(--r-2) - 2px);
    background: transparent;
    color: var(--fg-muted);
    font: 700 10px/1 var(--font-mono);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    padding: 6px 10px;
    cursor: pointer;
  }
  .dg-ie-mode:hover {
    color: var(--fg);
  }
  .dg-ie-mode--on {
    background: var(--mash-pulp-soft);
    color: var(--mash-pulp);
  }
  .dg-ie-yaml {
    background: var(--surface);
    border: 1px solid var(--line-strong);
    border-radius: var(--r-2);
    color: var(--fg);
    padding: 10px 12px;
    font: 400 13px/1.6 var(--font-mono);
    outline: none;
    width: 100%;
    box-sizing: border-box;
    min-height: 340px;
    resize: vertical;
    white-space: pre;
    overflow-wrap: normal;
    overflow-x: auto;
    tab-size: 2;
  }
  .dg-ie-yaml:focus {
    border-color: var(--mash-pulp);
    box-shadow: 0 0 0 3px var(--mash-pulp-soft);
  }
  .dg-ie-yaml[aria-invalid='true'] {
    border-color: var(--ember);
  }
  .dg-ie-yamlerr,
  .dg-ie-yamlok {
    margin: -4px 0 0;
    font: 500 11px/1.4 var(--font-mono);
  }
  .dg-ie-yamlerr {
    color: var(--ember);
  }
  .dg-ie-yamlok {
    color: var(--fg-quiet);
  }
  .dg-ie-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .dg-ie-label {
    font: 700 10px/1 var(--font-mono);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--fg-muted);
  }
  .dg-ie-sublabel {
    font: 600 10px/1 var(--font-mono);
    color: var(--fg-quiet);
  }
  .dg-ie-input,
  .dg-ie-textarea {
    background: var(--surface);
    border: 1px solid var(--line-strong);
    border-radius: var(--r-2);
    color: var(--fg);
    padding: 8px 10px;
    font: 400 13px/1.5 var(--font-body);
    outline: none;
    width: 100%;
    box-sizing: border-box;
  }
  .dg-ie-textarea {
    resize: vertical;
    min-height: 84px;
  }
  .dg-ie-input:focus,
  .dg-ie-textarea:focus {
    border-color: var(--mash-pulp);
    box-shadow: 0 0 0 3px var(--mash-pulp-soft);
  }
  .dg-ie-items {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .dg-ie-item {
    padding: 8px 10px;
    border: 1px solid var(--line);
    border-radius: var(--r-2);
    background: var(--surface-2);
  }
  .dg-ie-objfields {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .dg-ie-readonly {
    margin: 0;
    font: 400 12px/1.5 var(--font-body);
    font-style: italic;
    color: var(--fg-quiet);
  }
  .dg-ie-actions {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .dg-ie-hint {
    font: 500 11px/1.3 var(--font-mono);
    color: var(--fg-quiet);
  }
</style>
