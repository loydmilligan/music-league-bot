# Claude Design Brief — OpenRouter & LLM Cost Management

**Project:** music-league-bot · **Campaign:** `openrouter-cost-management` · **Date:** 2026-06-17
**From:** orc · **For:** Claude Design (CD)
**Design system:** Mash Co. Reuse the tokens + primitives from the shipped **Models & AI** screen —
reference set at `docs/design/models/reference/` (`ml-styles.css`, `ml-models.css`, `colors_and_type.css`,
`orc-tower-styles.css`, and `Music League Bot - Models.html`). Same dark operator aesthetic, functional
Unicode glyphs (no emoji), tokens not raw hex. Target stack: SvelteKit + Svelte 5 runes; charts are
**CSS-bar / token-styled, no charting library** (we already do this in `StandingsChart`). Prototype as
self-contained HTML like the sprint-38 Models mock. Design for **mobile 412px and desktop**.

---

## 1. What this campaign is

A continuation of the shipped **Models & AI** settings tab (sprint-38: OpenRouter key, a saved-model
roster, and two DB-backed model variables — Predict + Digest — resolved DB→env→hardcoded). The owner's
problem: *"we cannot afford a dollar for five calls."* This campaign makes LLM **spend visible, managed,
and optimizable** so we can run cheap models for boilerplate and a high-end model only where it matters.

Three sprints:
1. **Cost ledger** (data) — record every OpenRouter call: model, tokens, **cost (USD)**, **latency (ms)**,
   category (digest / archive / predict), a fine label (which section/task), league/round, timestamp.
2. **Debug mode + cost dashboard** (UI — *this is where we need CD*) — a debug-mode toggle on Settings
   that reveals a cost dashboard built on the ledger.
3. **Per-section model selection** — pin a model per content section (cheap for boilerplate, premium
   where it matters). The dashboard's comparison visuals (Q2/Q3 below) are what will *inform* these picks.

**Design scope across the campaign** (this brief covers the whole campaign in one handoff):
- **Sprint 1 (ledger):** no design — backend/data only, plus a one-line fix to existing display logic.
- **Sprint 2 (dashboard):** the bulk of the work — **Q1–Q4** below.
- **Sprint 3 (per-section model selection):** one screen question — **Q5** below (a new panel on the
  existing Models & AI screen). Q2/Q3's comparison visuals directly inform these per-section picks.

---

## 2. The data we have to visualize (the ledger)

Per OpenRouter call, one row: `model`, `category` ∈ {**digest**, **archive**, **predict**}, `label`
(e.g. `digest:podium`, `archive:season-update`, `predict:vote-probe`), `cost_usd`, `latency_ms`,
`prompt_tokens`/`completion_tokens`, `league_id?`, `round_id?`, `created_at`.

- **digest** = operator digest generation · **archive** = b-side public read-model generation ·
  **predict** = standalone predictions. (These three are the natural color split; see Q1.)
- Aggregations the dashboard can compute: today's spend by category; a 2-week daily series; per-call
  drilldown; and **per (model × task) averages** of cost and latency (the comparison surface, Q2).

---

## 3. What's already locked (don't redesign these — style them, don't rethink them)

The owner gave a verbatim baseline for the dashboard:
- **Today's total OpenRouter cost**, split **digest vs archive**.
- A **drilldown** of individual calls (what each was for).
- A **2-week chart**: one **stacked bar per day**, made of **digest + archive calls** in two base colors;
  **each individual call is a different shade** of its base color; **hover tooltip** names the section.

Locked AI/architecture decisions (context, not up for design): two-bucket model resolution (Predict/Digest)
extending to per-section pinning; DB-first resolver; capability-qualified model picking (a model must
support JSON mode to be selectable for a structured task).

---

## 4. Open design decisions — we want 2–3 prototyped options each

> For each, give 2–3 options as Mash Co HTML mockups, each with a one-line "best answers: …" and the
> trade-off. The owner picks at the sprint-40 design gate.

### Q1 — Stacked-bar category colors (including `predict`)
The owner's chart was specced as a two-color split (digest vs archive). We've since added a third
category, **predict**. Propose a **3-category base-color scheme** (digest / archive / predict) drawn from
Mash Co tokens that (a) survives the per-call **shade-stepping** within each base color, (b) stays
legible stacked, and (c) is colorblind-safe. Note: in `StandingsChart` the "ember/loss" token carries a
negative semantic — avoid implying any category is "bad." 2–3 palettes.

### Q2 — Model-comparison visuals (the big one)
Beyond raw spend, we want to **compare models by task** so we can decide *which model to use where* —
this directly feeds the per-section model selection in sprint 3. The driving question: **"for task X,
which model gives the best trade-off?"**

- **KPIs available in v1 — exactly two: (a) cost per call, (b) time-to-generate (latency).** Both come
  straight from the ledger. **Build the v1 prototype for these two only.**
- A third axis, **quality**, is **not captured anywhere yet** (no mechanism, no roadmap item) — design
  with a *clear, empty slot* for a third KPI later, but the working prototype uses the two real ones.
- Lay out the goal per visual and suggest a visual that achieves it. Some shapes to consider (propose
  your own too): a **cost-vs-latency scatter** with one point per model, faceted/filterable by task; a
  **model × task matrix/heatmap** shaded by cost (toggle to latency); **grouped bars per task**. For each,
  say which comparison question it answers best and how it extends to a 3rd KPI later.

See §5 for our thinking on the KPI set and the quality problem — please react to it and suggest better.

### Q3 — A single weighted "model value" score
Propose a method + visual to **aggregate the KPIs into one score with user-adjustable weights**. We
already have a strong in-app precedent: the **rating-weights sliders in App Settings** (four dimensions,
auto-balanced, "sums to 100"). Imagine the analog: weight sliders for cost vs latency (vs quality later)
that produce a **composite "value score"**, with a visual that **re-ranks models live** as you drag the
weights. Propose: (a) the normalization approach (how do you put $/call and ms on a comparable 0–1
scale, lower-is-better, before weighting?), and (b) the visual (re-sorting ranked bars? a single
composite axis? a small radar per model?). 2–3 options. Keep it honest with only two real KPIs in v1.

*(Optional Q4, if you have ideas: how should the four surfaces — today's split, drilldown, 2-week chart,
and the comparison/score views — compose into one debug dashboard? A tabbed panel, an accordion, a single
scroll? Light suggestion only.)*

### Q5 — Per-section model-selection panel (sprint 3)
Sprint 3 adds the ability to **pin a model per content section**, as a new panel on the existing
**Models & AI** screen (below the current Model Variables card). There are **~16 pinnable sections** in
two groups: **digest** (6: podium, villain, flow, consensus, quotes, chat) and **predict/archive** (10:
the narrative + profile + season-update + submission-predict + vote-probe + taste-fingerprint tasks).
Each section gets a model select that **defaults to "use the bucket default"** and is **filtered to
qualifying models** (same capability filter as Model Variables). The risk: 16 rows of selects is a lot,
especially at **412px**. Propose 2–3 layouts that stay scannable and make "most sections use the default,
a few are pinned" obvious at a glance — e.g. grouped accordion by bucket (collapsed by default, a badge
showing how many are overridden), a compact table with inline selects, or progressive disclosure
("Advanced: per-section overrides"). Match the Models & AI card styling. The comparison/value visuals
from Q2/Q3 are the *decision aid* a user consults before pinning here — note any natural link (e.g. a
"compare models for this section" affordance) if it's cheap.

### Q6 — (backend / data design, not a mockup) Future-proof the ledger schema
One extra question, more backend than UI — answer in writing, no mockup. The sprint-1 ledger
(`llm_cost_log`) is the data spine for everything cost-related, and we know what's coming next: we
eventually want a **quality metric** feeding an **evaluator + content-improvement engine** — score
generated content, learn which prompts / models / sections produce the best output, and close that loop
back into generation. Knowing that's on the horizon:

**Review our planned ledger and suggest any schema / design changes worth including NOW that would make
that future quality + evaluation work meaningfully easier — without over-building v1.** We'd rather add
a cheap column or an id/foreign-key today than do a painful backfill later; equally, tell us what to
*not* add yet (YAGNI).

Planned `llm_cost_log` — one row per OpenRouter call:
```
id, created_at, model, prompt_tokens, completion_tokens, total_tokens,
cost_usd, latency_ms, category ('digest' | 'archive' | 'predict'),
label   (e.g. 'digest:podium', 'archive:season-update', 'predict:vote-probe'),
league_id, round_id
```
Instrumentation: a single `callOpenRouter` writes the row, given `meta = { category, label, leagueId?,
roundId? }`. Today the row records the **cost/usage of a call** but does NOT link to the generated
artifact, the prompt, or any outcome. React to these (and raise your own):
- Should each row carry a stable **call/run id** and/or a link to the **artifact it produced** (the
  digest draft id, the b-side section, the `prediction_runs` row) so a future quality score can be joined
  back to the exact generation?
- Is **`label` as a free string** enough, or do we want structured columns (e.g. `surface` + `section` +
  `task_id`) so we can group/evaluate by section cleanly later?
- Should we capture a **prompt / version identifier** (or prompt hash) so quality can be attributed to a
  prompt revision, not just a model?
- Anything about **storing or pointing at the output** (or a content hash) so an evaluator has something
  to score without re-deriving it?
- Where should a future **quality score** live — extra nullable columns here, or a separate `llm_eval`
  table keyed by call id? Recommend the shape.

Deliver a written recommendation: a revised schema sketch + a short "add now / defer" list with reasons.

---

## 5. Our thinking on the KPIs + the quality problem (please push back)

The owner floated **cost / time-to-generate / quality** off the top of their head and asked for better ideas.

- **Cost** and **latency** are free and automatic from the ledger → these are the **two v1 KPIs**.
- **Quality** is the hard one and is **not built**. Options we see for a future quality signal:
  1. **Manual owner rating** — thumbs/stars on a generated section. Cheap, real, but sparse + subjective.
  2. **Implicit behavioral signal** — we already capture regeneration and section edit/exclude actions;
     *low regeneration + few edits = the output was good*. This signal is **already latent in our data**
     and costs nothing new to derive. We think this is the most promising cheap path.
  3. **LLM-as-judge** — a cheap model scores outputs against a rubric. Automatable, but adds spend (ironic
     for a *cost* campaign) and is itself of uncertain reliability. Treat as a later, opt-in tool.
- A strong **fourth candidate we'd add instead of/with quality: reliability** — JSON-mode/parse success
  rate + retry count per model. It's automatic, free to capture, and directly relevant (a model that
  fails structured output wastes spend). Arguably more decision-useful than a fuzzy "quality" score early.

**Our recommendation:** ship comparison on **cost + latency** now; design the slot for a 3rd KPI; pursue
**implicit quality (regen/edit rate)** and/or **reliability** as the next captured metric. We'll file a
`model-quality-signal` roadmap card to track it (not in this campaign's v1). CD: tell us if a different KPI
set or a smarter quality proxy would make the comparison/score visuals more useful.

---

## 6. Deliverable

For the **UI questions (Q1–Q3, Q5, and optional Q4)**: 2–3 Mash Co HTML mockups each, with a one-line
rationale + trade-off per option, sized for 412px and desktop, using the ledger data shapes in §2 (mock
data is fine). The owner selects per question; the Q1–Q4 winners feed the **sprint-40** dashboard build
and the Q5 winner feeds the **sprint-41** per-section panel.

For the **backend question (Q6)**: a written recommendation — a revised `llm_cost_log` schema sketch plus
an "add now / defer" list with reasons. This may adjust the **sprint-39** ledger before it's built.
