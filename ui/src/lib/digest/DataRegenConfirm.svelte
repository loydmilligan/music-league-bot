<script lang="ts">
  type Props = {
    sectionLabel: string;
    onCancel: () => void;
    onSubmit: () => void;
    onQueue: () => void;
  };
  let { sectionLabel, onCancel, onSubmit, onQueue }: Props = $props();

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
  aria-label="Recompute section"
  tabindex="-1"
>
  <div class="dg-modal" style="max-width: 420px;">
    <header class="dg-modal-head">
      <h3>Recompute · <span style="color: var(--mash-pulp);">{sectionLabel}</span></h3>
      <button type="button" class="x" onclick={onCancel} aria-label="Close">✕</button>
    </header>
    <div class="dg-modal-body">
      <p class="dg-modal-hint" style="margin: 0;">
        This section is computed from source data, not written by an LLM — there's nothing to
        steer. Recomputing re-reads the latest data (votes, popularity, etc.) and refreshes the
        section in place.
      </p>
    </div>
    <footer class="dg-modal-foot">
      <span class="cost">no LLM cost — data recompute only</span>
      <div style="display: flex; gap: 8px;">
        <button type="button" class="mash-btn mash-btn--ghost mash-btn--sm" onclick={onCancel}>Cancel</button>
        <button type="button" class="mash-btn mash-btn--secondary mash-btn--sm" onclick={onQueue} title="Add to the batch — runs when you press the master regen button">+ Add to batch</button>
        <button type="button" class="mash-btn mash-btn--primary mash-btn--sm" onclick={onSubmit}>↻ Recompute now</button>
      </div>
    </footer>
  </div>
</div>
