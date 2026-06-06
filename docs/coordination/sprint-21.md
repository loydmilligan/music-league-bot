---
project: music-league-bot
sprint: sprint-21-season-recap
created: 2026-06-06T00:00:00Z
updated: 2026-06-06T00:00:00Z
status: active
---

# music-league-bot — coordination doc (sprint-21-season-recap)

> **Add a "Season recap" generation MODE to the digest.** Approved spec:
> `~/.config/taw/wiki/Projects/music-league-bot/digest-season-recap-spec.md`
> (read it — §2 context strategy, §4 gen/regen + per-section table).
>
> A **"Season recap"** checkbox on GenerateModal (default OFF) re-renders the
> existing digest sections at **season scope** (rounds ≤ this digest's round). A
> **"Final recap"** sub-toggle (default ON; mid-season when OFF) drives
> framing/tense ("champion"/past tense vs "season so far, through R{N}"). It
> **reuses the existing generate pipeline** — recap mode swaps round-data → a
> **per-section server-computed season slice** and the per-section prompt → its
> **recap variant**, gated by the checkbox.
>
> **Context strategy (decided):** per-section season slices — NOT a raw season
> dump, NOT digest-of-digests. Each LLM section gets only the compact slice it
> needs (podium ← season top-N by points; villain ← most-downvoted; consensus ←
> low-variance high scorers; quotes ← ranked vote comments; flow ← round-by-round
> standings progression + themes). Data sections: standings → champion/through-N,
> stat-strip → season totals, tastemaker → already season-scoped (final framing);
> **next-round dropped** in recap mode. **chat stays a manual paste box** (blank →
> skip). Recap is **orthogonal to format** → flows through web + the sprint-20
> `html` share + PNG/pdf automatically (no per-format work).
>
> Roster: **backend** (season-aggregation + recap prompts/wiring + data-section
> framing) + **frontend** (the modal controls). **viz idle.** **NOT in this
> sprint:** new recap-only sections (season superlatives), auto-detecting
> season-complete, WhatsApp-sourced chat. Exact prompt wording + top-N/metric
> thresholds are the implementing agent's call (user reviews the output).

## Sprint Goals

Turn any digest into a season recap
One checkbox re-renders every section across the whole season.

## Active Sprint Plan

- [x] {agent: backend, id: season-aggregation} Build the **season-aggregation layer** (the foundation for recap mode) — e.g. `gatherSeasonData(db, roundId)` + per-section **season slice builders**, all scoped to rounds ≤ the given round (cumulative, sprint-14 model). Slices: **podium** (season top-N songs by total points: artist/title/submitter/round/points), **villain** (most-downvoted / lowest-net songs + any recurring low-scorer), **consensus** (broadest-agreement picks: low vote-variance + high score), **quotes** (the season's vote comments, ranked), **flow** (round-by-round standings progression + round themes), **stat-strip** (season totals: songs/votes/rounds/players/biggest round). Pure data — no LLM. Pick sensible top-N/metric defaults (tunable later).
  - **Acceptance:** the slice builders return correct, populated shapes for **Hip Jammers S2 (season_id 5, rounds ≤ 95)** — podium ranked by cumulative points, villain/consensus/quotes/flow/stat-strip grounded in real numbers (spot-check a couple against the DB); covered by a unit test or a documented harness run. `npm run check` passes. Shapes recorded in the Activity Log for recap-generate-wiring.

- [ ] {agent: backend, id: recap-generate-wiring, depends: season-aggregation} Add **recap mode** to the generate pipeline. Add a `SECTION_DESCRIPTIONS_RECAP` map (recap-variant prompt per LLM section: podium=season standout tracks; flow=narrate the season's arc; villain=season villain; consensus=season consensus darlings; quotes=best season vote-comment lines; chat=season highlights from pasted transcript). Thread a **`recap: { enabled, final }`** flag through `GenParams` → `buildUserPrompt` → `generateDraft` → `regenerateOneSection`: when `enabled`, feed the **season slices** (not round data) + the recap prompt, and apply **final/mid framing** (tense, "champion" vs "current leader"). chat uses pasted text; skip if blank. Reuse the existing `/draft` route (extend its body, no new route).
  - **Acceptance:** `POST /api/digest/95/draft` with `{ recap:{enabled:true, final:true} }` returns **season-spanning** podium/flow/villain/consensus/quotes content (verifiably about the whole season, not just r95); `final:false` visibly shifts framing to "through R95 / so far"; `regenerateOneSection` works per-section in recap mode; chat section appears only when pasted text is supplied. `npm run check` passes; deployed; a sample recap output noted in the Activity Log.

- [ ] {agent: backend, id: data-section-recap-framing, depends: season-aggregation} Apply recap framing to the **data sections** (no LLM): **standings** → "FINAL STANDINGS · Champion: X" when `final`, "Standings through R{N}" when mid (reuse cumulative standings); **stat-strip** → season totals (from the stat-strip slice); **tastemaker** → reuse the existing season-scoped payload with a "final" heading; and **drop `next-round`** in recap mode. Heading/copy + the season aggregates — keep each section's existing visual component. Can run in parallel with recap-generate-wiring.
  - **Acceptance:** in recap mode for **HJ S2 r95**: standings shows final standings + the champion (and "through R95" when `final:false`); stat-strip shows season totals; tastemaker renders with final framing; **next-round is absent**. `npm run check` passes; deployed; verified on prod.

- [ ] {agent: frontend, id: recap-modal-controls} GenerateModal recap controls (build against the contract in parallel). Add a **"Season recap"** checkbox (**default OFF**); when ON, reveal a **"Final recap"** sub-toggle (**default ON**). Keep the **chat paste box** (blank → skip chat). Show a **recap badge** reflecting state ("Season recap · final" / "· so far"). Pass **`recap: { enabled, final }`** through `GenerateParams` to `POST /draft` alongside the existing per-section toggles + `pastedChat`.
  - **Acceptance:** the modal shows the "Season recap" checkbox (default OFF); enabling it reveals "Final recap" (default ON); toggling drives the badge text; the `recap` flags are included in the `/draft` request body (verify in the network call); chat-paste behavior intact. `npm run check` passes; deployed; mobile + desktop visual check logged.

- [ ] {agent: frontend, id: recap-e2e, depends: recap-generate-wiring,data-section-recap-framing,recap-modal-controls} **End-to-end recap.** Generate a real **Hip Jammers S2 r95 FINAL recap** via the modal and verify the whole thing; also spot-check a **mid-season** recap framing. Confirm recap content flows through **web + the `html` share export**.
  - **Acceptance:** via the modal, a HJ S2 r95 **final** recap renders season-spanning standings(+champion)/podium/flow/villain/consensus/quotes/tastemaker with **no next-round**, and reads coherently as a season recap; flipping **"Final recap" OFF** shifts the copy to "through R95 / so far"; the recap renders in the **web view AND the `html` share** (`digest.mattmariani.com/d/<slug>`). `npm run check` passes; screenshots + the generated recap logged → closes sprint-21.

### Deploy

Deploy per `CLAUDE.md` (fast — chromium base, sprint-19): `docker compose build --no-cache bot-ui && docker compose up -d --force-recreate bot-ui`, smoke `192.168.4.217:3002`. **Serialize deploys.** Recap mode is an upstream generation change, so it needs no per-format work — the `html` share + PNG/pdf inherit it.

---

## Agent Roster

| Agent | Owns | Does not touch |
|---|---|---|
| backend | the season-aggregation layer + slice builders, recap prompts (`SECTION_DESCRIPTIONS_RECAP`) + recap-mode generate wiring (`llm.ts`, the `/draft` route, final/mid framing), the data-section recap framing | the GenerateModal UI |
| frontend | the GenerateModal recap controls (checkbox + sub-toggle + chat-input + badge) + passing `recap` flags, the recap e2e | the generate pipeline / prompts / aggregation, the data-section payloads |
| viz | _idle this sprint — no tasks_ | — |

---

## Decision Log

- **D1** — Recap is a **generation MODE**, not a new section/`DigestKind`. It swaps each section's data scope + prompt; gated by a checkbox (default OFF).
- **D2** — Context = **per-section server-computed season slices** (grounded, token-light); not raw dump, not digest-of-digests.
- **D3** — **Final recap** sub-toggle (default ON) drives framing/tense only; data is always cumulative through the digest's round (supports mid-season recaps).
- **D4** — **chat** stays a manual paste box (blank → skip); no WhatsApp dependency this sprint.
- **D5** — Recap is **orthogonal to format**; it flows through web + the sprint-20 `html` share + PNG/pdf with no per-format work. `next-round` is dropped in recap mode.
- **D6** — Exact prompt wording + top-N/metric thresholds are the implementing agent's call; user reviews the generated output (HJ S2 r95 is the first real test).

## Blockers

## Activity Log

### 2026-06-06 — backend — season-aggregation DONE → **recap-generate-wiring + data-section-recap-framing unblocked**
New file **`ui/src/lib/db/seasonData.ts`** — pure data, no LLM. Entry: **`gatherSeasonData(db, roundId): SeasonData`**, scoped to rounds ≤ roundId (cumulative, sprint-14 model; reuses `computeStandings` for the per-round progression + champion). Single `seasonSongs()` pass (cumulative points + voter count + agreement variance per submission) backs podium/villain/consensus; `competitor_id IS NOT NULL`, no track filter (matches standings' point math).

**Defaults (tunable consts at top of file):** PODIUM_TOP_N=8, VILLAIN_TOP_N=6, CONSENSUS_TOP_N=6, QUOTES_POOL_N=25, RECURRING_MIN_SUBS=3, RECURRING_TOP_N=3.

**`SeasonData` shape (for recap-generate-wiring + data-section-recap-framing):**
- `context`: `{ seasonId, seasonNumber, league{id,name}, seasonLabel ("Hip Jammers S2"), roundId, throughRound, totalRounds, rounds:[{id,number,name}], champion:{name,total}|null, relContext }` — `throughRound`/`champion` drive final-vs-mid framing.
- `podium.songs[]`: `{ rank, artist, title, album, submitter, round (theme name), roundNumber, points, voters }` — season top-N by cumulative points DESC.
- `villain`: `{ lowest[]: {artist,title,album,submitter,round,roundNumber,points,voters} (lowest-net; no downvotes in this league → lowest points asc), recurringLowScorers[]: {submitter, avgPoints, submissions, worstSong{title,points}} }`.
- `consensus.songs[]`: `{ artist,title,submitter,round,roundNumber,points,voters,mean,variance }` — high-score (≥ season median) + broad/even support (voters DESC, variance ASC).
- `quotes.comments[]`: `{ voter, song, artist, round, points, comment }` — ranked pool of ≤25 season vote-comments (by substance/length; LLM picks).
- `flow`: `{ rounds[]: {number,name,leader,leaderTotal,topSong{title,artist,submitter,points}}, leadChanges, finalLeader }` — round-by-round cumulative standings + themes.
- `statStrip`: `{ songs, votes, rounds, players, totalPointsAwarded, avgVotesPerRound, biggestRound{number,name,totalVotes} }`.

**Verified — HJ S2 (season_id 5, rounds ≤ 95), documented harness run, spot-checks vs DB all ✓:**
- context: through 10/10, champion **lorimariani (233)**; stat-strip: **97 songs / 636 votes / 10 rounds / 10 players**, biggest round Primetime (73 votes).
- podium #1 **"1979 — Remastered 2012" / Smashing Pumpkins / lorimariani / 32pts**, monotonic-desc (32,30,30,29,28,28,26,26).
- villain.lowest #1 **"Gimme! Gimme! Gimme!" jellydru 2pts**; recurringLowScorers jellydru(avg 8.86)→Kristin(11.5)→Mashew(14.6).
- consensus top "Song 2" 29pts/10 voters/var 2.69 (broad+even); flow: Ronm led R1 → lorimariani R2–R10, **leadChanges=1**, finalLeader==champion.
- `npm run check` → 0 errors (578 files). Harness was throwaway (removed). Data-only deliverable + new source file (committed).

### 2026-06-06 — docs — Sprint plan created: season-recap (sprint-21)
- 5 tasks: season-aggregation → (recap-generate-wiring ∥ data-section-recap-framing) [backend]; recap-modal-controls [frontend, parallel] → recap-e2e [frontend]
- 4 backend-or-frontend / 1 e2e; viz idle; spec-driven (`digest-season-recap-spec.md`, approved)
- deps: recap-generate-wiring & data-section-recap-framing ← season-aggregation (need the slices); recap-e2e ← the two backend tasks + the modal. Kickoff = season-aggregation (backend) ∥ recap-modal-controls (frontend) in parallel
- methodology: testing none / review none — no TDD/review scaffolding; acceptance gates on `npm run check` + prod generation of a real HJ S2 r95 recap
- reuses the existing generate pipeline (gatherRoundData→season slices; SECTION_DESCRIPTIONS→recap variant); recap is orthogonal to format so html-share/PNG inherit it
- sprint-20 (html-share) closed + pushed so the warren advances here
