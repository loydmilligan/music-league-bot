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

---

## 7. Mock-data appendix (real-ish anchors)

Use these so the mockups feel like our actual system. All figures are realistic, not measured —
internally consistent (cost ≈ tokens × price), good enough to anchor visuals.

### Models actually in rotation (roster + env defaults), per-1M-token pricing
| Model | in / out ($/1M) | tier | role |
|---|---|---|---|
| `anthropic/claude-opus-4.8` | 15 / 75 | `$$$` | premium, rare maintenance runs |
| `anthropic/claude-sonnet-4.6` | 3 / 15 | `$$` | high-end content |
| `anthropic/claude-haiku-4.5` | 1 / 5 | `$` | current digest+predict default (env) |
| `deepseek/deepseek-v4-pro` | 0.40 / 1.20 | `$` | cheap experiment |
| `minimax/minimax-m3` | 0.30 / 1.10 | `$` | current digest selection (DB) |
| `google/gemini-3.5-flash` | 0.15 / 0.60 | `$` | cheapest paid, very fast |
| `meta-llama/llama-3.3-70b:free` | 0 / 0 | `FREE` | free-tier, weaker/variable |

### Per-call ranges by purpose (cost / latency / tokens)
| label (purpose) | $/call (cheap → premium model) | latency | prompt→completion tokens |
|---|---|---|---|
| `digest:full` (whole draft) | $0.006 → $0.60 (Haiku ≈ $0.05, Sonnet ≈ $0.17, Opus ≈ $0.58) | 3–30 s | 8k–15k → 1.5k–3k |
| `digest:<section>` regen (podium/villain/flow/consensus/quotes/chat) | $0.002 → $0.15 | 2–14 s | 3k–6k → 300–900 |
| `archive:season-update` | $0.004 → $0.20 | 3–20 s | 4k–9k → 600–1.5k |
| `archive:narrative-*` / `profile-*` | $0.003 → $0.18 | 3–18 s | 4k–8k → 500–1.4k |
| `archive:rel-context` | $0.001 → $0.04 | 2–9 s | 1.5k–4k → 200–600 |
| `predict:vote-probe` / `submission-predict` / `taste-fingerprint` | $0.001 → $0.05 | 1.5–12 s | 1k–4k → 150–600 |

Latency by model (rough): Opus 12–30 s · Sonnet 8–20 s · Haiku 3–9 s · DeepSeek/MiniMax 4–12 s · Gemini Flash 1.5–5 s · Llama-free 5–15 s (variable).

### 14-day daily series (for the 2-week stacked-bar chart) — `$ digest / archive / predict / total · #calls`
```
D-13  0.00 / 0.00 / 0.00 / 0.00 ·  0    (quiet)
D-12  0.12 / 0.04 / 0.01 / 0.17 ·  7
D-11  1.85 / 0.62 / 0.14 / 2.61 · 54    (heavy testing)
D-10  0.94 / 0.30 / 0.08 / 1.32 · 31
D-9   0.05 / 0.02 / 0.00 / 0.07 ·  4
D-8   0.00 / 0.00 / 0.00 / 0.00 ·  0    (quiet)
D-7   2.10 / 0.48 / 0.11 / 2.69 · 60    (heavy)
D-6   0.40 / 1.05 / 0.05 / 1.50 · 28    (archive-heavy: b-side regen day)
D-5   0.18 / 0.06 / 0.02 / 0.26 ·  9
D-4   0.77 / 0.22 / 0.13 / 1.12 · 33
D-3   0.03 / 0.01 / 0.01 / 0.05 ·  3
D-2   1.42 / 0.55 / 0.09 / 2.06 · 44
D-1   0.21 / 0.34 / 0.04 / 0.59 · 16
D-0   0.66 / 0.19 / 0.06 / 0.91 · 22    (today)
```
≈ $13.85 over 14 days, ~311 calls. Note the variety the chart must handle: zero days, light maintenance days, heavy testing spikes, and one archive-dominant day.

### Sample "today" drilldown (a slice of D-0's 22 calls — for the today-split + drilldown)
```
09:02  digest:full              claude-sonnet-4.6     $0.164   14.2s   11800→2410
09:06  digest:podium            claude-haiku-4.5      $0.021    4.1s    4200→ 520
09:07  digest:flow              claude-haiku-4.5      $0.026    4.8s    4600→ 680
09:31  archive:season-update    minimax/minimax-m3    $0.007    9.1s    6100→ 940
10:05  predict:vote-probe       gemini-3.5-flash      $0.0009   2.3s    2200→ 240
10:06  predict:vote-probe       gemini-3.5-flash      $0.0010   2.1s    2350→ 260
11:14  digest:full              claude-opus-4.8       $0.560   23.7s   12400→2550   (a "make it sing" run)
11:40  archive:narrative-league-reel  claude-haiku-4.5  $0.018  5.6s   5200→ 760
13:22  predict:submission-predict      llama-3.3-70b:free $0.00  8.9s   1800→ 410
14:50  digest:consensus         deepseek/deepseek-v4-pro  $0.004 7.2s  3900→ 480
15:03  archive:rel-context      claude-haiku-4.5      $0.009    3.4s    2600→ 350
16:18  digest:chat              minimax/minimax-m3    $0.003    6.0s    3700→ 430
```

### Per-(model × task) aggregate (for Q2 comparison + Q3 value score) — `avg $ / avg latency / n`
Task = `digest:full`:
```
claude-opus-4.8     $0.58  · 22.4s · n=3      (premium, slow)
claude-sonnet-4.6   $0.17  · 14.1s · n=18
claude-haiku-4.5    $0.055 ·  6.2s · n=41     (current default)
minimax/minimax-m3  $0.012 ·  9.8s · n=12
gemini-3.5-flash    $0.008 ·  3.1s · n=7      (cheapest+fastest)
llama-3.3-70b:free  $0.00  · 11.5s · n=2      (free, variable)
```
Task = `predict:vote-probe`:
```
claude-haiku-4.5    $0.014 ·  5.1s · n=22
gemini-3.5-flash    $0.0009·  2.3s · n=63     (the workhorse here)
deepseek-v4-pro     $0.006 ·  6.8s · n=9
```
This cost-vs-latency spread (Opus dear+slow, Flash cheap+fast, Haiku in between) is the trade-off the
comparison/value visuals exist to surface. **Quality is unknown** — leave its column/axis empty (the
3rd-KPI slot).

