---
title: Digest Automation Brainstorm
type: brainstorm
status: brainstorming
last-touched: 2026-06-27
tags:
  - music-league-bot
  - digest
  - automation
  - brainstorm
# ── overall ──
north_star: ""
overall_notes: ""
# ── per-block state (verdict / priority / notes) — defaults = my recommendation ──
b_1_1_1_verdict: auto
b_1_1_1_priority: p1
b_1_1_1_notes: ""
b_1_2_1_verdict: keep
b_1_2_1_priority: p2
b_1_2_1_notes: ""
b_1_3_1_verdict: keep
b_1_3_1_priority: p2
b_1_3_1_notes: ""
b_1_3_2_verdict: auto
b_1_3_2_priority: p0
b_1_3_2_notes: ""
b_1_4_1_verdict: auto
b_1_4_1_priority: p1
b_1_4_1_notes: ""
b_2_1_1_verdict: rework
b_2_1_1_priority: p0
b_2_1_1_notes: ""
b_2_2_1_verdict: auto
b_2_2_1_priority: p0
b_2_2_1_notes: ""
b_2_3_1_verdict: auto
b_2_3_1_priority: p2
b_2_3_1_notes: ""
b_3_1_1_verdict: keep
b_3_1_1_priority: p2
b_3_1_1_notes: ""
b_3_2_1_verdict: keep
b_3_2_1_priority: p1
b_3_2_1_notes: ""
b_3_3_1_verdict: keep
b_3_3_1_priority: p2
b_3_3_1_notes: ""
b_3_4_1_verdict: keep
b_3_4_1_priority: p2
b_3_4_1_notes: ""
b_3_5_1_verdict: keep
b_3_5_1_priority: p2
b_3_5_1_notes: ""
b_3_5_2_verdict: gate
b_3_5_2_priority: p2
b_3_5_2_notes: ""
b_4_1_1_verdict: gate
b_4_1_1_priority: p0
b_4_1_1_notes: ""
b_4_2_1_verdict: rework
b_4_2_1_priority: p0
b_4_2_1_notes: ""
b_4_3_1_verdict: gate
b_4_3_1_priority: p1
b_4_3_1_notes: ""
b_5_1_1_verdict: auto
b_5_1_1_priority: p2
b_5_1_1_notes: ""
b_5_2_1_verdict: auto
b_5_2_1_priority: p1
b_5_2_1_notes: ""
b_5_2_2_verdict: auto
b_5_2_2_priority: p1
b_5_2_2_notes: ""
b_5_3_1_verdict: keep
b_5_3_1_priority: p2
b_5_3_1_notes: ""
b_5_3_2_verdict: cut
b_5_3_2_priority: p2
b_5_3_2_notes: ""
b_5_4_1_verdict: cut
b_5_4_1_priority: p2
b_5_4_1_notes: ""
b_6_1_1_verdict: auto
b_6_1_1_priority: p0
b_6_1_1_notes: ""
# ── new blocks the process is missing ──
new_blocks_scratch: ""
---

# Digest Automation Brainstorm

**Purpose.** Decide which changes matter to move the digest process from *mostly manual* toward the **magic-wand ideal**: round ends → digest auto-generated, LLM-edited to top-tier, and auto-posted to the league chat with a share card — no human touch. This doc walks every block of the current flow and asks: does it belong in the ideal, what would it become, how do we get there, and what's the first step. Your calls + notes are captured in the frontmatter (Meta Bind), so this file *is* the decision record.

> [!tip] How to use
> Each block has a **verdict** and **priority** picker (defaulted to my recommendation — change if you disagree) and a free-text **notes** box. Everything writes to YAML frontmatter, so you can later query/sort with Dataview.
> **Verdicts:** ✅ keep (already good / already auto) · 🤖 automate · 🚦 auto+gate (automate but keep a human checkpoint) · ✂️ cut (gone in the ideal) · 🔁 rework (redesign the block).

## ✨ The Magic-Wand Flow (ideal)

![[digest-magic-wand-flow.drawio]]

1. **Round ends** — Music League "Votes Are In" email arrives
2. **Phase auto-iterates** in mlbot (voting → complete)
3. **Round data auto-captured** — submissions · votes · vote comments
4. **Round chat auto-captured** — WhatsApp window for the round
5. **Song metadata auto-enriched** — YTM · Last.fm · audio · lyrics
6. **Digest auto-generated** — LLM drafts every section in the league's learned house style
7. **LLM self-critiques & edits to top-tier** — multi-pass, no human
8. **Standings & data auto-reconciled** — gospel verified
9. **Digest auto-finalized** — share card + interactive HTML published
10. **Auto-posted to the league's WhatsApp chat** with a share card 🎉

### Magic-wand step → current blocks

| Magic-wand step | Today's blocks | Status today |
|---|---|---|
| 1 Round ends | (ML email — external) | automated trigger exists |
| 2 Phase iterates | email poller → `complete` | ✅ automated |
| 3 Data captured | `1.3.2` import | manual click |
| 4 Chat captured | `2.2.1` paste | manual paste (flaky auto-capture) |
| 5 Metadata enriched | queue worker (checked by `1.2.1`) | ✅ automated |
| 6 Digest generated | `2.1.1` decisions + `3.2.1` LLM + `3.x` | manual decisions + auto gen |
| 7 LLM self-edit | — (replaces `4.1.1`/`4.2.1`/`4.3.1`) | **does not exist** |
| 8 Reconcile | `3.5.1` / `3.5.2` | auto-check + manual modal |
| 9 Finalize + publish | `5.2.1` / `5.2.2` / `5.3.1` | manual click |
| 10 Auto-post to chat | `6.1.1` | **manual paste** |

**The two biggest gaps:** there is no **LLM self-edit/critic** (step 7) and no **outbound auto-post** (step 10). Encoding the **generation decisions as a learned house style** (`2.1.1`) is the third pillar.

## 🔎 The Current Flow

![[workflow-generation.drawio]]

---

## Phase 1 · Prepare

### `1.1.1` — Admin opens /digest/[roundId]  🟠 manual → trigger
- **Now:** Admin manually navigates to the digest page; the loader reads the round + any existing draft and sets the stage (prepare/refine/finalize).
- **In ideal?** Reworked — there is no "open"; a round-complete event starts the pipeline.
- **Ideal form:** When `votes_are_in` flips the round to `complete`, a digest job is enqueued automatically.
- **Path to ideal:** Seed a `digest_jobs` row (or emit an event) the moment email ingest sets `phase=complete`.
- **First step:** In `emailIngest`, on the complete transition, write a "digest pending" marker for the round.

**My call:** verdict `INPUT[inlineSelect(option(keep, "✅ keep"), option(auto, "🤖 automate"), option(gate, "🚦 auto+gate"), option(cut, "✂️ cut"), option(rework, "🔁 rework")):b_1_1_1_verdict]` · priority `INPUT[inlineSelect(option(p0, "🔴 P0"), option(p1, "🟠 P1"), option(p2, "🟡 P2"), option(later, "⚪ later")):b_1_1_1_priority]`
**Your notes:** `INPUT[textArea(placeholder("ideas / notes…")):b_1_1_1_notes]`

### `1.2.1` — System runs 6 readiness checks  🟢 system
- **Now:** On load, computes metadata / submissions / votes / comments / chat-mentions / album-art checks; display only.
- **In ideal?** Yes — they become the pipeline's headless preflight gate.
- **Ideal form:** Same checks run without a page; pass → continue, fail → auto-heal (trigger import) or alert.
- **Path to ideal:** Lift the check logic out of the page route into a callable used by the job runner.
- **First step:** Extract the prepare checks into a pure function with no request dependency.

**My call:** verdict `INPUT[inlineSelect(option(keep, "✅ keep"), option(auto, "🤖 automate"), option(gate, "🚦 auto+gate"), option(cut, "✂️ cut"), option(rework, "🔁 rework")):b_1_2_1_verdict]` · priority `INPUT[inlineSelect(option(p0, "🔴 P0"), option(p1, "🟠 P1"), option(p2, "🟡 P2"), option(later, "⚪ later")):b_1_2_1_priority]`
**Your notes:** `INPUT[textArea(placeholder("ideas / notes…")):b_1_2_1_notes]`

### `1.3.1` — All checks pass?  🟡 decision
- **Now:** Derived from the checks; gates the Generate button.
- **In ideal?** Yes — an automatic branch in the job.
- **Ideal form:** pass → generate; fail → `1.3.2` auto-import then re-check.
- **Path to ideal:** Encode as a job state-machine transition.
- **First step:** Pin down which checks are *blocking* vs *warn-only*.

**My call:** verdict `INPUT[inlineSelect(option(keep, "✅ keep"), option(auto, "🤖 automate"), option(gate, "🚦 auto+gate"), option(cut, "✂️ cut"), option(rework, "🔁 rework")):b_1_3_1_verdict]` · priority `INPUT[inlineSelect(option(p0, "🔴 P0"), option(p1, "🟠 P1"), option(p2, "🟡 P2"), option(later, "⚪ later")):b_1_3_1_priority]`
**Your notes:** `INPUT[textArea(placeholder("ideas / notes…")):b_1_3_1_notes]`

### `1.3.2` — Import from CLI  🟠 manual → auto (data capture)
- **Now:** If data is missing, admin clicks Import; pulls `export.zip` via the ML CLI and imports subs/votes/comments. Depends on ML auth being valid.
- **In ideal?** Yes — magic-wand step 3, fully automatic.
- **Ideal form:** The pipeline auto-imports on demand; ML auth kept fresh by the host probe; an expired session is the one thing that pings a human.
- **Path to ideal:** Call `import-export-zip` from the job runner when checks show missing data; surface ML-auth-expired as a single alert.
- **First step:** Make `import-export-zip` callable server-side without the page, and assert ML auth before running.

**My call:** verdict `INPUT[inlineSelect(option(keep, "✅ keep"), option(auto, "🤖 automate"), option(gate, "🚦 auto+gate"), option(cut, "✂️ cut"), option(rework, "🔁 rework")):b_1_3_2_verdict]` · priority `INPUT[inlineSelect(option(p0, "🔴 P0"), option(p1, "🟠 P1"), option(p2, "🟡 P2"), option(later, "⚪ later")):b_1_3_2_priority]`
**Your notes:** `INPUT[textArea(placeholder("ideas / notes…")):b_1_3_2_notes]`

### `1.4.1` — Click "Generate draft…"  🟠 manual → auto
- **Now:** Admin clicks to open the Generate modal.
- **In ideal?** Reworked — no click; the pipeline proceeds to generation using stored defaults.
- **Ideal form:** Generation params come from a per-league config, not a modal.
- **Path to ideal:** Persist a default `GenerateParams` (league-level) the runner consumes.
- **First step:** Add a stored default `GenerateParams` seeded from the current modal defaults.

**My call:** verdict `INPUT[inlineSelect(option(keep, "✅ keep"), option(auto, "🤖 automate"), option(gate, "🚦 auto+gate"), option(cut, "✂️ cut"), option(rework, "🔁 rework")):b_1_4_1_verdict]` · priority `INPUT[inlineSelect(option(p0, "🔴 P0"), option(p1, "🟠 P1"), option(p2, "🟡 P2"), option(later, "⚪ later")):b_1_4_1_priority]`
**Your notes:** `INPUT[textArea(placeholder("ideas / notes…")):b_1_4_1_notes]`

---

## Phase 2 · Generate (decisions)

### `2.1.1` — Generate modal — decisions  🟠 manual → rework  ⭐ pillar
- **Now:** Admin picks which LLM sections to include, per-section style tags / context / layout, which data sections, season-recap, avatar regen.
- **In ideal?** Reworked — these decisions become a **learned, per-league "house style"** + rules, not chosen each round.
- **Ideal form:** A versioned `DigestStyleProfile` per league (tone, section set, layout prefs, recurring context like rivalries) that the LLM reads every time; you tweak it rarely.
- **Path to ideal:** Capture current choices into a stored profile → LLM consumes it → it learns from your edits over time.
- **First step:** Define a `DigestStyleProfile` schema and seed one per league from your usual choices.

**My call:** verdict `INPUT[inlineSelect(option(keep, "✅ keep"), option(auto, "🤖 automate"), option(gate, "🚦 auto+gate"), option(cut, "✂️ cut"), option(rework, "🔁 rework")):b_2_1_1_verdict]` · priority `INPUT[inlineSelect(option(p0, "🔴 P0"), option(p1, "🟠 P1"), option(p2, "🟡 P2"), option(later, "⚪ later")):b_2_1_1_priority]`
**Your notes:** `INPUT[textArea(placeholder("ideas / notes…")):b_2_1_1_notes]`

### `2.2.1` — Paste WhatsApp chat  🟠 manual → auto  ⭐ pillar (flaky)
- **Now:** Admin pastes the round's chat text; feeds the chat section; works around flaky auto-capture.
- **In ideal?** Yes — magic-wand step 4: chat auto-captured for the round window, no paste.
- **Ideal form:** Reliable chat capture (Android relay / bot) scoped to the round's time window, fed in automatically.
- **Path to ideal:** Harden chat capture + window it by round start/end; keep paste as a manual fallback.
- **First step:** Measure auto-capture coverage vs your pasted text for 1–2 rounds to size the gap before building.

**My call:** verdict `INPUT[inlineSelect(option(keep, "✅ keep"), option(auto, "🤖 automate"), option(gate, "🚦 auto+gate"), option(cut, "✂️ cut"), option(rework, "🔁 rework")):b_2_2_1_verdict]` · priority `INPUT[inlineSelect(option(p0, "🔴 P0"), option(p1, "🟠 P1"), option(p2, "🟡 P2"), option(later, "⚪ later")):b_2_2_1_priority]`
**Your notes:** `INPUT[textArea(placeholder("ideas / notes…")):b_2_2_1_notes]`

### `2.3.1` — Click Generate → POST /draft  🟠 manual → auto
- **Now:** Submits the modal; triggers draft generation.
- **In ideal?** Reworked — implicit; the runner calls the draft path directly.
- **Ideal form:** No button; the job runner invokes draft with the profile.
- **Path to ideal:** Expose draft generation as a server-callable with params.
- **First step:** Confirm `/draft` logic can run from a job context (no request-only deps).

**My call:** verdict `INPUT[inlineSelect(option(keep, "✅ keep"), option(auto, "🤖 automate"), option(gate, "🚦 auto+gate"), option(cut, "✂️ cut"), option(rework, "🔁 rework")):b_2_3_1_verdict]` · priority `INPUT[inlineSelect(option(p0, "🔴 P0"), option(p1, "🟠 P1"), option(p2, "🟡 P2"), option(later, "⚪ later")):b_2_3_1_priority]`
**Your notes:** `INPUT[textArea(placeholder("ideas / notes…")):b_2_3_1_notes]`

---

## Phase 3 · Draft (system + LLM)

### `3.1.1` — gatherRoundData  🟢 system
- **Now:** Assembles submissions, votes + comments, chat, rel-context, prior-round bundle for the LLM.
- **In ideal?** Yes — unchanged, just invoked headless.
- **Ideal form:** Same.
- **Path to ideal:** None beyond headless invocation.
- **First step:** n/a — already solid.

**My call:** verdict `INPUT[inlineSelect(option(keep, "✅ keep"), option(auto, "🤖 automate"), option(gate, "🚦 auto+gate"), option(cut, "✂️ cut"), option(rework, "🔁 rework")):b_3_1_1_verdict]` · priority `INPUT[inlineSelect(option(p0, "🔴 P0"), option(p1, "🟠 P1"), option(p2, "🟡 P2"), option(later, "⚪ later")):b_3_1_1_priority]`
**Your notes:** `INPUT[textArea(placeholder("ideas / notes…")):b_3_1_1_notes]`

### `3.2.1` — LLM generate sections  🟣 LLM
- **Now:** Claude (OpenRouter) drafts podium / villain / flow / consensus / quotes / chat; optional cover A/B; cost logged.
- **In ideal?** Yes (keep) — but enhanced by the self-critique pass (step 7) and the house-style profile.
- **Ideal form:** Generation reads the style profile, then a self-edit pass lifts quality.
- **Path to ideal:** Add a critique/edit pass after the first draft; feed the profile in.
- **First step:** Prototype one "editor" LLM pass that critiques + rewrites a single section against a rubric.

**My call:** verdict `INPUT[inlineSelect(option(keep, "✅ keep"), option(auto, "🤖 automate"), option(gate, "🚦 auto+gate"), option(cut, "✂️ cut"), option(rework, "🔁 rework")):b_3_2_1_verdict]` · priority `INPUT[inlineSelect(option(p0, "🔴 P0"), option(p1, "🟠 P1"), option(p2, "🟡 P2"), option(later, "⚪ later")):b_3_2_1_priority]`
**Your notes:** `INPUT[textArea(placeholder("ideas / notes…")):b_3_2_1_notes]`

### `3.3.1` — Compute data sections  🟢 system
- **Now:** standings / stats / tastemaker / next-round computed from data.
- **In ideal?** Yes (keep).
- **Ideal form:** Same.
- **First step:** n/a.

**My call:** verdict `INPUT[inlineSelect(option(keep, "✅ keep"), option(auto, "🤖 automate"), option(gate, "🚦 auto+gate"), option(cut, "✂️ cut"), option(rework, "🔁 rework")):b_3_3_1_verdict]` · priority `INPUT[inlineSelect(option(p0, "🔴 P0"), option(p1, "🟠 P1"), option(p2, "🟡 P2"), option(later, "⚪ later")):b_3_3_1_priority]`
**Your notes:** `INPUT[textArea(placeholder("ideas / notes…")):b_3_3_1_notes]`

### `3.4.1` — writeDraft  🟢 system
- **Now:** Persists draft + sections; page → refine.
- **In ideal?** Yes (keep) — persists for record/audit even when fully auto.
- **First step:** n/a.

**My call:** verdict `INPUT[inlineSelect(option(keep, "✅ keep"), option(auto, "🤖 automate"), option(gate, "🚦 auto+gate"), option(cut, "✂️ cut"), option(rework, "🔁 rework")):b_3_4_1_verdict]` · priority `INPUT[inlineSelect(option(p0, "🔴 P0"), option(p1, "🟠 P1"), option(p2, "🟡 P2"), option(later, "⚪ later")):b_3_4_1_priority]`
**Your notes:** `INPUT[textArea(placeholder("ideas / notes…")):b_3_4_1_notes]`

### `3.5.1` — Standings mismatch vs gospel?  🟡 decision
- **Now:** Compares computed standings vs stored "gospel"; flags a mismatch.
- **In ideal?** Yes (keep) — an automatic check.
- **Ideal form:** Auto-adopt computed unless a guard trips; otherwise alert.
- **First step:** Define when a mismatch is auto-adoptable vs needs a human.

**My call:** verdict `INPUT[inlineSelect(option(keep, "✅ keep"), option(auto, "🤖 automate"), option(gate, "🚦 auto+gate"), option(cut, "✂️ cut"), option(rework, "🔁 rework")):b_3_5_1_verdict]` · priority `INPUT[inlineSelect(option(p0, "🔴 P0"), option(p1, "🟠 P1"), option(p2, "🟡 P2"), option(later, "⚪ later")):b_3_5_1_priority]`
**Your notes:** `INPUT[textArea(placeholder("ideas / notes…")):b_3_5_1_notes]`

### `3.5.2` — Reconciliation modal  🟠 manual → auto+gate
- **Now:** Human adopts computed or keeps stored gospel.
- **In ideal?** Reworked — auto-reconcile by rules; human only on suspicious diffs.
- **Ideal form:** Rules auto-adopt; large/odd diffs raise a single alert.
- **Path to ideal:** Codify adoption rules + an alert channel for exceptions.
- **First step:** Log how often mismatches occur and how big, to pick a safe auto-rule.

**My call:** verdict `INPUT[inlineSelect(option(keep, "✅ keep"), option(auto, "🤖 automate"), option(gate, "🚦 auto+gate"), option(cut, "✂️ cut"), option(rework, "🔁 rework")):b_3_5_2_verdict]` · priority `INPUT[inlineSelect(option(p0, "🔴 P0"), option(p1, "🟠 P1"), option(p2, "🟡 P2"), option(later, "⚪ later")):b_3_5_2_priority]`
**Your notes:** `INPUT[textArea(placeholder("ideas / notes…")):b_3_5_2_notes]`

---

## Phase 4 · Refine (review / iterate)

### `4.1.1` — Review rendered digest  🟠 manual → auto+gate  ⭐ pillar
- **Now:** Human reads the whole digest in the export frame.
- **In ideal?** Reworked — the LLM self-critique (step 7) replaces routine review; the human becomes an *optional* spot-check.
- **Ideal form:** An LLM "editor" scores/flags each section against a quality rubric; a human reviews only flagged sections or a sample.
- **Path to ideal:** Build the rubric + critic; route only low-confidence sections to a human.
- **First step:** Write the **quality rubric** — what "top-tier" means per section. Everything downstream depends on it.

**My call:** verdict `INPUT[inlineSelect(option(keep, "✅ keep"), option(auto, "🤖 automate"), option(gate, "🚦 auto+gate"), option(cut, "✂️ cut"), option(rework, "🔁 rework")):b_4_1_1_verdict]` · priority `INPUT[inlineSelect(option(p0, "🔴 P0"), option(p1, "🟠 P1"), option(p2, "🟡 P2"), option(later, "⚪ later")):b_4_1_1_priority]`
**Your notes:** `INPUT[textArea(placeholder("ideas / notes…")):b_4_1_1_notes]`

### `4.2.1` — Review & iterate loop  🟠 manual → rework  ⭐ pillar
- **Now:** Human regenerates whole/section (steer chips + instructions), picks cover A/B, inline-edits prose, locks/excludes/reorders, edits standings figures.
- **In ideal?** Reworked — an automated **self-edit loop**: critic flags → targeted regen → re-score, until the rubric passes or a cost budget is hit.
- **Ideal form:** Closed-loop generate → critique → regen with a cost ceiling; human edits are the exception and are captured to improve the profile.
- **Path to ideal:** Wire critic verdicts into the existing per-section regen; cap iterations/cost; learn from any human edits.
- **First step:** Drive the existing per-section regenerate from critic feedback on ONE section as a proof of concept.

**My call:** verdict `INPUT[inlineSelect(option(keep, "✅ keep"), option(auto, "🤖 automate"), option(gate, "🚦 auto+gate"), option(cut, "✂️ cut"), option(rework, "🔁 rework")):b_4_2_1_verdict]` · priority `INPUT[inlineSelect(option(p0, "🔴 P0"), option(p1, "🟠 P1"), option(p2, "🟡 P2"), option(later, "⚪ later")):b_4_2_1_priority]`
**Your notes:** `INPUT[textArea(placeholder("ideas / notes…")):b_4_2_1_notes]`

### `4.3.1` — Happy with draft?  🟠 manual gate
- **Now:** Human gate before finalize.
- **In ideal?** Reworked — auto-approve when the rubric score ≥ threshold; optional human gate per league.
- **Ideal form:** The quality gate is a score; below threshold → loop or escalate.
- **Path to ideal:** Define the threshold; allow a per-league "auto-publish vs hold for me" choice.
- **First step:** Add a per-league **auto-publish toggle** (default off) so you opt in once trust is earned.

**My call:** verdict `INPUT[inlineSelect(option(keep, "✅ keep"), option(auto, "🤖 automate"), option(gate, "🚦 auto+gate"), option(cut, "✂️ cut"), option(rework, "🔁 rework")):b_4_3_1_verdict]` · priority `INPUT[inlineSelect(option(p0, "🔴 P0"), option(p1, "🟠 P1"), option(p2, "🟡 P2"), option(later, "⚪ later")):b_4_3_1_priority]`
**Your notes:** `INPUT[textArea(placeholder("ideas / notes…")):b_4_3_1_notes]`

---

## Phase 5 · Finalize & Export

### `5.1.1` — Export format?  🟡 decision → auto
- **Now:** Human picks PDF / PNG / Wide / Sections / Share.
- **In ideal?** Reworked — a fixed default set (HTML share + card image) is auto-produced.
- **Ideal form:** Pipeline always produces the share card + HTML; other formats on demand.
- **First step:** Decide the canonical auto-output set for chat posting.

**My call:** verdict `INPUT[inlineSelect(option(keep, "✅ keep"), option(auto, "🤖 automate"), option(gate, "🚦 auto+gate"), option(cut, "✂️ cut"), option(rework, "🔁 rework")):b_5_1_1_verdict]` · priority `INPUT[inlineSelect(option(p0, "🔴 P0"), option(p1, "🟠 P1"), option(p2, "🟡 P2"), option(later, "⚪ later")):b_5_1_1_priority]`
**Your notes:** `INPUT[textArea(placeholder("ideas / notes…")):b_5_1_1_notes]`

### `5.2.1` — Finalize & export  🟠 manual → auto
- **Now:** Renders the chosen format, sets `finalized_at`, stamps sections, runs rel-context update.
- **In ideal?** Yes — auto-invoked once the quality gate passes.
- **First step:** Call finalize from the runner after the gate.

**My call:** verdict `INPUT[inlineSelect(option(keep, "✅ keep"), option(auto, "🤖 automate"), option(gate, "🚦 auto+gate"), option(cut, "✂️ cut"), option(rework, "🔁 rework")):b_5_2_1_verdict]` · priority `INPUT[inlineSelect(option(p0, "🔴 P0"), option(p1, "🟠 P1"), option(p2, "🟡 P2"), option(later, "⚪ later")):b_5_2_1_priority]`
**Your notes:** `INPUT[textArea(placeholder("ideas / notes…")):b_5_2_1_notes]`

### `5.2.2` — Publish share link (HTML)  🟠 manual → auto
- **Now:** Renders the interactive HTML to a public host; returns a stable URL.
- **In ideal?** Yes — always auto-published.
- **First step:** Ensure publish is callable headless and returns the URL for posting.

**My call:** verdict `INPUT[inlineSelect(option(keep, "✅ keep"), option(auto, "🤖 automate"), option(gate, "🚦 auto+gate"), option(cut, "✂️ cut"), option(rework, "🔁 rework")):b_5_2_2_verdict]` · priority `INPUT[inlineSelect(option(p0, "🔴 P0"), option(p1, "🟠 P1"), option(p2, "🟡 P2"), option(later, "⚪ later")):b_5_2_2_priority]`
**Your notes:** `INPUT[textArea(placeholder("ideas / notes…")):b_5_2_2_notes]`

### `5.3.1` — System render + finalize side-effects  🟢 system
- **Now:** Puppeteer render, `finalized_at`, stamp sections 'passed', LLM rel-context update (failure-isolated).
- **In ideal?** Yes (keep).
- **First step:** n/a — works; just keep the rel-context failure isolated.

**My call:** verdict `INPUT[inlineSelect(option(keep, "✅ keep"), option(auto, "🤖 automate"), option(gate, "🚦 auto+gate"), option(cut, "✂️ cut"), option(rework, "🔁 rework")):b_5_3_1_verdict]` · priority `INPUT[inlineSelect(option(p0, "🔴 P0"), option(p1, "🟠 P1"), option(p2, "🟡 P2"), option(later, "⚪ later")):b_5_3_1_priority]`
**Your notes:** `INPUT[textArea(placeholder("ideas / notes…")):b_5_3_1_notes]`

### `5.3.2` — Copy share URL  🟠 manual → cut
- **Now:** Human clicks copy.
- **In ideal?** Cut — the URL flows straight into the auto-post; no human copy.
- **First step:** Pass the publish URL directly into the posting step.

**My call:** verdict `INPUT[inlineSelect(option(keep, "✅ keep"), option(auto, "🤖 automate"), option(gate, "🚦 auto+gate"), option(cut, "✂️ cut"), option(rework, "🔁 rework")):b_5_3_2_verdict]` · priority `INPUT[inlineSelect(option(p0, "🔴 P0"), option(p1, "🟠 P1"), option(p2, "🟡 P2"), option(later, "⚪ later")):b_5_3_2_priority]`
**Your notes:** `INPUT[textArea(placeholder("ideas / notes…")):b_5_3_2_notes]`

### `5.4.1` — Browser auto-downloads files  🟢 system → cut
- **Now:** Files download to the admin's browser for manual posting.
- **In ideal?** Cut — no downloads; the pipeline holds the artifact and posts it.
- **First step:** Have finalize return artifact paths to the runner instead of a browser download.

**My call:** verdict `INPUT[inlineSelect(option(keep, "✅ keep"), option(auto, "🤖 automate"), option(gate, "🚦 auto+gate"), option(cut, "✂️ cut"), option(rework, "🔁 rework")):b_5_4_1_verdict]` · priority `INPUT[inlineSelect(option(p0, "🔴 P0"), option(p1, "🟠 P1"), option(p2, "🟡 P2"), option(later, "⚪ later")):b_5_4_1_priority]`
**Your notes:** `INPUT[textArea(placeholder("ideas / notes…")):b_5_4_1_notes]`

---

## Phase 6 · Share

### `6.1.1` — Paste into WhatsApp  🔴 manual → auto  ⭐ pillar (the headline target)
- **Now:** Human opens WhatsApp and pastes the image / URL into the league chat.
- **In ideal?** Yes — magic-wand step 10: auto-posted with a share card.
- **Ideal form:** The pipeline posts the card + link to the league's chat via an outbound WhatsApp path (bot/relay), using a per-league chat mapping.
- **Path to ideal:** Establish outbound WhatsApp posting + a league→chat-id mapping; post card + URL.
- **First step:** Confirm a feasible **outbound** WhatsApp channel (the bot can *send*; the Android relay is inbound) and map each league to its chat id.

**My call:** verdict `INPUT[inlineSelect(option(keep, "✅ keep"), option(auto, "🤖 automate"), option(gate, "🚦 auto+gate"), option(cut, "✂️ cut"), option(rework, "🔁 rework")):b_6_1_1_verdict]` · priority `INPUT[inlineSelect(option(p0, "🔴 P0"), option(p1, "🟠 P1"), option(p2, "🟡 P2"), option(later, "⚪ later")):b_6_1_1_priority]`
**Your notes:** `INPUT[textArea(placeholder("ideas / notes…")):b_6_1_1_notes]`

---

## ➕ New blocks (things the process is missing)

The magic-wand flow implies blocks the current process doesn't have yet. Jot ideas here; when one firms up, copy the block template below into the right phase and give it a `ref` like `7.1.1`.

**Scratchpad:** `INPUT[textArea(placeholder("e.g. 'LLM critic/rubric step', 'per-league style profile editor', 'outbound WhatsApp poster', 'digest job queue + scheduler'…")):new_blocks_scratch]`

Strongest candidates I'd nominate (from the gaps above):
- **LLM critic + quality rubric** (powers steps 4.1.1 / 4.2.1 / 7) — the single highest-leverage new block.
- **Per-league house-style profile** (powers 2.1.1) — encodes your generation decisions so they're not made each round.
- **Outbound WhatsApp poster + league→chat map** (powers 6.1.1) — the last-mile auto-post.
- **Digest job queue + scheduler** (powers 1.1.1 trigger) — the spine that runs the whole thing unattended.

> [!note] Block template (copy me)
> ### `R.E.F` — Title  type
> - **Now:** …
> - **In ideal?** …
> - **Ideal form:** …
> - **Path to ideal:** …
> - **First step:** …
>
> **My call:** verdict … · priority …
> **Your notes:** …
> *(then add `R.E.F._verdict / _priority / _notes` keys to frontmatter)*

---

## North star & overall notes

**North star (one sentence):** `INPUT[textArea(placeholder("In one sentence, what does 'done' look like?")):north_star]`

**Overall notes / open questions:** `INPUT[textArea(placeholder("cross-cutting thoughts, sequencing, risks…")):overall_notes]`
