<!--
  NextRoundSection — wraps NextRoundPreview with DigestSection-style controls
  (sprint-25 digest-next-round-edit). Provides:
    • Exclude toggle (persists via PATCH /api/digest/:roundId/next-round)
    • Kebab menu: "Edit theme + deadlines" (inline) / "Reset to computed"
    • Inline edit form for theme text + submission/voting deadlines
  Stored overrides win on load; clearing an override reverts to the computed value.
-->
<script lang="ts">
  import NextRoundPreview from './NextRoundPreview.svelte';

  type NextRound = {
    theme?: string | null;
    themeSource?: 'description' | 'name';
    submissionDeadline?: string | null;
    votingDeadline?: string | null;
    deadline?: string | null;
    submissionsSoFar?: number | null;
  };

  const {
    roundId,
    data,
    initialExcluded = false,
    hasOverride = false,
    onExcludedChange,
  } = $props<{
    roundId: number;
    data: NextRound | null;
    initialExcluded?: boolean;
    hasOverride?: boolean;
    onExcludedChange?: (excluded: boolean) => void;
  }>();

  let excluded = $state(initialExcluded);
  let editing = $state(false);
  let saving = $state(false);
  let kebabOpen = $state(false);
  let kebabRef: HTMLDivElement | undefined;

  // Edit field state (initialized when edit opens)
  let editTheme = $state('');
  let editSub = $state('');
  let editVote = $state('');

  // Live data (updated after a successful save)
  let liveData = $state<NextRound | null>(data);
  $effect(() => { liveData = data; });

  function toDatetimeLocal(iso: string | null | undefined): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function openEdit() {
    editTheme = liveData?.theme ?? '';
    editSub = toDatetimeLocal(liveData?.submissionDeadline ?? liveData?.deadline);
    editVote = toDatetimeLocal(liveData?.votingDeadline);
    editing = true;
    kebabOpen = false;
  }

  async function patch(body: Record<string, unknown>) {
    const res = await fetch(`/api/digest/${roundId}/next-round`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`PATCH next-round → ${res.status}`);
  }

  async function saveEdit() {
    saving = true;
    try {
      const sub = editSub ? new Date(editSub).toISOString() : null;
      const vote = editVote ? new Date(editVote).toISOString() : null;
      await patch({
        themeOverride: editTheme.trim() || null,
        submissionDeadlineOverride: sub,
        votingDeadlineOverride: vote,
      });
      // Update local display immediately.
      liveData = {
        ...liveData,
        theme: editTheme.trim() || liveData?.theme,
        submissionDeadline: sub ?? liveData?.submissionDeadline,
        votingDeadline: vote ?? liveData?.votingDeadline,
      };
      editing = false;
    } finally {
      saving = false;
    }
  }

  async function clearOverrides() {
    kebabOpen = false;
    saving = true;
    try {
      await patch({ themeOverride: null, submissionDeadlineOverride: null, votingDeadlineOverride: null });
      // Revert to the original computed data prop.
      liveData = data;
    } finally {
      saving = false;
    }
  }

  async function toggleExcluded() {
    const next = !excluded;
    excluded = next;
    onExcludedChange?.(next);
    await patch({ excluded: next }).catch(() => {
      excluded = !next; // revert on error
      onExcludedChange?.(!next);
    });
  }

  function handleDocClick(e: MouseEvent) {
    if (!kebabOpen) return;
    if (kebabRef && !kebabRef.contains(e.target as Node)) kebabOpen = false;
  }
</script>

<svelte:document onclick={handleDocClick} />

<div
  class="dg-section-wrap"
  class:is-excluded={excluded}
  data-section-kind="nextRound"
>
  {#if excluded}
    <div class="dg-excluded-banner">⊘ excluded from final · Next Round Up</div>
  {/if}

  <div class="dg-section-actions">
    <button
      type="button"
      class="dg-sa-btn"
      onclick={toggleExcluded}
      title={excluded ? 'Include in final' : 'Exclude from final'}
      aria-pressed={!excluded}
    >{excluded ? '+' : '⊘'}</button>

    <span class="dg-sa-divider"></span>

    <div bind:this={kebabRef} style="position: relative;">
      <button
        type="button"
        class="dg-sa-btn"
        onclick={(e) => { e.stopPropagation(); kebabOpen = !kebabOpen; }}
        title="More…"
        aria-haspopup="menu"
        aria-expanded={kebabOpen}
      >⋯</button>
      {#if kebabOpen}
        <div
          class="dg-sa-kebab-pop"
          role="menu"
          tabindex="-1"
          onclick={(e) => e.stopPropagation()}
          onkeydown={(e) => e.key === 'Escape' && (kebabOpen = false)}
        >
          <button type="button" class="dg-sa-kebab-row" role="menuitem" onclick={openEdit}>
            <span class="glyph">✎</span>
            <span>Edit theme + deadlines</span>
          </button>
          {#if hasOverride || liveData !== data}
            <div class="dg-sa-kebab-divider"></div>
            <button type="button" class="dg-sa-kebab-row" role="menuitem" onclick={clearOverrides} disabled={saving}>
              <span class="glyph">↺</span>
              <span>Reset to computed</span>
            </button>
          {/if}
        </div>
      {/if}
    </div>
  </div>

  <section class="dg-section">
    <p class="dg-section-eyebrow">Next Round Up</p>

    {#if editing}
      <form class="nr-edit-form" onsubmit={(e) => { e.preventDefault(); saveEdit(); }}>
        <label class="nr-edit-field">
          <span class="nr-edit-lbl">Theme</span>
          <input
            type="text"
            bind:value={editTheme}
            placeholder="Override theme text (leave blank to use computed)"
            class="nr-edit-input"
          />
        </label>
        <label class="nr-edit-field">
          <span class="nr-edit-lbl">Submission deadline</span>
          <input type="datetime-local" bind:value={editSub} class="nr-edit-input nr-edit-dt" />
        </label>
        <label class="nr-edit-field">
          <span class="nr-edit-lbl">Voting deadline</span>
          <input type="datetime-local" bind:value={editVote} class="nr-edit-input nr-edit-dt" />
        </label>
        <div class="nr-edit-actions">
          <button type="submit" class="nr-edit-btn nr-edit-btn--save" disabled={saving}>
            {saving ? 'Saving…' : 'Save override'}
          </button>
          <button type="button" class="nr-edit-btn nr-edit-btn--cancel" onclick={() => (editing = false)}>
            Cancel
          </button>
        </div>
      </form>
    {:else if liveData}
      <NextRoundPreview kind="nextRound" content={{}} data={liveData} variant="visual" />
    {:else}
      <p class="dg-section-body dg-section-empty">(no next round data)</p>
    {/if}
  </section>
</div>

<style>
  .nr-edit-form {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: 8px;
  }
  .nr-edit-field {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .nr-edit-lbl {
    font: 700 9px/1 var(--font-mono);
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--fg-quiet);
  }
  .nr-edit-input {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--r-2);
    padding: 6px 10px;
    font: 400 13px/1 var(--font-body);
    color: var(--fg);
    outline: none;
    transition: border-color 100ms;
    width: 100%;
  }
  .nr-edit-input:focus {
    border-color: var(--mash-pulp);
  }
  .nr-edit-dt {
    max-width: 260px;
  }
  .nr-edit-actions {
    display: flex;
    gap: 8px;
    margin-top: 4px;
  }
  .nr-edit-btn {
    padding: 5px 14px;
    font: 700 10px/1 var(--font-mono);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    border-radius: var(--r-2);
    border: 1px solid transparent;
    cursor: pointer;
    transition: opacity 100ms;
  }
  .nr-edit-btn:disabled { opacity: 0.5; cursor: default; }
  .nr-edit-btn--save {
    background: var(--mash-pulp-soft);
    border-color: var(--mash-pulp);
    color: var(--mash-pulp);
  }
  .nr-edit-btn--cancel {
    background: transparent;
    border-color: var(--line);
    color: var(--fg-muted);
  }
</style>
