---
title: End-of-Round Process — Round Transition + Digest Generation
aliases:
  - end-of-round-process
  - round-ending-walkthrough
  - how-to-end-a-round
type: doc
doc_type: how-to
project: music-league-bot
status: draft
created: 2026-06-16
related:
  - "[[round-phase-and-action-center-spec]]"
  - "[[digest-html-share-spec]]"
tags:
  - music-league-bot
  - how-to
  - digest
  - rounds
  - phase
  - process
parent:
  - - music-league-bot
---

# End-of-Round Process — Round Transition + Digest Generation

> [!warning] This is the process **as of 2026-06-16**, and it is provisional
> It describes what to do **by hand** today, against the **current data** (Fam-Jam
> Season 4, round **119** "They covered that?" just closed; round **120** "Pick Me Up"
> is next). It will almost certainly change: the **Action Center** (see
> [[round-phase-and-action-center-spec]]) is designed to turn "End Voting" into a
> trigger that auto-emits a content-todo card and walks these steps for you. Until
> that half ships, the loop lives in your head — this note is the stand-in for it.

## Scope

Covers only the **round transition** and **digest generation**. Creating the
**B-side archive** is part of the full content loop but is **stubbed** below for now.

---

## Steps (current situation — r-119, Fam-Jam S4)

No explanation here — just what to do, in order:

1. Home → **Active rounds** → Fam-Jam slot → **End Voting Phase** → confirm.
2. Go to **Content → Digest**, pick **`r-119 · They covered that?`** in the dropdown.
3. Click **Import** (pulls round 119's submissions + votes from Music League).
4. Confirm all required prep checks are **green** on the **r-119** row.
5. Click **Generate**.
6. Refine sections as needed → **Finalize & export**.
7. *(Later, separate, not required for the digest)* advance the active round to 120.
8. *(Stub — see below)* create the B-side archive.

---

## The same steps, explained

Each callout's **title is the action**; expand it for what's actually happening and why.

> [!note]- Step 1 — End Voting on round 119 (Home → Active rounds → Fam-Jam → "End Voting Phase" → confirm)
> This flips round 119's stored phase `voting → complete` and **nothing else**. It does
> *not* import data, generate a digest, or advance the active round. It also hands you
> round 120's submission deadline as a *suggested prefill* (convenience only).
>
> In the designed (not-yet-built) world this click is the **trigger** that emits the
> "process this round" content-todo card. Today it's just a state flag — but doing it
> first is the right move: it's the clean "this round is closed" signal and matches the
> intended flow. The button only appears while the round is in `voting`, so once you
> click it, it's gone.

> [!note]- Step 2 — Open the round-119 digest (Content → Digest → select `r-119 · They covered that?`)
> The digest screen is round-scoped via the dropdown; selecting r-119 points every
> action on the page (import, prep checks, generate) at round 119. `active_round_id`
> being stuck on 119 is irrelevant here — digest work keys off the dropdown selection,
> not the league's active round.

> [!note]- Step 3 — Click Import (pulls round 119's submissions + votes from Music League)
> **This is the step that actually unblocks the digest.** "End Voting" gave you nothing
> toward content — round 119 has **0 submissions / 0 votes** locally until this runs. The
> Import button triggers the host-side Music League CLI, downloads a fresh `export.zip`
> that now includes the just-closed round, and loads it through the import pipeline.
>
> The button only shows when the export-derived checks (Submissions/Votes/Vote-comments)
> are failing — which they are for a freshly-closed round. It has **no phase gate**, so it
> works before or after Step 1. **Prerequisite:** voting must actually be closed on
> musicleague.com first, or the export won't carry final votes. If it fails on auth, stop
> and re-establish Music League auth before retrying.

> [!note]- Step 4 — Confirm the prep checks are green on the r-119 row
> Required checks: **Round metadata**, **Submissions**, **Votes**, **Vote comments**.
> (Chat-window mentions is *optional*; Album art follows from submissions.)
>
> - **Round metadata** = "does this round have a theme description." Round 119 already has
>   its 296-char blurb, so this is **green before you import** — it is *not* your blocker.
> - **Submissions / Votes / Vote comments** turn green once Step 3's import lands the data.
>
> Watch for one thing: make sure the green row is **`r-119`** and there isn't a *second*
> "They covered that?" entry. A description-less duplicate is the classic trap from
> manually-created active rounds — but round 119 is properly linked to its Music League
> round-id, so the import updates it in place rather than spawning a twin. If a duplicate
> ever does appear, **stop**.

> [!note]- Step 5 — Click Generate
> Builds the LLM digest from the imported round data plus the cross-round bundle. The only
> real gate is the prep checks above (data present) — there is **no hard voting-phase
> gate**. You may see a soft "voting still open · digest may change" banner; that's
> deadline-based and informational, not a block. The cross-round bundle now reads round
> numbers correctly because the S4 rounds were backfilled (practice = 0, r-119 = 1, …).

> [!note]- Step 6 — Refine sections, then Finalize & export
> Regenerate or hand-edit individual sections, then finalize and export in your preferred
> format. Finalizing is also the signal the (future) Action Center will watch to
> auto-resolve the round's content-todo card.

> [!note]- Step 7 — Advance the active round to 120 (separate; not required for the digest)
> Independent of the digest and safe to defer. Note there is **no "Start Submission"
> button** — phase only moves *forward* via End Submission / End Voting. After Step 1, the
> Active-rounds card auto-derives the slot to round 120 but shows it as **UPCOMING**, and
> merely pinning it via "Set active round" does **not** move it into `submission`. How a
> round cleanly enters the submission phase in the current build is still being pinned
> down — treat this as a known open question, not an improvisation to make on prod. When
> you do set up 120, **choose the existing round 120**, never "create new" (duplicate-round
> trap).

> [!todo]- Step 8 — Create the B-side archive *(STUB — to be written)*
> Placeholder. The B-side archive step of the content loop will be documented here later.
> For now this note covers only the round transition and digest generation.

---

## Why this exists / will change

The manual sequence above is exactly the content-todo the **Action Center** is designed to
hand you automatically when you click "End Voting" (generate digest → update archive →
share, auto-resolving on finalize). The phase-model half shipped (sprint-34); the Action
Center half has not. Revisit this note when that lands — most of these steps should
collapse into following a card. See [[round-phase-and-action-center-spec]].
