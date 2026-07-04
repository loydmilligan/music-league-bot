# Digest Generation/Regen UX Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Homogenize the digest generation/regen UX — fix the modal-positioning bug, reorganize `GenerateModal` so every control lives with its owning section, bring the 3 renderable DATA sections (Stats, Standings, Tastemaker) up to action-bar parity with the 6 LLM prose sections, and add a per-section batch-regen queue with red/green/grey visual state.

**Architecture:** Additive changes to existing Svelte components (`GenerateModal.svelte`, `RegenModal.svelte`, `DigestSection.svelte`, `NextRoundSection.svelte`, `+page.svelte`) plus one new shared component (`DataSectionActions.svelte`) and one new lightweight modal (`DataRegenConfirm.svelte`). No new backend endpoints — Stats/Standings/Tastemaker already have `GET /api/digest/:roundId/{stats,standings,discoverability}` endpoints that recompute fresh values on every call; "regenerate" for those sections means re-fetching and swapping local override state (the same pattern `standingsOverride`/`applyStandings` already use).

**Tech Stack:** SvelteKit 5 (runes: `$state`/`$derived`/`$effect`), TypeScript, Vitest (backend logic only — this codebase has no Svelte component test harness, so UI-only changes are verified via `svelte-check` + manual dev-server smoke testing, matching existing project convention).

## Global Constraints

- Per `CLAUDE.md`: run `npm run check` (svelte-check) as part of every task's verification — it must report 0 errors before committing.
- Per `CLAUDE.md`: commit after each task once verification passes. Do not push.
- Per the spec (`docs/superpowers/specs/2026-07-04-digest-generation-ux-cleanup-design.md`): Sonic Signatures is explicitly OUT OF SCOPE for acceptance-screen action-bar work — it has no render block to attach one to.
- Per the spec: Standings' "✎ edit figures" modal and Next-round's own inline theme/deadline editor are NOT replaced — they keep their bespoke edit UI, only gaining shared lock/visual-state treatment.
- Locked color changes from amber to green (reuses the existing `--moss` token already used elsewhere in `digest.css`, e.g. line 178, 1088-1090). Queued is a new red-family state, visually distinct from the existing `regenerating` shimmer (steady glow vs. animated shimmer).
- `dev` inner-loop convention (`CLAUDE.md`): run the UI dev server (`cd ui && npm run dev -- --host --port 51XX`, pick an unused port) for manual smoke steps; do not leave it running when a task's manual check is done.

---

### Task 1: Fix the `.dg-modal-scrim` viewport-positioning bug

**Files:**
- Modify: `ui/src/lib/digest/digest.css:437-447`

**Interfaces:**
- Produces: nothing new — this is a pure CSS fix consumed implicitly by every modal already using `class="dg-modal-scrim"` (`GenerateModal.svelte`, `RegenModal.svelte`, `RelContextDiffModal.svelte`, `ReconciliationModal.svelte`, `EditableStandingsTable.svelte`).

- [ ] **Step 1: Make the fix**

In `ui/src/lib/digest/digest.css`, change:

```css
.dg-modal-scrim {
  position: absolute;
  inset: 0;
```

to:

```css
.dg-modal-scrim {
  position: fixed;
  inset: 0;
```

- [ ] **Step 2: Verify no ancestor breaks `position: fixed`**

Run:
```bash
grep -rn "transform:" ui/src/routes/digest/\[roundId\]/+page.svelte ui/src/lib/digest/*.svelte
```
Expected: no `transform` rules on any ancestor wrapping where these modals mount (a CSS `transform` on an ancestor would re-scope `position: fixed` to that ancestor instead of the viewport). If any are found, note them — this would need a follow-up fix, but based on current structure none are expected.

- [ ] **Step 3: Manual smoke test**

```bash
cd ui && npm run dev -- --host --port 5180
```
Open `http://localhost:5180/digest/<any-existing-round-id>` in a browser, scroll down the page past the fold, click any section's ↻ (regenerate) button. Confirm the modal appears immediately in the current viewport (not requiring a scroll to the top of the page). Kill the dev server after (`Ctrl+C` or `pkill -f "port 5180"`).

- [ ] **Step 4: Run svelte-check**

```bash
cd ui && npm run check
```
Expected: 0 errors (same warning count as baseline — this change adds no new warnings).

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/digest/digest.css
git commit -m "fix(digest): modal scrim pins to viewport instead of document top

.dg-modal-scrim was position:absolute, which for an unpositioned ancestor
pins to the top of the whole document, not the current viewport — so any
modal opened while scrolled down rendered off-screen above the fold."
```

---

### Task 2: Add the `queued` section state + green lock / red queued styling

**Files:**
- Modify: `ui/src/lib/digest/DigestSection.svelte:17` (type export)
- Modify: `ui/src/lib/digest/digest.css:267-270, 316-336` (lock color + new queued block)

**Interfaces:**
- Produces: `SectionState = 'default' | 'excluded' | 'locked' | 'regenerating' | 'queued'` — every later task that reads/writes `SectionState` uses this 5-value union.
- Produces: CSS classes `.dg-section-wrap.is-queued`, `.dg-queued-banner`, and updated `.dg-sa-btn.is-locked` / `.dg-section-wrap.is-locked` / `.dg-locked-banner` (green, not amber).

- [ ] **Step 1: Widen the `SectionState` type**

In `ui/src/lib/digest/DigestSection.svelte`, change line 17:

```ts
export type SectionState = 'default' | 'excluded' | 'locked' | 'regenerating';
```

to:

```ts
export type SectionState = 'default' | 'excluded' | 'locked' | 'regenerating' | 'queued';
```

- [ ] **Step 2: Recolor locked from amber to green, add queued styling**

In `ui/src/lib/digest/digest.css`, change the locked button color (lines 267-270):

```css
.dg-sa-btn.is-locked {
  background: var(--amber-soft);
  color: var(--amber);
  border-color: #4d3f1c;
}
```

to:

```css
.dg-sa-btn.is-locked {
  background: var(--moss-soft);
  color: var(--moss);
  border-color: var(--moss);
}
```

Change the locked wrapper/banner (lines 316-336):

```css
.dg-section-wrap.is-locked .dg-section {
  outline: 1px dashed var(--amber);
  outline-offset: -1px;
}
.dg-locked-banner {
  position: absolute;
  top: 14px;
  left: 14px;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border-radius: var(--r-2);
  background: var(--amber-soft);
  border: 1px solid #4d3f1c;
  color: var(--amber);
  font: 700 10px/1 var(--font-mono);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
```

to:

```css
.dg-section-wrap.is-locked .dg-section {
  outline: 1px dashed var(--moss);
  outline-offset: -1px;
}
.dg-locked-banner {
  position: absolute;
  top: 14px;
  left: 14px;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border-radius: var(--r-2);
  background: var(--moss-soft);
  border: 1px solid var(--moss);
  color: var(--moss);
  font: 700 10px/1 var(--font-mono);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
```

Immediately after the (now-green) locked block, add a new queued block — a steady red glow, distinct from the animated `is-regenerating` shimmer:

```css
.dg-section-wrap.is-queued .dg-section {
  outline: 1px solid var(--ember);
  outline-offset: -1px;
  box-shadow: 0 0 0 3px rgba(255, 91, 46, 0.12);
}
.dg-queued-banner {
  position: absolute;
  top: 14px;
  left: 14px;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border-radius: var(--r-2);
  background: var(--ember-soft);
  border: 1px solid var(--ember);
  color: var(--ember);
  font: 700 10px/1 var(--font-mono);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
```

- [ ] **Step 3: Wire the `queued` state into `DigestSection.svelte`'s wrap class + banner**

In `ui/src/lib/digest/DigestSection.svelte`, change the `wrapClass` derivation (around line 271-276):

```ts
const wrapClass = $derived(
  'dg-section-wrap' +
    (sectionState === 'excluded' ? ' is-excluded' : '') +
    (sectionState === 'locked' ? ' is-locked' : '') +
    (sectionState === 'regenerating' ? ' is-regenerating' : ''),
);
```

to:

```ts
const wrapClass = $derived(
  'dg-section-wrap' +
    (sectionState === 'excluded' ? ' is-excluded' : '') +
    (sectionState === 'locked' ? ' is-locked' : '') +
    (sectionState === 'regenerating' ? ' is-regenerating' : '') +
    (sectionState === 'queued' ? ' is-queued' : ''),
);
```

And the banner block (around line 403-409):

```svelte
{#if sectionState === 'excluded'}
  <div class="dg-excluded-banner">⊘ excluded from final · {label}</div>
{:else if sectionState === 'locked'}
  <div class="dg-locked-banner">🔒 locked · whole-draft regen will skip</div>
{:else if sectionState === 'regenerating'}
  <div class="dg-regen-banner">regenerating · {label} · ~ 4s</div>
{/if}
```

to:

```svelte
{#if sectionState === 'excluded'}
  <div class="dg-excluded-banner">⊘ excluded from final · {label}</div>
{:else if sectionState === 'locked'}
  <div class="dg-locked-banner">🔒 locked · batch regen will skip</div>
{:else if sectionState === 'queued'}
  <div class="dg-queued-banner">↻ queued for batch regen · {label}</div>
{:else if sectionState === 'regenerating'}
  <div class="dg-regen-banner">regenerating · {label} · ~ 4s</div>
{/if}
```

Also update the ↻ button's `disabled` condition (around line 420-426) to skip queued sections too (they're already queued — clicking again should let you edit the queued entry, not double-queue; Task 4 handles the modal-side logic, this just keeps the button clickable for `queued` so the user can re-open and change/remove it):

```svelte
<button
  type="button"
  class="dg-sa-btn"
  onclick={onRegen}
  title="Regenerate this section…"
  disabled={sectionState === 'regenerating' || sectionState === 'excluded'}
>↻</button>
```
(no change needed here — `queued` was never in the disabled list, so it already stays clickable; confirming via read, not editing.)

- [ ] **Step 4: Run svelte-check**

```bash
cd ui && npm run check
```
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/digest/DigestSection.svelte ui/src/lib/digest/digest.css
git commit -m "feat(digest): add queued section state, recolor locked green

Locked sections now glow green (was amber) to sit apart from the new
queued-red and existing excluded-grey states. Queued is a steady red glow,
distinct from the animated regenerating shimmer."
```

---

### Task 3: GenerateModal reorganization — move orphaned controls into their owning sections

**Files:**
- Modify: `ui/src/lib/digest/GenerateModal.svelte`

**Interfaces:**
- Consumes: nothing new — `GenerateParams` shape (lines 38-48) is unchanged; this task is a pure template reorg, no data-contract changes.
- Produces: nothing new for later tasks — this task is self-contained UI cleanup.

- [ ] **Step 1: Move "Season recap" from a bordered top card into a plain section list-item**

Replace the recap block (lines 176-203):

```svelte
<!-- Season-recap mode (sprint-21) — re-renders every section at season scope. -->
<div class="dg-recap" class:is-on={recapEnabled}>
  <div class="dg-recap-head">
    <label class="dg-recap-check">
      <input type="checkbox" bind:checked={recapEnabled} />
      <span class="dg-recap-name">Season recap</span>
    </label>
    {#if recapEnabled}
      <span class="dg-recap-badge">{recapBadge}</span>
    {/if}
  </div>
  {#if recapEnabled}
    <div class="dg-recap-sub">
      <label class="dg-recap-final" title="Final = definitive full-season framing; off = mid-season ‘so far’">
        <input type="checkbox" bind:checked={recapFinal} />
        <span>Final recap</span>
      </label>
      <span class="dg-recap-hint">
        {recapFinal
          ? 'Definitive full-season framing — champion, past tense.'
          : 'Mid-season framing — “the season so far”, current leader.'}
      </span>
    </div>
    <p class="dg-recap-note">
      Re-renders every section across the whole season (rounds up to this one). Next-round preview is
      dropped; chat uses the paste box below.
    </p>
  {/if}
</div>

<span class="dg-modal-eyebrow">Sections · check to include · expand for style / context / layout</span>
<div class="dg-gen-sections">
```

with (recap becomes a `dg-gen-row` matching every other section's shell, keeping its own sub-controls when expanded):

```svelte
<span class="dg-modal-eyebrow">Sections · check to include · expand for style / context / layout</span>
<div class="dg-gen-sections">
  <!-- Season recap — re-renders every section at season scope. Same row shell as
       every other section; its own sub-controls (final toggle, note) live inline. -->
  <div class="dg-gen-row" class:is-off={!recapEnabled}>
    <div class="dg-gen-rowhead">
      <label class="dg-gen-check">
        <input type="checkbox" bind:checked={recapEnabled} />
        <span class="dg-gen-name">Season recap</span>
      </label>
      {#if recapEnabled}
        <span class="dg-recap-badge">{recapBadge}</span>
      {/if}
    </div>
    {#if recapEnabled}
      <div class="dg-gen-controls">
        <label class="dg-recap-final" title="Final = definitive full-season framing; off = mid-season ‘so far’">
          <input type="checkbox" bind:checked={recapFinal} />
          <span>Final recap</span>
        </label>
        <span class="dg-recap-hint">
          {recapFinal
            ? 'Definitive full-season framing — champion, past tense.'
            : 'Mid-season framing — “the season so far”, current leader.'}
        </span>
        <p class="dg-recap-note">
          Re-renders every section across the whole season (rounds up to this one). Next-round
          preview is dropped; chat uses its paste box below.
        </p>
      </div>
    {/if}
  </div>
```

- [ ] **Step 2: Move the paste-chat textarea into the `chat` section's own row**

Find the per-section `{#each sections as s (s.id)}` loop (line 207 in the original, now directly after the recap row from Step 1) and its expanded-controls block (originally lines 229-272):

```svelte
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
```

Add a paste-chat block right after the layout block, gated on `s.id === 'chat'`:

```svelte
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

    {#if s.id === 'chat'}
      <span class="dg-gen-label">paste whatsapp chat · optional</span>
      <textarea
        class="dg-modal-textarea dg-gen-context"
        bind:value={pastedChat}
        placeholder="Paste the round's WhatsApp chat here. Used as this section's source (overrides the flaky auto-capture)."
        disabled={!s.enabled}
      ></textarea>
    {/if}
  </div>
{/if}
```

- [ ] **Step 3: Move "Regenerate themed avatars" checkbox into the Standings section's row**

Find the Standings block (originally lines 294-317):

```svelte
<!-- Standings: a DATA section (computed from votes, not LLM prose). -->
<div class="dg-gen-row dg-gen-row--data" class:is-off={!standingsInclude}>
  <div class="dg-gen-rowhead">
    <label class="dg-gen-check">
      <input type="checkbox" bind:checked={standingsInclude} />
      <span class="dg-gen-name">Season standings</span>
      <span class="dg-gen-databadge">data</span>
      {#if standingsAvailability === 'ready'}
        <span class="dg-gen-cov dg-gen-cov--ok" title="Vote data is present — the chart will render">● coverage ready</span>
      {:else}
        <span class="dg-gen-cov dg-gen-cov--warn" title="No computable standings yet — the section self-suppresses">⚠ incomplete coverage</span>
      {/if}
    </label>
    <label class="dg-gen-recompute" title="Recompute standings from votes and adopt as the new gospel">
      <input type="checkbox" bind:checked={standingsRecompute} disabled={!standingsInclude} />
      <span>recompute from votes</span>
    </label>
  </div>
  <p class="dg-gen-note">
    Computed from votes, not written by the LLM — auto-reconciled against the stored table on
    generate (a mismatch pops the reconcile modal). “Recompute” overwrites the gospel with the
    fresh computed values.
  </p>
</div>
```

Add the avatar checkbox inside it, after the note paragraph:

```svelte
<!-- Standings: a DATA section (computed from votes, not LLM prose). -->
<div class="dg-gen-row dg-gen-row--data" class:is-off={!standingsInclude}>
  <div class="dg-gen-rowhead">
    <label class="dg-gen-check">
      <input type="checkbox" bind:checked={standingsInclude} />
      <span class="dg-gen-name">Season standings</span>
      <span class="dg-gen-databadge">data</span>
      {#if standingsAvailability === 'ready'}
        <span class="dg-gen-cov dg-gen-cov--ok" title="Vote data is present — the chart will render">● coverage ready</span>
      {:else}
        <span class="dg-gen-cov dg-gen-cov--warn" title="No computable standings yet — the section self-suppresses">⚠ incomplete coverage</span>
      {/if}
    </label>
    <label class="dg-gen-recompute" title="Recompute standings from votes and adopt as the new gospel">
      <input type="checkbox" bind:checked={standingsRecompute} disabled={!standingsInclude} />
      <span>recompute from votes</span>
    </label>
  </div>
  <p class="dg-gen-note">
    Computed from votes, not written by the LLM — auto-reconciled against the stored table on
    generate (a mismatch pops the reconcile modal). “Recompute” overwrites the gospel with the
    fresh computed values.
  </p>
  <label class="dg-av-regen" style="padding: 0 12px 10px;">
    <input type="checkbox" bind:checked={regenAvatars} />
    <span>Regenerate themed avatars for this round · avatars render here, in Standings</span>
  </label>
</div>
```

- [ ] **Step 4: Remove the now-empty bottom misc area**

Delete the old bottom block (originally lines 377-386, right after the DATA sections' closing `</div>` for `.dg-gen-sections`):

```svelte
<span class="dg-modal-eyebrow">Paste WhatsApp chat · feeds the back-cover chat section</span>
<textarea
  class="dg-modal-textarea"
  bind:value={pastedChat}
  placeholder="Paste the round's WhatsApp chat here. Used as the chat section's source (overrides the flaky auto-capture)."
></textarea>
<label class="dg-av-regen">
  <input type="checkbox" bind:checked={regenAvatars} />
  <span>Regenerate themed avatars for this round</span>
</label>
```

Leave the closing hint paragraph (`<p class="dg-modal-hint">...`) in place, directly after `</div>` (the closing tag of `.dg-gen-sections`).

- [ ] **Step 5: Run svelte-check**

```bash
cd ui && npm run check
```
Expected: 0 errors. (`pastedChat` and `regenAvatars` are still declared and still read in `submit()` — only their markup location moved, so no unused-variable warnings should appear.)

- [ ] **Step 6: Manual smoke test**

```bash
cd ui && npm run dev -- --host --port 5180
```
Open the digest page for any round, click "✎ Regenerate with options…" (or "Generate draft…" if in prepare stage) to open `GenerateModal`. Confirm:
- "Season recap" now renders as a plain row identical in style to Podium/Villain/etc, at the top of the list.
- Expanding the "Chat" section reveals a "paste whatsapp chat" textarea at the bottom of its expanded controls.
- The "Season standings" row now has the "Regenerate themed avatars" checkbox inside it, below its note paragraph.
- No controls remain between the section list and the footer buttons except the static hint paragraph.

Kill the dev server after.

- [ ] **Step 7: Commit**

```bash
git add ui/src/lib/digest/GenerateModal.svelte
git commit -m "refactor(digest): move orphaned GenerateModal controls into their sections

Season recap becomes a plain section row instead of a special top card.
Paste-chat textarea moves into the Chat section (it only ever feeds that
section). Avatar-regen checkbox moves into Standings (avatars render in
StandingsChart, not Tastemaker). No control remains in a bottom misc area."
```

---

### Task 4: RegenModal batch-queue support + wiring into `+page.svelte`

**Files:**
- Modify: `ui/src/lib/digest/RegenModal.svelte`
- Modify: `ui/src/routes/digest/[roundId]/+page.svelte`

**Interfaces:**
- Consumes: `SectionState` (now includes `'queued'`, from Task 2).
- Produces: `RegenModal`'s new `onQueue: (payload: { chips: string[]; instructions: string }) => void` prop (alongside existing `onSubmit`); `queueProse(sectionId, chips, instructions)`, `dequeueProse(sectionId)`, `runBatch()`, `queuedCount: number` (derived) on the page. Task 7 extends `runBatch` to also cover queued DATA sections; Task 8 does not touch this file's queue model (NextRound doesn't participate, per spec).

- [ ] **Step 1: Add the `onQueue` prop to RegenModal**

In `ui/src/lib/digest/RegenModal.svelte`, change the `Props` type (lines 2-9):

```ts
type Props = {
  sectionLabel: string;
  sectionPreview: string;
  initialChips?: string[];
  initialInstructions?: string;
  onCancel: () => void;
  onSubmit: (payload: { chips: string[]; instructions: string }) => void;
};
```

to:

```ts
type Props = {
  sectionLabel: string;
  sectionPreview: string;
  initialChips?: string[];
  initialInstructions?: string;
  onCancel: () => void;
  onSubmit: (payload: { chips: string[]; instructions: string }) => void;
  onQueue: (payload: { chips: string[]; instructions: string }) => void;
};
```

And destructure it (line 10-17):

```ts
let {
  sectionLabel,
  sectionPreview,
  initialChips = [],
  initialInstructions = '',
  onCancel,
  onSubmit,
}: Props = $props();
```

to:

```ts
let {
  sectionLabel,
  sectionPreview,
  initialChips = [],
  initialInstructions = '',
  onCancel,
  onSubmit,
  onQueue,
}: Props = $props();
```

- [ ] **Step 2: Add a `queue()` handler alongside `submit()`**

Change (lines 44-46):

```ts
function submit() {
  onSubmit({ chips: activeChips, instructions });
}
```

to:

```ts
function submit() {
  onSubmit({ chips: activeChips, instructions });
}
function queue() {
  onQueue({ chips: activeChips, instructions });
}
```

- [ ] **Step 3: Add the second footer button**

Change the footer (lines 92-98):

```svelte
<footer class="dg-modal-foot">
  <span class="cost">~ 280 tokens · ~ 4¢ · cached after this run</span>
  <div style="display: flex; gap: 8px;">
    <button type="button" class="mash-btn mash-btn--ghost mash-btn--sm" onclick={onCancel}>Cancel</button>
    <button type="button" class="mash-btn mash-btn--primary mash-btn--sm" onclick={submit}>↻ Regenerate</button>
  </div>
</footer>
```

to:

```svelte
<footer class="dg-modal-foot">
  <span class="cost">~ 280 tokens · ~ 4¢ · cached after this run</span>
  <div style="display: flex; gap: 8px;">
    <button type="button" class="mash-btn mash-btn--ghost mash-btn--sm" onclick={onCancel}>Cancel</button>
    <button type="button" class="mash-btn mash-btn--secondary mash-btn--sm" onclick={queue} title="Add to the batch — runs when you press the master regen button">+ Add to batch</button>
    <button type="button" class="mash-btn mash-btn--primary mash-btn--sm" onclick={submit}>↻ Regenerate now</button>
  </div>
</footer>
```

- [ ] **Step 4: Add a prose-section queue map in `+page.svelte`**

Change (lines 514-515):

```ts
let lastInstructions = $state<Record<string, string>>({});
let lastChips = $state<Record<string, string[]>>({});
```

to:

```ts
let lastInstructions = $state<Record<string, string>>({});
let lastChips = $state<Record<string, string[]>>({});

// Batch-regen queue (prose sections only in this task; Task 7 adds DATA
// sections to the same execution path via a separate small map).
let queuedProse = $state<Record<string, { chips: string[]; instructions: string }>>({});
function queueProse(id: string, chips: string[], instructions: string) {
  queuedProse[id] = { chips, instructions };
  sectionStates[id] = 'queued';
}
function dequeueProse(id: string) {
  delete queuedProse[id];
  if (sectionStates[id] === 'queued') sectionStates[id] = 'default';
}
```

- [ ] **Step 5: Wire RegenModal's new `onQueue` prop on the page**

Find the `<RegenModal>` mount (around lines 1364-1373):

```svelte
{#if modalTarget !== null}
  <RegenModal
    sectionLabel={modalLabel}
    sectionPreview={modalPreview}
    initialChips={modalInitialChips}
    initialInstructions={modalInitialInstructions}
    onCancel={closeModal}
    onSubmit={submitRegen}
  />
{/if}
```

Add the `onQueue` handler. It's a no-op for `modalTarget === 'whole'` (batch-queuing "the whole draft" isn't a meaningful concept — "whole" already means "everything unlocked"):

```svelte
{#if modalTarget !== null}
  <RegenModal
    sectionLabel={modalLabel}
    sectionPreview={modalPreview}
    initialChips={modalInitialChips}
    initialInstructions={modalInitialInstructions}
    onCancel={closeModal}
    onSubmit={submitRegen}
    onQueue={(payload) => {
      const target = modalTarget;
      closeModal();
      if (target && target !== 'whole') queueProse(target, payload.chips, payload.instructions);
    }}
  />
{/if}
```

- [ ] **Step 6: Add `runBatch()` and a `queuedCount` derived value**

Add after `submitRegen` (after line 831, right before the "Missing-popularity panel" comment):

```ts
const queuedCount = $derived(Object.keys(queuedProse).length);

async function runBatch() {
  const ids = Object.keys(queuedProse);
  if (!ids.length) return;

  for (const id of ids) {
    lastChips[id] = queuedProse[id].chips;
    lastInstructions[id] = queuedProse[id].instructions;
    sectionStates[id] = 'regenerating';
  }

  await Promise.all(
    ids.map(async (id) => {
      try {
        const res = await fetch(`/api/digest/${data.roundId}/sections/${id}/regenerate`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(queuedProse[id]),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(`regen failed (${res.status}) ${text.slice(0, 200)}`);
        }
        delete queuedProse[id];
      } catch (err) {
        showError(err);
        sectionStates[id] = 'default';
      }
    }),
  );

  await invalidateAll();
}
```

- [ ] **Step 7: Relabel and glow the master button**

Find the master regen button (around line 1143):

```svelte
<button type="button" class="mash-btn mash-btn--secondary" onclick={openWholeRegen} disabled={finalizing}>
  ↻ Regenerate whole draft
</button>
```

Change to:

```svelte
<button
  type="button"
  class="mash-btn mash-btn--secondary"
  class:dg-regen-all--queued={queuedCount > 0}
  onclick={queuedCount > 0 ? runBatch : openWholeRegen}
  disabled={finalizing}
>
  {queuedCount > 0 ? `↻ Regenerate ${queuedCount} queued` : '↻ Regenerate whole draft'}
</button>
```

- [ ] **Step 8: Add the glow style for the master button**

Add to `ui/src/lib/digest/digest.css`, near the other `dg-page-actions`-adjacent rules (search `grep -n "dg-page-actions" ui/src/lib/digest/digest.css` to find the right neighborhood):

```css
.dg-regen-all--queued {
  border-color: var(--ember) !important;
  color: var(--ember) !important;
  box-shadow: 0 0 0 3px rgba(255, 91, 46, 0.12);
}
```

- [ ] **Step 9: Run svelte-check**

```bash
cd ui && npm run check
```
Expected: 0 errors.

- [ ] **Step 10: Manual smoke test**

```bash
cd ui && npm run dev -- --host --port 5180
```
On a digest page in refine/finalize stage: click ↻ on any prose section (podium/villain/flow/consensus/quotes/chat), then "+ Add to batch" in the modal. Confirm:
- The section shows the red "↻ queued for batch regen" banner and red-glow outline.
- The master button at the top relabels to "↻ Regenerate 1 queued" and glows red.
- Queue a second section, confirm the count updates to 2.
- Click the master button — confirm both sections show the regenerating shimmer, then settle back to default with fresh content after the page reloads its data.

Kill the dev server after.

- [ ] **Step 11: Commit**

```bash
git add ui/src/lib/digest/RegenModal.svelte ui/src/routes/digest/\[roundId\]/+page.svelte ui/src/lib/digest/digest.css
git commit -m "feat(digest): per-section batch regen queue for prose sections

RegenModal gains 'Add to batch' alongside 'Regenerate now'. Queuing a
section shows a red glow + queued banner instead of firing immediately.
The master button relabels to 'Regenerate N queued' and glows red once
anything's queued; pressing it runs every queued section's regen in
parallel. With nothing queued it behaves exactly as before —
'Regenerate whole draft' fires every unlocked, non-excluded section
immediately."
```

---

### Task 5: New `DataRegenConfirm.svelte` — minimal regen choice for non-LLM DATA sections

**Files:**
- Create: `ui/src/lib/digest/DataRegenConfirm.svelte`

**Interfaces:**
- Consumes: `.dg-modal-scrim` / `.dg-modal` / `.dg-modal-head` / `.dg-modal-foot` CSS classes (already defined in `digest.css`, fixed in Task 1).
- Produces: a component with props `{ sectionLabel: string; onCancel: () => void; onSubmit: () => void; onQueue: () => void }` — Task 7 mounts this for Stats/Standings/Tastemaker instead of the full `RegenModal` (which has chips/instructions that make no sense for a data recompute).

- [ ] **Step 1: Write the component**

```svelte
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
```

- [ ] **Step 2: Run svelte-check**

```bash
cd ui && npm run check
```
Expected: 0 errors (this component isn't mounted anywhere yet, so it can't cause call-site errors — it will only be exercised once Task 7 imports it).

- [ ] **Step 3: Commit**

```bash
git add ui/src/lib/digest/DataRegenConfirm.svelte
git commit -m "feat(digest): add DataRegenConfirm — minimal regen modal for DATA sections

Stats/Standings/Tastemaker are computed from source data, not LLM prose,
so the full RegenModal (current-copy preview, quick-steer chips, freeform
instructions) doesn't fit. This is a 2-button confirm: recompute now or
add to the same batch queue prose sections use."
```

---

### Task 6: New `DataSectionActions.svelte` — shared exclude/lock/regen bar for DATA sections

**Files:**
- Create: `ui/src/lib/digest/DataSectionActions.svelte`

**Interfaces:**
- Produces: a component with props `{ excluded: boolean; state: 'default' | 'locked' | 'queued' | 'regenerating'; onToggleExcluded: () => void; onToggleLocked: () => void; onRegen: () => void }` — renders the same 3-button visual language as `DigestSection.svelte`'s action bar (exclude/regen/lock only — no delight, no variant switch, no kebab, since none of those apply to a DATA section). Task 7 mounts one per DATA section block in `+page.svelte`.

- [ ] **Step 1: Write the component**

```svelte
<script lang="ts">
  type Props = {
    excluded: boolean;
    state: 'default' | 'locked' | 'queued' | 'regenerating';
    onToggleExcluded: () => void;
    onToggleLocked: () => void;
    onRegen: () => void;
  };
  let { excluded, state, onToggleExcluded, onToggleLocked, onRegen }: Props = $props();
</script>

<div class="dg-section-actions">
  <button
    type="button"
    class="dg-sa-btn"
    onclick={onToggleExcluded}
    title={excluded ? 'Include in final' : 'Exclude from final'}
    aria-pressed={!excluded}
    disabled={state === 'regenerating'}
  >{excluded ? '+' : '⊘'}</button>
  <button
    type="button"
    class="dg-sa-btn"
    onclick={onRegen}
    title="Recompute this section…"
    disabled={state === 'regenerating' || excluded}
  >↻</button>
  <button
    type="button"
    class="dg-sa-btn"
    class:is-locked={state === 'locked'}
    onclick={onToggleLocked}
    title={state === 'locked' ? 'Unlock · allow batch regen' : 'Lock · pin this version'}
    aria-pressed={state === 'locked'}
    disabled={state === 'regenerating'}
  >{state === 'locked' ? '🔒' : '🔓'}</button>
</div>
```

- [ ] **Step 2: Run svelte-check**

```bash
cd ui && npm run check
```
Expected: 0 errors (unmounted so far).

- [ ] **Step 3: Commit**

```bash
git add ui/src/lib/digest/DataSectionActions.svelte
git commit -m "feat(digest): add DataSectionActions — shared exclude/lock/regen bar

Mirrors DigestSection's action-bar visual language (same dg-sa-btn/
dg-section-actions classes) but only the 3 buttons that apply to a
computed DATA section — no delight, variant switch, or kebab."
```

---

### Task 7: Wire Stats, Standings, and Tastemaker into the shared action bar + batch queue

**Files:**
- Modify: `ui/src/routes/digest/[roundId]/+page.svelte`

**Interfaces:**
- Consumes: `DataSectionActions` (Task 6), `DataRegenConfirm` (Task 5), `SectionState` (Task 2).
- Produces: `dataSectionRunState: Record<'stats'|'standings'|'discoverability', 'default'|'locked'|'queued'|'regenerating'>`, `queuedData: Record<'stats'|'standings'|'discoverability', true>` — Task 4's `runBatch()` is extended here to also execute these.

- [ ] **Step 1: Add overrides for Stats and Tastemaker (mirroring the existing `standingsOverride` pattern)**

Change (around lines 651-664):

```ts
const statsData = $derived(inDigest ? data.stats : null);
let statsExcluded = $state(false);
const statsAvailable = $derived(!!statsData && Object.values(statsData).some((v) => typeof v === 'number'));
const showStats = $derived(!statsExcluded && statsAvailable);

const discoverabilityData = $derived(inDigest ? data.discoverability : null);
// v2 payload is a TastemakerPayload object (`.players`), not the v1 row array.
// The backend self-suppresses to null on absent/partial (<80%) coverage, so a
// non-null payload with players = "coverage ready". `discoverabilityExcluded`
// is the GenerateModal include toggle (session-scoped — web view).
let discoverabilityExcluded = $state(false);
const tastemakerAvailable = $derived((discoverabilityData?.players?.length ?? 0) > 0);
const showDiscoverability = $derived(!discoverabilityExcluded && tastemakerAvailable);
const tastemakerCoverage = $derived<'ready' | 'incomplete'>(tastemakerAvailable ? 'ready' : 'incomplete');
```

to:

```ts
let statsOverride = $state<typeof data.stats>(null);
const statsData = $derived(statsOverride ?? (inDigest ? data.stats : null));
let statsExcluded = $state(false);
const statsAvailable = $derived(!!statsData && Object.values(statsData).some((v) => typeof v === 'number'));
const showStats = $derived(!statsExcluded && statsAvailable);

let discoverabilityOverride = $state<typeof data.discoverability>(null);
const discoverabilityData = $derived(discoverabilityOverride ?? (inDigest ? data.discoverability : null));
// v2 payload is a TastemakerPayload object (`.players`), not the v1 row array.
// The backend self-suppresses to null on absent/partial (<80%) coverage, so a
// non-null payload with players = "coverage ready". `discoverabilityExcluded`
// is the GenerateModal include toggle (session-scoped — web view).
let discoverabilityExcluded = $state(false);
const tastemakerAvailable = $derived((discoverabilityData?.players?.length ?? 0) > 0);
const showDiscoverability = $derived(!discoverabilityExcluded && tastemakerAvailable);
const tastemakerCoverage = $derived<'ready' | 'incomplete'>(tastemakerAvailable ? 'ready' : 'incomplete');
```

- [ ] **Step 2: Add the DATA-section run-state map, regen-confirm modal target, and recompute functions**

Add after the `runBatch()` function from Task 4:

```ts
type DataSectionKey = 'stats' | 'standings' | 'discoverability';
let dataSectionRunState = $state<Record<DataSectionKey, 'default' | 'locked' | 'queued' | 'regenerating'>>({
  stats: 'default',
  standings: 'default',
  discoverability: 'default',
});
const DATA_SECTION_LABEL: Record<DataSectionKey, string> = {
  stats: 'By the numbers',
  standings: 'Season standings',
  discoverability: 'Tastemaker',
};

function dataSectionExcluded(key: DataSectionKey): boolean {
  if (key === 'stats') return statsExcluded;
  if (key === 'standings') return standingsExcluded;
  return discoverabilityExcluded;
}
function toggleDataExcluded(key: DataSectionKey) {
  if (key === 'stats') statsExcluded = !statsExcluded;
  else if (key === 'standings') standingsExcluded = !standingsExcluded;
  else discoverabilityExcluded = !discoverabilityExcluded;
}
function toggleDataLocked(key: DataSectionKey) {
  dataSectionRunState[key] = dataSectionRunState[key] === 'locked' ? 'default' : 'locked';
}

async function recomputeDataSection(key: DataSectionKey) {
  dataSectionRunState[key] = 'regenerating';
  try {
    if (key === 'stats') {
      const res = await fetch(`/api/digest/${data.roundId}/stats`);
      if (!res.ok) throw new Error(`stats recompute failed (${res.status})`);
      const body = (await res.json()) as { stats: typeof data.stats };
      statsOverride = body.stats;
    } else if (key === 'standings') {
      const res = await fetch(`/api/digest/${data.roundId}/standings`);
      if (!res.ok) throw new Error(`standings recompute failed (${res.status})`);
      const body = (await res.json()) as StandingsResult;
      standingsOverride = body;
    } else {
      const res = await fetch(`/api/digest/${data.roundId}/discoverability`);
      if (!res.ok) throw new Error(`tastemaker recompute failed (${res.status})`);
      const body = (await res.json()) as { discoverability: typeof data.discoverability };
      discoverabilityOverride = body.discoverability;
    }
  } catch (err) {
    showError(err);
  } finally {
    dataSectionRunState[key] = dataSectionRunState[key] === 'regenerating' ? 'default' : dataSectionRunState[key];
  }
}

// Regen-confirm modal target for DATA sections (separate from prose modalTarget
// since it mounts DataRegenConfirm, not RegenModal).
let dataModalTarget = $state<DataSectionKey | null>(null);
function openDataRegen(key: DataSectionKey) { dataModalTarget = key; }
function closeDataModal() { dataModalTarget = null; }

let queuedData = $state<Partial<Record<DataSectionKey, true>>>({});
function queueData(key: DataSectionKey) {
  queuedData[key] = true;
  dataSectionRunState[key] = 'queued';
  closeDataModal();
}

const queuedCount = $derived(Object.keys(queuedProse).length + Object.keys(queuedData).length);
```

(Note: this replaces the `queuedCount` derived value added in Task 4, Step 6 — remove the earlier `const queuedCount = $derived(Object.keys(queuedProse).length);` line since this one supersedes it with the combined prose+data count.)

- [ ] **Step 3: Extend `runBatch()` to also run queued DATA sections**

Change the `runBatch` function from Task 4 (append DATA handling at the end, before the final `await invalidateAll();`):

```ts
async function runBatch() {
  const ids = Object.keys(queuedProse);
  const dataKeys = Object.keys(queuedData) as DataSectionKey[];
  if (!ids.length && !dataKeys.length) return;

  for (const id of ids) {
    lastChips[id] = queuedProse[id].chips;
    lastInstructions[id] = queuedProse[id].instructions;
    sectionStates[id] = 'regenerating';
  }
  for (const key of dataKeys) dataSectionRunState[key] = 'regenerating';

  await Promise.all([
    ...ids.map(async (id) => {
      try {
        const res = await fetch(`/api/digest/${data.roundId}/sections/${id}/regenerate`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(queuedProse[id]),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(`regen failed (${res.status}) ${text.slice(0, 200)}`);
        }
        delete queuedProse[id];
      } catch (err) {
        showError(err);
        sectionStates[id] = 'default';
      }
    }),
    ...dataKeys.map(async (key) => {
      await recomputeDataSection(key);
      delete queuedData[key];
    }),
  ]);

  await invalidateAll();
}
```

- [ ] **Step 4: Mount `DataSectionActions` on the Stats, Standings, and Tastemaker blocks**

Add the import near the top of `<script>` (alongside the other digest component imports):

```ts
import DataSectionActions from '$lib/digest/DataSectionActions.svelte';
import DataRegenConfirm from '$lib/digest/DataRegenConfirm.svelte';
```

Change the Stats block (around lines 1241-1248):

```svelte
{#if showStats && StatSlot}
  <div class="dg-section-wrap" data-section-kind="stats">
    <section class="dg-section">
      <p class="dg-section-eyebrow">{recap ? 'By the numbers · season' : 'By the numbers'}</p>
      <StatSlot kind="stats" content={{}} data={statsData} variant="visual" />
    </section>
  </div>
{/if}
```

to:

```svelte
{#if showStats && StatSlot}
  <div class="dg-section-wrap" class:is-locked={dataSectionRunState.stats === 'locked'} class:is-queued={dataSectionRunState.stats === 'queued'} class:is-regenerating={dataSectionRunState.stats === 'regenerating'} data-section-kind="stats">
    {#if dataSectionRunState.stats === 'locked'}
      <div class="dg-locked-banner">🔒 locked · batch regen will skip</div>
    {:else if dataSectionRunState.stats === 'queued'}
      <div class="dg-queued-banner">↻ queued for batch regen · By the numbers</div>
    {:else if dataSectionRunState.stats === 'regenerating'}
      <div class="dg-regen-banner">regenerating · By the numbers · ~ 1s</div>
    {/if}
    <DataSectionActions
      excluded={dataSectionExcluded('stats')}
      state={dataSectionRunState.stats}
      onToggleExcluded={() => toggleDataExcluded('stats')}
      onToggleLocked={() => toggleDataLocked('stats')}
      onRegen={() => openDataRegen('stats')}
    />
    <section class="dg-section">
      <p class="dg-section-eyebrow">{recap ? 'By the numbers · season' : 'By the numbers'}</p>
      <StatSlot kind="stats" content={{}} data={statsData} variant="visual" />
    </section>
  </div>
{/if}
```

Apply the same pattern to the Standings block (around lines 1276-1292) and the Tastemaker block (around lines 1298-1305) — same wrapper classes/banners, same `<DataSectionActions>` mount using `excluded={dataSectionExcluded('standings')}` / `excluded={dataSectionExcluded('discoverability')}` respectively, keyed to `'standings'` and `'discoverability'` and their existing labels ("Season standings" / "Tastemaker"). For Standings specifically, keep the existing "✎ edit figures" button inside `.dg-standings-head` unchanged — `DataSectionActions` is an additional sibling, not a replacement.

- [ ] **Step 5: Mount `DataRegenConfirm` when `dataModalTarget` is set**

Add near the existing `{#if modalTarget !== null}` block:

```svelte
{#if dataModalTarget !== null}
  <DataRegenConfirm
    sectionLabel={DATA_SECTION_LABEL[dataModalTarget]}
    onCancel={closeDataModal}
    onSubmit={() => { const key = dataModalTarget!; closeDataModal(); void recomputeDataSection(key); }}
    onQueue={() => queueData(dataModalTarget!)}
  />
{/if}
```

- [ ] **Step 6: Run svelte-check**

```bash
cd ui && npm run check
```
Expected: 0 errors.

- [ ] **Step 7: Manual smoke test**

```bash
cd ui && npm run dev -- --host --port 5180
```
On a digest page in refine/finalize stage with Stats/Standings/Tastemaker all visible: for each of the three, click ↻ → confirm `DataRegenConfirm` opens (not the full `RegenModal` with chips). Click "Recompute now" on one, confirm it shows a brief regenerating shimmer then settles. On another, click "+ Add to batch", confirm it shows the red queued banner and the master button count increments. Click 🔒 lock on the third, confirm it shows the green locked banner/outline and its ↻/⊘ don't get disabled (lock doesn't block manual regen, only batch runs — same semantics as prose sections). Run the batch via the master button and confirm the queued one recomputes while the locked one is untouched.

Kill the dev server after.

- [ ] **Step 8: Commit**

```bash
git add ui/src/routes/digest/\[roundId\]/+page.svelte
git commit -m "feat(digest): Stats/Standings/Tastemaker gain exclude/lock/regen parity

Wires DataSectionActions + DataRegenConfirm onto the 3 DATA sections that
have a render block on the page. Recompute re-fetches the section's
existing GET endpoint (no new backend routes) and swaps a local override,
mirroring the standingsOverride pattern already used for the reconcile
flow. Batch queue now covers prose and DATA sections through one runBatch()."
```

---

### Task 8: Add lock (cosmetic) to `NextRoundSection.svelte` and fold into page tallies

**Files:**
- Modify: `ui/src/lib/digest/NextRoundSection.svelte`
- Modify: `ui/src/routes/digest/[roundId]/+page.svelte`

**Interfaces:**
- Produces: `NextRoundSection` gains an `onLockedChange?: (locked: boolean) => void` prop, mirroring its existing `onExcludedChange`. Next-round does not participate in the regen queue (no regenerate action applies to it per the spec), so this is display/tally-only.

- [ ] **Step 1: Add a local `locked` state and lock button to `NextRoundSection.svelte`**

Add the prop (in the `$props<{...}>()` type, alongside `onExcludedChange`):

```ts
const {
  roundId,
  data,
  initialExcluded = false,
  hasOverride = false,
  onExcludedChange,
  onLockedChange,
} = $props<{
  roundId: number;
  data: NextRound | null;
  initialExcluded?: boolean;
  hasOverride?: boolean;
  onExcludedChange?: (excluded: boolean) => void;
  onLockedChange?: (locked: boolean) => void;
}>();
```

Add local state near `let excluded = $state(initialExcluded);`:

```ts
let locked = $state(false);
function toggleLocked() {
  locked = !locked;
  onLockedChange?.(locked);
}
```

Update the wrapper `<div>` classes (line 128-132):

```svelte
<div
  class="dg-section-wrap"
  class:is-excluded={excluded}
  data-section-kind="nextRound"
>
```

to:

```svelte
<div
  class="dg-section-wrap"
  class:is-excluded={excluded}
  class:is-locked={locked}
  data-section-kind="nextRound"
>
```

Add a locked banner alongside the existing excluded banner (line 133-135):

```svelte
{#if excluded}
  <div class="dg-excluded-banner">⊘ excluded from final · Next Round Up</div>
{/if}
```

to:

```svelte
{#if excluded}
  <div class="dg-excluded-banner">⊘ excluded from final · Next Round Up</div>
{:else if locked}
  <div class="dg-locked-banner">🔒 locked · Next Round Up</div>
{/if}
```

Add the lock button into the action bar (line 137-146), right after the exclude button:

```svelte
<div class="dg-section-actions">
  <button
    type="button"
    class="dg-sa-btn"
    onclick={toggleExcluded}
    title={excluded ? 'Include in final' : 'Exclude from final'}
    aria-pressed={!excluded}
  >{excluded ? '+' : '⊘'}</button>

  <button
    type="button"
    class="dg-sa-btn"
    class:is-locked={locked}
    onclick={toggleLocked}
    title={locked ? 'Unlock' : 'Lock'}
    aria-pressed={locked}
  >{locked ? '🔒' : '🔓'}</button>

  <span class="dg-sa-divider"></span>
```

- [ ] **Step 2: Fold next-round's lock into the page's tallies**

In `ui/src/routes/digest/[roundId]/+page.svelte`, add a `nextRoundLocked` state var near `let nextRoundExcluded = ...`:

```ts
let nextRoundLocked = $state(false);
```

Update `excludedCount`/`lockedCount` (around lines 908-913) to include the DATA sections and next-round:

```ts
const excludedCount = $derived(
  sectionsList.filter((s) => sectionStates[s.id] === 'excluded').length,
);
const lockedCount = $derived(
  sectionsList.filter((s) => sectionStates[s.id] === 'locked').length,
);
```

to:

```ts
const excludedCount = $derived(
  sectionsList.filter((s) => sectionStates[s.id] === 'excluded').length
  + (statsExcluded ? 1 : 0)
  + (standingsExcluded ? 1 : 0)
  + (discoverabilityExcluded ? 1 : 0)
  + (nextRoundExcluded ? 1 : 0),
);
const lockedCount = $derived(
  sectionsList.filter((s) => sectionStates[s.id] === 'locked').length
  + (dataSectionRunState.stats === 'locked' ? 1 : 0)
  + (dataSectionRunState.standings === 'locked' ? 1 : 0)
  + (dataSectionRunState.discoverability === 'locked' ? 1 : 0)
  + (nextRoundLocked ? 1 : 0),
);
```

Wire the callback on the `<NextRoundSection>` mount (around line 1310-1316):

```svelte
<NextRoundSection
  roundId={data.roundId}
  data={nextRoundData ?? null}
  initialExcluded={nextRoundExcluded}
  hasOverride={nextRoundHasOverride}
  onExcludedChange={(v) => { nextRoundExcluded = v; }}
/>
```

to:

```svelte
<NextRoundSection
  roundId={data.roundId}
  data={nextRoundData ?? null}
  initialExcluded={nextRoundExcluded}
  hasOverride={nextRoundHasOverride}
  onExcludedChange={(v) => { nextRoundExcluded = v; }}
  onLockedChange={(v) => { nextRoundLocked = v; }}
/>
```

- [ ] **Step 3: Run svelte-check**

```bash
cd ui && npm run check
```
Expected: 0 errors.

- [ ] **Step 4: Manual smoke test**

```bash
cd ui && npm run dev -- --host --port 5180
```
On a digest page with a next round available: click 🔒 on the Next-round preview section, confirm it shows the green locked banner/outline, and the page-footer summary text ("draft cached · N excluded · N locked") increments its locked count. Confirm there's no regenerate button on this section (unchanged — next-round has nothing to regenerate).

Kill the dev server after.

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/digest/NextRoundSection.svelte ui/src/routes/digest/\[roundId\]/+page.svelte
git commit -m "feat(digest): Next-round preview gains a cosmetic lock toggle

Next-round has no regenerate action (nothing to regenerate — it's a
preview of the upcoming round's theme/deadline), so lock here is
display-only: it folds into the page's excluded/locked tallies for
consistency with every other section, but doesn't gate any batch
operation since none touches next-round."
```

---

### Task 9: Full regression pass

**Files:** none (verification only)

**Interfaces:** none.

- [ ] **Step 1: Run the full test suite**

```bash
cd ui && npx vitest run
```
Expected: same pass/fail counts as the pre-existing baseline (this plan touches no backend `.ts` logic covered by existing tests — `regen-skip-excluded.test.ts` and friends should be unaffected). If any digest-related test newly fails, stop and diagnose before proceeding — do not commit over a regression.

- [ ] **Step 2: Run svelte-check one final time**

```bash
cd ui && npm run check
```
Expected: 0 errors.

- [ ] **Step 3: Full manual walkthrough**

```bash
cd ui && npm run dev -- --host --port 5180
```
Walk the entire flow on one round in refine/finalize stage:
1. Open "✎ Regenerate with options…" — confirm GenerateModal's new layout (Task 3).
2. Close it. Scroll to the bottom of the page, click ↻ on the last visible section — confirm the modal opens in view, not at the page top (Task 1).
3. Queue 2 prose sections and 1 DATA section for batch regen; confirm master button shows "Regenerate 3 queued" and glows red (Tasks 5, 8).
4. Lock 1 prose section and 1 DATA section; confirm green glow on both, and confirm locking does NOT block their individual ↻ button (only exempts them from batch runs).
5. Run the batch; confirm queued sections regenerate/recompute and locked sections are untouched.
6. Exclude 1 section; confirm grey/desaturated treatment unchanged from before this plan.

Kill the dev server after. This step has no code changes — it's a final sign-off before considering the plan complete.

- [ ] **Step 4: Update the design doc status line**

In `docs/superpowers/specs/2026-07-04-digest-generation-ux-cleanup-design.md`, change:

```
Status: approved, ready for implementation planning
```

to:

```
Status: implemented
```

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-07-04-digest-generation-ux-cleanup-design.md
git commit -m "docs(spec): mark digest generation UX cleanup as implemented"
```
