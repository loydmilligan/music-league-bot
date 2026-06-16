<script lang="ts">
  // Non-LLM inline editor (sprint-14 inline-edit-fix). Edits a section's
  // content in place — no LLM call — and emits the rebuilt content object.
  // Generic over content shape: EVERY top-level string field (title, summary,
  // body, …) becomes a text field and EVERY top-level array field (items,
  // moments, …) becomes an editable list. Other types are preserved untouched.
  // This is what lets the chat section ({title, summary, moments[]}) be edited,
  // not just title/body/items.
  import type { SectionKind } from './llm.js';

  type Props = {
    kind: SectionKind;
    content: unknown;
    onSave: (content: unknown) => void;
    onCancel: () => void;
  };
  let { kind, content, onSave, onCancel }: Props = $props();

  type Content = Record<string, unknown>;
  const src = (content ?? {}) as Content;

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

  let fields = $state<Field[]>(
    Object.entries(src).flatMap(([key, v]): Field[] => {
      if (typeof v === 'string') return [{ kind: 'string', key, value: v, multiline: key !== 'title' }];
      if (Array.isArray(v)) return [{ kind: 'array', key, entries: v.map(toEntry) }];
      return [];
    }),
  );

  const hasEditable = $derived(fields.length > 0);

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

  function save() {
    // Start from the original so non-editable fields/types survive untouched.
    const out: Content = { ...src };
    for (const f of fields) {
      if (f.kind === 'string') out[f.key] = f.value;
      else out[f.key] = f.entries.map(rebuildItem);
    }
    onSave(out);
  }

  function handleKey(e: KeyboardEvent) {
    if (e.key === 'Escape') onCancel();
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save();
  }
</script>

<div class="dg-inline-editor" role="form" aria-label="Edit section inline" onkeydown={handleKey}>
  <div class="dg-ie-tag">✎ editing inline · no llm · {kind}</div>

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
    <p class="dg-ie-readonly">This section has no editable text fields.</p>
  {/if}

  <div class="dg-ie-actions">
    <span class="dg-ie-hint">⌘↵ save · esc cancel</span>
    <div style="display: flex; gap: 8px;">
      <button type="button" class="mash-btn mash-btn--ghost mash-btn--sm" onclick={onCancel}>Cancel</button>
      <button type="button" class="mash-btn mash-btn--primary mash-btn--sm" onclick={save}>✓ Save edit</button>
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
