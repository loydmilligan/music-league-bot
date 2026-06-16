---
project: music-league-bot
sprint: sprint-35
roadmapItem: digest-round-aware-context
title: Stop the digest citing future rounds
status: closed
created: 2026-06-16T07:09:20Z
activated: 2026-06-16
updated: 2026-06-16T21:15:30Z
---

# music-league-bot — coordination doc (sprint-35)

> **Digest round-aware cross-round context — the "ghost" fix.** Regenerating an
> old round's digest miscites FUTURE-round songs/people as "last round" (an R3
> digest cited R5's "Cottonfield Blues" + "Johnny Lang"). **RCA resolved:** the
> deterministic chronology is already correct (`priorRounds = slice(0, seqIdx)`
> ordered by `round_number`; a chronology block already forbids forward refs) —
> the SOLE leak is the league-level `relationship_contexts` blob (PRIMARY KEY
> `league_id`, one forward-accumulated row) injected raw at `llm.ts:168`/`:424`.
> Regenerating R3 after R6 reads the post-R6 blob, so future narrative is right
> there to miscite. **Approach C (owner-ratified 2026-06-16):** (1) a deterministic
> per-round factual bundle owns all cross-round citations; (2) the narrative blob
> is kept but scoped to ≤ current round; (3) the prompt cites the bundle only —
> ghosts kept, bundle-cite-only, forward refs forbidden. Foundation for the b-side
> cards. Design: vault `2026-06-15-digest-cross-round-context-bundle.md` (RCA +
> decisions) and roadmap card `digest-round-aware-context`.

## Sprint Goals

Stop the digest citing future rounds

Regenerated digests cite only what came before — no ghosts.

## Agent Roster

| Agent | Owns | Does not touch |
|---|---|---|
| backend | `$lib/digest/*` (`llm.ts`, `relContext.ts`), the digest generation context + prompts, `$lib/db/*` reads, digest tests | Svelte components, page routes |
| frontend | (idle this sprint — no UI change; available for a verification screenshot if asked) | — |
| orc | sprint gate: cross-check, checks + tests, the **content-review checkpoint** (regenerate R3 + surface before/after), version + CHANGELOG, deploy, close | project code |

## Working agreements (sprint-35)

- **The blob is the only un-scoped input — don't widen the leak.** The fix scopes
  it; do not add new un-scoped season-wide context to generation.
- **No content ships to a league without owner review.** This changes generated
  digest content; the gate regenerates the R3 villain section on **dev** and
  surfaces a before/after for owner ratification against the quality bar
  (≤1–2 minor errors, 0 major, ≥2 compelling) **before** any prod deploy.
- **Dev loop, not prod-per-change.** `npm run dev` (5173) + `npm run check`; one
  orc-gated deploy at the gate, after owner content sign-off. Never serve on 4444.
- **Cheap model for regeneration checks** — digests run on `OPENROUTER_DIGEST_MODEL`
  (haiku-4.5); keep regen-for-verification on the cheap model.

## Active Sprint Plan

<!-- Task syntax (parser contract):
     - [ ] {agent: <roster>, id: <slug>, depends: <id,id>} Body
       - **Acceptance:** verifiable check.
     Status marks: [ ] pending · [-] in-progress · [x] done · [!] blocked.
     `agent:` must match the Agent Roster. `depends:` is one comma-separated key. -->

- [x] {agent: backend, id: bundle} **Deterministic cross-round factual bundle.** In `llm.ts` generation, build a per-round bundle for every round with `round_number <= current`: `{round_number, name, top3: [{song, submitter, points}], bottom1, winner}`, ordered, with prev/current flagged. This becomes the single source of cross-round FACTS, replacing the thin `priorRounds {number, name}`.
  - **Acceptance:** generating round N produces a bundle containing only rounds ≤ N, correctly ordered by `round_number`; each prior round carries top3/bottom1/winner computed from votes; `npm run check` 0 errors.

- [x] {agent: backend, id: prompt-cite, depends: bundle} **Prompt: cite the bundle only.** Rewrite the chronology + relationship-context prompt sections in `llm.ts` so every cross-round reference must come from the bundle; forbid forward references and invented callbacks; keep the ghost/callback voice but bundle-cite-only.
  - **Acceptance:** the assembled prompt presents the bundle as the cross-round source and instructs bundle-cite-only + no forward refs; the raw league blob is no longer the cross-round fact source; `npm run check` 0.

- [x] {agent: backend, id: relctx-scope} **Scope the narrative blob to ≤ current round.** Stop feeding the live league `relationship_contexts` blob into an old round's (re)generation. Read the round-scoped version instead — per-round snapshot (`digest_drafts.rel_context` already exists) and/or filter/key narrative to rounds ≤ current. First-gen uses current; regen of round N uses the N-era context, never the live latest.
  - **Acceptance:** regenerating an early round (R3, Second Best s8) does NOT inject any narrative derived from later rounds (R4–R6); a unit test asserts the round-N rel-context excludes later-round material; `npm run check` 0.

- [x] {agent: backend, id: tests, depends: bundle,prompt-cite,relctx-scope} **Tests + ghost regression.** Unit-cover: bundle scoping (round-N bundle contains only rounds ≤ N), rel-context scoping (regen of an early round excludes later-round narrative), and a regression pinning the R3-cites-R5 ghost (asserting no future-round attribution surfaces given R3 inputs).
  - **Acceptance:** new tests green; full `vitest run` green; the R3-ghost regression fails against the old code path and passes against the new; `npm run check` 0.

- [x] {agent: orc, id: gate, depends: bundle,prompt-cite,relctx-scope,tests} **Gate — verify content, ship, close.** Cross-check lanes; `npm run check` + full `vitest run`; **regenerate the R3 "villain" section (Second Best s8) on dev and surface a before/after to the owner** for ratification against the quality bar (no R4–R6 attributions; ≤1–2 minor / 0 major / ≥2 compelling). **Only on owner sign-off:** version bump + CHANGELOG, deploy, then close. If the owner flags remaining ghosts, file the gap and keep the doc open.
  - **Acceptance:** 0 typecheck errors + vitest green; before/after of the R3 section delivered to owner; owner ratifies content quality; v-bump + CHANGELOG committed; deployed + v live on `mlbot2.mattmariani.com`; doc `status: closed`.

## Decision Log

### 2026-06-16 — Approach C (hybrid), owner-ratified
Deterministic factual bundle owns cross-round citations; narrative blob kept but
scoped to ≤ current round; ghosts kept, bundle-cite-only. RCA confirmed: sole leak
is the un-scoped per-league `relationship_contexts` blob (`llm.ts:168`). The full
accumulating narrative *channel* stays the separate `bside-digest-context-channel`
card; this sprint scopes the existing blob + adds the factual bundle.

## Ratification Log

### 2026-06-16 — owner signed off the regenerated R3 section → "ship it"
Gate regenerated the R3 villain section (Second Best s8) on dev. Independent scan +
owner review: **0 future-round ghosts** (no "Cottonfield Blues" / "Johnny Lang" /
forward "last round" / "ghost of Round N"), current-round facts correct, 0 major /
~2 minor (submitter name dropped in the editorial pivot; "four voters" phrasing),
genuinely compelling — clears the quality bar. Notable: R3's stored rel-context
snapshot was *still* contaminated, but the bundle-cite-only prompt discipline
overrode it — so the fix holds without a snapshot scrub (logged as optional
follow-up). Owner ratified → shipped v1.3.0.

## Blockers

_None._

## Activity Log

### 2026-06-16 — orc — gate: shipped v1.3.0 + closed sprint-35
- cross-checked all 4 lanes committed (bundle d586ee2, prompt-cite 701d88e, relctx-scope b66ddaf, tests 2a41934); tree clean
- `npm run check` 0 errors; full `vitest run` 533/533 green
- backend regenerated the R3 villain section on dev → owner content sign-off (0 ghosts, clears the bar)
- v1.3.0 + CHANGELOG committed (cd8bb1b); deployed via `docker compose up -d --build bot-ui`; footer `v1.3.0` + `/api/content/leagues` 200 verified on :3002
- optional follow-up filed: old rel-context snapshots remain contaminated (prompt discipline covers it) — a snapshot scrub is nice-to-have, not required
- doc `status: closed`

### 2026-06-16 — backend — tests task complete
- New `bundle-scope.test.ts` (6 tests): bundle contains only rounds ≤ N, ordered, isCurrent/isPrev flags correct, top3/winner from votes, future-round songs absent
- New `ghost-regression.test.ts` (6 tests): pre-fix baseline shows live blob contaminates R3 prompt with "Cottonfield Blues"/"Johnny Lang"; post-fix path with `relContextOverride` removes both ghosts from data + prompt; bundle-leak path verifies R4 not in bundle and not in cross-round record block
- 533/533 tests pass; `npm run check` 0 errors

### 2026-06-16 — backend — relctx-scope task complete (b66ddaf)
- `gatherRoundData()` now accepts `opts?: { relContextOverride?: string }` — when provided, uses the snapshot verbatim instead of the live `relationship_contexts` blob
- Whole-draft regen (`/regenerate`) passes `draft.rel_context` (snapshot stored at original gen) as the override
- Single-section regen adds `d.rel_context AS draft_rel_context` to its draft join and passes it as the override
- First-gen (`POST /draft`) unchanged — still uses the live blob (correct for first gen)
- New `relctx-scope.test.ts` (4 tests): no-override returns live blob; override returns snapshot; empty-string override returns `''`; R3-era snapshot excludes R5/R6 future material
- 23/23 tests pass; `npm run check` 0 errors

### 2026-06-16 — backend — prompt-cite task complete (701d88e)
- `buildUserPrompt()`: replaced thin `priorRounds` name list with a `## Cross-round record` block rendered from `RoundData.bundle`; each prior entry shows winner + top3 + least-loved; closes with the "Last round" anchor + forward-ref ban
- `relContext` section reframed with explicit `NOTE: personality/tone only — NOT cross-round facts` header; raw blob stays, will be scoped by `relctx-scope`
- `buildSystemPrompt()` chronology rule extended: names the Cross-round record as THE ONLY permitted source; lists 4 explicit rules including "never a later one"
- 4 new test assertions (bundle block present, fact-source label, relContext note, blob content still present); first-round test now overrides `bundle: []`
- `npm run check` 0 errors; 16/16 tests pass

### 2026-06-16 — backend — bundle task complete (d586ee2)
- added `RoundBundleEntry` interface + `bundle: RoundBundleEntry[]` to `RoundData`
- `gatherRoundData()` now queries all season submissions+votes once and builds a bundle scoped to `round_number <= current`, ordered by `round_number`, each entry carrying `top3/bottom1/winner` from actual votes plus `isCurrent/isPrev` flags
- `mkData()` factory in `llm.test.ts` updated; `npm run check` 0 errors; 17/17 tests pass
- `prompt-cite` is NEXT-ready (depends: bundle ✓)

### 2026-06-16 — docs — Sprint plan: digest round-aware ghost fix
- created sprint-35 coord-doc; `## Active Sprint Plan` = 5 tasks (4 backend / 1 orc gate)
- deps: prompt-cite←bundle; tests←bundle,prompt-cite,relctx-scope; gate←all; bundle + relctx-scope are NEXT-ready
- gate includes a human content-review checkpoint (regenerate R3, owner ratifies before prod)
- frontend idle this sprint (no UI change)
