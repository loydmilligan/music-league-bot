# Digest generation/regen UX cleanup

Date: 2026-07-04
Status: approved, ready for implementation planning

## Context

The digest generation flow (`GenerateModal.svelte`), per-section regen flow (`RegenModal.svelte`),
and the acceptance/editing screen (`ui/src/routes/digest/[roundId]/+page.svelte` +
`DigestSection.svelte`) grew incrementally across many sprints. As a result:

- Controls that logically belong to a specific section (paste-chat, avatar regen) ended up in a
  misc area at the bottom of `GenerateModal`, disconnected from the section they affect.
- A "Season recap" checkbox sits in its own special bordered card at the top of `GenerateModal`,
  inconsistent with every other section's plain list-item styling.
- The 6 LLM prose sections (podium, villain, flow, consensus, quotes, chat) get a full, uniform
  action bar on the acceptance screen (exclude / regen / lock / delight / variant / edit-inline /
  move / delete) via `DigestSection.svelte`. The 5 DATA sections (stats, standings, sonic
  signatures, Tastemaker/discoverability, next-round) do not — they have either nothing beyond an
  include/exclude checkbox in `GenerateModal`, or bespoke one-off editors (Standings' "edit
  figures" modal, NextRound's own mini kebab).
- There is no per-section "regenerate in place" workflow on the acceptance screen for DATA
  sections, and no batch-queue concept at all today — "Regenerate all" is all-or-nothing across
  unlocked/non-excluded sections.
- A real bug: `.dg-modal-scrim` (`ui/src/lib/digest/digest.css:437`) is `position: absolute`, not
  `fixed`. An absolutely-positioned element with no positioned ancestor is placed relative to the
  top of the whole document, not the current viewport — so any modal opened while scrolled down
  renders above the visible area and requires scrolling to the top of the page to find.

This was investigated and confirmed via full codebase research (see prior conversation); this
doc captures the agreed design.

## Non-goals: what stays as-is

- Standings' bespoke "✎ edit figures" modal (`EditableStandingsTable.svelte`) stays as the
  edit mechanism for that section — it is not replaced by `SectionInlineEditor`.
- Next-round's own inline theme/deadline editor stays as-is — it is not replaced by
  `SectionInlineEditor` either. It only gains the shared lock/exclude visual treatment.
- `RegenModal`'s "quick steer chips" + "specific instructions" freeform box are unchanged in
  content/behavior; only how it's *invoked* (in-place, with a now-vs-batch choice) changes.
- No change to what "Regenerate all" does when nothing is queued: it still fires every unlocked,
  non-excluded section, same as today.

## 1. Bug fix — modal viewport positioning

**File:** `ui/src/lib/digest/digest.css:437`

```diff
 .dg-modal-scrim {
-  position: absolute;
+  position: fixed;
   inset: 0;
```

This is shared by every modal using the `dg-modal-scrim` class (`GenerateModal`, `RegenModal`,
`RelContextDiffModal`, `ReconciliationModal`, `EditableStandingsTable`, plus non-digest modals
`UpdateModal`, `TokenGenerateModal` — all benefit from the same fix, all currently have the same
bug). Verify none of these are nested inside an ancestor with a CSS `transform` (which would
re-scope `fixed` to that ancestor instead of the viewport) — a quick grep during implementation
should confirm this; based on current structure they render near the page root so this is not
expected to be an issue.

## 2. GenerateModal reorganization

Current order (top → bottom): Season recap card → per-section list (podium, villain, flow,
consensus, quotes, chat) → Stats → Standings → Sonic Signatures → Next-round → Tastemaker →
paste-chat textarea → avatar-regen checkbox → hint text → footer.

New order: every entry is a plain section list-item, styled identically (checkbox + optional
expand/context/variant controls), in this sequence:

1. **Season recap** — same `recapEnabled`/`recapFinal` behavior, now rendered as a normal
   section list-item instead of a special bordered card.
2. Podium, Villain, Flow, Consensus, Quotes, Chat (unchanged relative order and internals) —
   **except** Chat's block now also contains the **"Paste WhatsApp chat"** textarea
   (`pastedChat`), moved down from the modal's bottom misc area. It only ever feeds the `chat`
   section (confirmed in `llm.ts:566-567, 752-762`), so it belongs inside that section's own
   controls, shown/enabled only when the Chat section checkbox is on.
3. Stats ("By the numbers")
4. **Season standings** — gains the **"Regenerate themed avatars for this round"** checkbox
   (`regenAvatars`), moved down from the modal's bottom misc area, nested under/beside the
   existing "recompute from votes" sub-checkbox. Avatars render inside `StandingsChart.svelte`
   (confirmed — Tastemaker/`TastemakerSection.svelte` has zero avatar references), so this is
   where the toggle belongs.
5. Sonic Signatures
6. Tastemaker
7. Next-round preview

No controls remain in a bottom "misc" area — the modal ends with the static hint paragraph and
footer buttons, same as today, just with nothing above them except the section list.

## 3. Acceptance-screen DATA section parity

Each DATA section is promoted toward the same action bar the 6 prose sections get via
`DigestSection.svelte` (`+page.svelte:1250-1268` → `DigestSection.svelte:411-506`: exclude ⊘/+,
regenerate ↻, lock 🔒/🔓, delight ▲, variant switch, kebab: edit-inline/move/delete), applying
only what's meaningful per section:

| Section | Exclude | Lock | Regenerate ↻ | Delight ▲ | Variant switch | Edit |
|---|---|---|---|---|---|---|
| Stats ("By the numbers") | ✅ | ✅ | ✅ (re-runs the computation, not an LLM call) | ❌ (no prose) | ❌ | ❌ (no free-text to edit) |
| Standings | ✅ | ✅ | ✅ (re-runs the computation) | ❌ | ❌ | ✅ — existing bespoke "✎ edit figures" modal, kept as-is |
| Sonic Signatures | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Tastemaker / Discoverability | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Next-round preview | ✅ | ✅ | ❌ (nothing to regenerate — it's a preview of the *next* round's theme/deadline, not generated content) | ❌ | ❌ | ✅ — existing bespoke inline theme/deadline editor, kept as-is |

**Note on what "regenerate" means for computed sections:** today, none of the 5 DATA sections
have a regenerate endpoint at all — they're recomputed automatically whenever `invalidateAll()`
re-fetches the page's `load` data (confirmed: no per-section regenerate route exists for
stats/standings/sonic-signatures/tastemaker). So the ↻ action added here for Stats, Standings,
Sonic Signatures, and Tastemaker is new: it should trigger a targeted re-fetch/recompute for that
section specifically (not a full-page `invalidateAll()`, to avoid disturbing other sections'
state) and show the same `regenerating` shimmer while it runs. Whether this needs a new
per-section API route or can reuse existing data-loading functions server-side is an
implementation-planning decision.

All five gain the same wrapper visual-state system already used by `DigestSection.svelte`
(excluded = opacity+grayscale+banner, locked = outline+banner, regenerating = shimmer+banner —
see section 4 for the lock-color change). This likely means either (a) extracting a thin shared
"action bar + state wrapper" piece that both `DigestSection.svelte` and the DATA-section blocks
in `+page.svelte` use, or (b) having each DATA section's markup adopt the same CSS classes
(`dg-section-wrap`, `is-excluded`, `is-locked`, `is-regenerating`) directly. Exact factoring is an
implementation-planning decision, not a design decision — the requirement is behavioral/visual
parity, not a specific code-reuse mechanism.

## 4. New per-section regen workflow (batch queue)

**Trigger:** clicking ↻ on *any* section (prose or DATA, wherever regen applies per the table
above) opens `RegenModal` scoped to that section, same as today — but now via the fixed-position
overlay (section 1), so it always appears in view regardless of scroll position.

**New choice in the modal:** two footer actions instead of one:
- **"Regenerate now"** — today's behavior: submits immediately, section shows the `regenerating`
  shimmer state, POSTs to the existing per-section regenerate endpoint.
- **"Add to batch"** — queues this section (with its chips/instructions) without firing the
  request. The modal closes; the section visually flips to a new **`queued`** state.

**New section state — `queued`:** a fourth value alongside the existing
`'default' | 'excluded' | 'locked' | 'regenerating'` in `SectionState`
(`DigestSection.svelte:17`). Visual treatment: red glow (adapt the existing `is-regenerating`
shimmer/banner styling — same red family, but a steady glow rather than the animated "in
progress" shimmer, to visually distinguish "queued, not yet running" from "actively
regenerating"). A section can be queued and still be edited/re-queued with different
instructions before the batch runs; queuing again for the same section replaces its queued
chips/instructions rather than stacking.

**Locked/excluded sections cannot be queued** — the ↻ button is disabled/hidden in those states,
consistent with how "Regenerate all" already skips locked/excluded sections today.

**Master button (`+page.svelte`, top of the page):**
- Queue empty → reads **"Regenerate all"**, default styling, and behaves exactly as today:
  clicking it immediately regenerates every unlocked, non-excluded section (this is the existing
  "if you press it right after load it regenerates everything" behavior — unchanged, still the
  reason to lock/exclude/individually-handle sections *before* pressing it).
- Queue non-empty → relabels to **"Regenerate N queued"**, glows red (same red family as queued
  sections), and clicking it fires only the queued sections' regenerations (each with its own
  stored chips/instructions), leaving everything else untouched. After the batch completes,
  queued sections transition through `regenerating` back to `default` and the button reverts to
  "Regenerate all".

**Lock color change:** locked sections currently glow amber (`is-locked` →
`var(--amber-soft)`/`var(--amber)` per `digest.css`). Per this design, locked becomes **green**
to sit clearly apart from queued-red and keep excluded's existing grey/desaturated treatment
visually distinct from both. Update `.dg-section-wrap.is-locked` and `.dg-locked-banner` (and the
kebab/lock-button `is-locked` state in `digest.css` around lines 267-390) from the amber palette
to a green one (reuse an existing `--moss`/success-green token if one exists in the design
system, rather than inventing a new color).

**Final visual-state summary (all four states, one consistent language across every section):**

| State | Meaning | Color |
|---|---|---|
| `default` | normal, will regenerate immediately if "Regenerate all" is pressed | none |
| `excluded` | omitted from the final digest | grey / desaturated (unchanged) |
| `locked` | frozen — skipped by both "Regenerate all" and batch runs | green (changed from amber) |
| `queued` | added to the batch, will regenerate when the batch runs | red glow (new) |
| `regenerating` | actively mid-regeneration right now | red shimmer (existing, unchanged animation) |

## Open implementation questions (for the planning phase, not blocking spec approval)

- Exact mechanism for sharing the `DigestSection.svelte` action-bar/state-wrapper with the 5 DATA
  sections (extract a shared component/snippet vs. duplicate the CSS classes) — implementation
  detail, decide during planning.
- Whether the batch queue's per-section chips/instructions need to persist across a page reload,
  or are acceptable as client-side-only state that's lost on navigation (recommend: client-side
  only, matches how `lastChips`/`lastInstructions` already behave for immediate per-section
  regen today).
