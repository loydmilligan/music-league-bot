<script lang="ts">
  type Props = {
    sectionLabel: string;
    sectionPreview: string;
    initialChips?: string[];
    initialInstructions?: string;
    onCancel: () => void;
    onSubmit: (payload: { chips: string[]; instructions: string }) => void;
  };
  let {
    sectionLabel,
    sectionPreview,
    initialChips = [],
    initialInstructions = '',
    onCancel,
    onSubmit,
  }: Props = $props();

  const REGEN_CHIPS = [
    'be funnier',
    'be less mean',
    'more concise',
    'more dramatic',
    'facts only · less editorial',
  ];

  let activeChips = $state<string[]>([...initialChips]);
  let instructions = $state(initialInstructions);

  function toggleChip(chip: string) {
    activeChips = activeChips.includes(chip)
      ? activeChips.filter((c) => c !== chip)
      : [...activeChips, chip];
  }

  function handleScrim(e: MouseEvent) {
    if (e.target === e.currentTarget) onCancel();
  }

  function handleKey(e: KeyboardEvent) {
    if (e.key === 'Escape') onCancel();
  }

  function submit() {
    onSubmit({ chips: activeChips, instructions });
  }
</script>

<svelte:window onkeydown={handleKey} />

<div
  class="dg-modal-scrim"
  onclick={handleScrim}
  role="dialog"
  aria-modal="true"
  aria-label="Regenerate section"
  tabindex="-1"
>
  <div class="dg-modal">
    <header class="dg-modal-head">
      <h3>Regenerate · <span style="color: var(--mash-pulp);">{sectionLabel}</span></h3>
      <button type="button" class="x" onclick={onCancel} aria-label="Close">✕</button>
    </header>
    <div class="dg-modal-body">
      <span class="dg-modal-eyebrow">Current copy</span>
      <div class="dg-modal-current">{sectionPreview}</div>

      <span class="dg-modal-eyebrow">Quick steers · combinable</span>
      <div class="dg-modal-chips">
        {#each REGEN_CHIPS as chip (chip)}
          <button
            type="button"
            class="dg-modal-chip"
            class:is-on={activeChips.includes(chip)}
            onclick={() => toggleChip(chip)}
          >
            {chip}
          </button>
        {/each}
      </div>

      <span class="dg-modal-eyebrow">Specific instructions · optional</span>
      <textarea
        class="dg-modal-textarea"
        bind:value={instructions}
        placeholder="Anything specific. Focus more on…, keep the Sam quote, drop the theme-chooser angle, lean into the rivalry, etc."
      ></textarea>
      <p class="dg-modal-hint">
        The full source data (votes, comments, chat) is passed alongside your instructions. Cached prior versions of this section stay available.
      </p>
    </div>
    <footer class="dg-modal-foot">
      <span class="cost">~ 280 tokens · ~ 4¢ · cached after this run</span>
      <div style="display: flex; gap: 8px;">
        <button type="button" class="mash-btn mash-btn--ghost mash-btn--sm" onclick={onCancel}>Cancel</button>
        <button type="button" class="mash-btn mash-btn--primary mash-btn--sm" onclick={submit}>↻ Regenerate</button>
      </div>
    </footer>
  </div>
</div>
