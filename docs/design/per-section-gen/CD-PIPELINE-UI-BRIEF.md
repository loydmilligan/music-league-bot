# Claude Design Brief — Generation Pipeline Config UI (sprint-45)

**Project:** music-league-bot · **Campaign:** `generation-pipeline` · **Date:** 2026-06-18
**From:** orc · **For:** Claude Design (CD)
**Design system:** Mash Co. Reuse tokens + primitives from the shipped **Models & AI** screen
(reference set under `docs/design/models/reference/`). Dark operator aesthetic, functional Unicode
glyphs (**no emoji**), **tokens not raw hex**, **no charting library** (CSS/flex/grid only, as in
`StandingsChart`). Target stack: **SvelteKit + Svelte 5 runes**. Design for **mobile 412px and desktop**.
Prototype as self-contained HTML like the prior cost/pipeline mocks.

---

## 1. What we shipped (context — why this UI is needed)

The digest used to be **one LLM call** generating all six sections together, so per-section model
pins (a Models & AI feature) did nothing on a fresh draft. We replaced that with a **generation
pipeline** (shipped v1.10.0 + v1.11.0):

- A **Release** (a digest) runs as ordered **tracks** (sections). Two primitives shape it:
  - **Skip** — a barrier. Sections before a skip run in parallel; sections after a skip are
    regenerated **reading all prior output as context**. The tracks between two skips = an **EP**
    (one phase). This is how coherence is preserved when we split the draft.
  - **Merge** — same-model adjacent tracks in an EP collapse into **one API call** (co-generation +
    cost saving).
- **Covers** — a section re-run in a later EP on a **different (better) model** with prior context.
  Both takes are kept; at review the user picks Original vs Cover (already built — the **cover A/B
  review** in the digest flow).
- Per-section **model pins** now bind on the initial draft.

**The gap this brief fills:** the pipeline is currently **a JSON blob in the DB with no UI**. The
owner edits it by changing code. We need a screen to **view and edit the pipeline without coding**.

---

## 2. The exact data model you're designing an editor for (don't redesign it — make it legible)

Shipped TypeScript (`ui/src/lib/digest/pipeline.ts`), stored as one JSON row in the `settings` table
(key `pipeline_config`):

```ts
type Cover = { of: SectionKind; model: string };   // re-run `of` later on `model`
type Pipeline = {
  releaseKind: 'digest';
  order: SectionKind[];                          // run order; must include all active sections
  models: Partial<Record<SectionKind, string>>;  // per-section model OVERRIDE ({} = fall back to the DB pin)
  skipAfter: Partial<Record<SectionKind, true>>; // a skip sits AFTER this section
  covers: Cover[];
};
```

The current default (what you'd see on first load):
```ts
DEFAULT_PIPELINE = {
  releaseKind: 'digest',
  order: ['quotes','consensus','podium','chat','villain','flow'],
  models: {},                                  // every section uses its Models & AI per-section pin / bucket default
  skipAfter: { chat: true },                   // ONE skip: factual sections first, then voice sections
  covers: [{ of: 'flow', model: 'anthropic/claude-sonnet-4-5' }],
};
```

How it resolves (so the UI can preview it): split `order` into EPs at each `skipAfter`; within an EP,
group same-model sections → one call; covers run in a trailing EP. The default resolves to:
**EP0** = quotes+consensus+podium+chat (merged, one call) → **skip** → **EP1** = villain, flow → **EP2**
= flow **cover** (Sonnet, reads EP0+EP1). Each fresh digest = ~3-4 calls instead of 1.

## 3. What the UI must let the user do

1. **See the pipeline as it will run** — the ordered sections, where the skips/EP boundaries are,
   which sections merge into one call, and which have a cover. A "this is what a digest will do"
   preview is the heart of it.
2. **Set a section's model** (or "use default").
3. **Move/reorder sections** and **toggle a skip after a section** (add/remove EP boundaries).
4. **Add/remove a cover** on a section (pick the cover model).
5. **Save** (writes `pipeline_config`) and **reset to default**.
6. Surface the **consequence**: rough call-count / relative cost as the user edits (we have real
   cost data in the ledger; a relative "≈ N calls, ≈ $X" hint is enough — no live chart).

## 4. The genuinely hard part (where we need your design)

Representing **EPs / skips / merge / covers** so a non-technical operator understands "what a digest
will do" at a glance. The vocabulary is deliberately musical (Release · EP · Track · Skip · Merge ·
Cover) — lean into it if it helps. The challenge is showing **three layered facts** on the same
sections list: run-order, EP/skip grouping, and per-section model (with merge = "these share a call").

## 5. Reuse / don't reinvent

- The **Models & AI → per-section overrides** panel (sprint-41) already renders 16 sections with a
  qualifying-model `<select>` + "(use default)" each. The pipeline `models` map and that panel's
  per-section DB pins **overlap** — see Q3. Reuse its select + qualify-filter pattern.
- The **cover A/B review** (digest flow) already styles an Original-vs-Cover compare — echo it.
- Card styling, tokens, glyphs from the shipped Models & AI screen.

## 6. Open design questions — give 2–3 Mash Co HTML mockup options each, with a one-line "best answers / trade-off"

**Q1 — The pipeline editor itself (the cornerstone).** How to present the ordered sections with EP/skip
boundaries + per-section model + merge grouping + covers, editable, on **412px first**. Some shapes to
consider (propose your own): a vertical track list with draggable order + inline "── skip ──" dividers
the user inserts between tracks + a model dropdown per track + a "＋ cover" affordance; or an EP-grouped
accordion; or a two-column "tracks | resolved run preview". Show how merge (same-model adjacency) is
made visible.

**Q2 — Covers.** How a cover is added/shown on a track: the cover model picker, the "runs later, reads
the draft" explanation, and how the editor shows that a covered section produces two takes (ties to the
already-built A/B review).

**Q3 — Reconcile the two model-setting surfaces.** A section's model can be set in **two** places today:
the Models & AI per-section panel (a DB pin) and the pipeline's `models` override. That's confusing.
Propose how the UI should relate them — e.g. fold per-section model-setting **into** the pipeline editor
and retire/relabel the separate panel, or keep them with a clear precedence note. Recommend one.

**Q4 — Where it lives.** A new tab on the Models & AI screen? A new `/settings/pipeline` page? A section
within Models & AI? Light recommendation.

**Q5 — Run preview / cost hint.** How to show "what a digest will do" + a rough call-count/cost estimate
as the user edits, without a charting lib.

## 7. Deliverable

For Q1–Q5: **2–3 Mash Co HTML mockups each**, one-line rationale + trade-off per option, sized for 412px
and desktop, using the real data model in §2 (mock values fine). The owner picks per question; the
winners feed the **sprint-45 `pipeline-config-ui`** build. v2 (deferred, out of scope here): **per-league
profiles** (saved pipelines per league) — but if a layout naturally extends to multiple saved pipelines,
note it.

## 8. Mock-data anchors (so mockups feel like our system)

**The 6 digest sections (tracks), with coherence dependency** (from the pipeline design — drives skip
placement): `quotes` (extractive, dep 0) · `consensus` (factual, 1) · `podium` (factual, 1) · `chat`
(extractive, 1) · `villain` (voice, 2) · `flow` (voice, **3** — the narrative arc).

**Model roster (real-ish, per-1M-token pricing) — the dropdown options:**
| Model | tier | role |
|---|---|---|
| `anthropic/claude-opus-4.8` | `$$$` | premium |
| `anthropic/claude-sonnet-4.6` | `$$` | high-end (current Flow cover model) |
| `anthropic/claude-haiku-4.5` | `$` | cheap default |
| `minimax/minimax-m3` | `$` | current digest default (DB) |
| `google/gemini-3.5-flash` | `$` | cheapest + fastest |
| `meta-llama/llama-3.3-70b:free` | `FREE` | free, variable |

(Selectable models come from the `ai_models` roster filtered by capability — JSON-mode required — via
the existing `qualifies()` filter; show ~5–6 in mocks.)

**Example "what a digest does" preview** for the default pipeline:
`EP0 (1 call): quotes · consensus · podium · chat` → `skip` → `EP1: villain · flow` → `EP2: flow cover
(Sonnet, reads prior)` · ≈ 3–4 calls · relative cost low-to-medium.
