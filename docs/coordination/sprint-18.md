---
project: music-league-bot
sprint: sprint-18-tastemaker-v2
created: 2026-06-04T03:54:58Z
updated: 2026-06-04T03:54:58Z
status: active
---

# music-league-bot — coordination doc (sprint-18-tastemaker-v2)

> **Build the approved Tastemaker (discoverability v2 / Concept C) into the digest.**
> Replaces the v1 squashed-scale leaderboard from sprint-17. Spec:
> `~/.config/taw/wiki/Projects/music-league-bot/digest-tastemaker-spec.md` (read it —
> it has the payload shape, the scoring, the output matrix, and the gen/regen plan).
>
> **Scoring (decided):** per-song `obscurity = 100 − popularity_proxy` (Last.fm) →
> per-song **discovery percentile** (rank across the season's scored songs, de-squashes
> the scale) → per-player **Tastemaker score = MEDIAN of those percentiles** (median so
> one mainstream pick can't tank a maven). **Buckets on RAW obscurity:** Radio Hit <10,
> Recognizable 10–19, Curious Cut 20–29, Rabbit Hole 30+. **Compute the percentile-median
> SERVER-SIDE** — it got dropped twice in mockups because the data only carried raw obscurity.
>
> **Output (v1): web + mobile-PNG only.** Web = full interactive (tappable bucket counts →
> chunked-bar song modal, legend, ▲/▼ rank arrows). Mobile-PNG = static fallback
> (bars + counts + median score + legend, NO modal — interactivity doesn't survive a
> screenshot). Approved design: `docs/planning/famjam-s3-concept-c-mobile.html`.
>
> Roster: **backend** (payload v2) + **viz** (the component, web+static variants) +
> **frontend** (page wiring + GenerateModal/regen integration + the integration audit).
> Section wires via the synthetic `DigestKind` path (sprint-15 mechanism), NOT `SECTION_KINDS`.
> **NOT in this sprint:** web-share to `mldigest.mattmariani.com` (its own feature/spec),
> big-number tiles (Concept E, own sprint), scatterplot (backlog).

## Sprint Goals

- Ship the real tastemaker leaderboard — spread scores, tappable song lists
- Replace the squashed v1 with the median-percentile design, web + mobile.

## Active Sprint Plan

- [x] {agent: backend, id: payload-v2} Build the discoverability **payload v2** served on the digest data path (extend/replace the current `discoverability` payload). Per the spec: compute **server-side** per-song `discoveryPercentile` (rank of `obscurity = 100 − popularity_proxy` across the season's scored songs) and per-player **`tastemakerScore` = MEDIAN** of their songs' percentiles; include per-player **bucket counts** (raw-obscurity buckets: Radio Hit <10 / Recognizable 10–19 / Curious Cut 20–29 / Rabbit Hole 30+), a **`songs[]`** array per player (round, artist, title, obscurity, discoveryPercentile, bucket, points) for the tap-modal, **rank + prevRank** (round-over-round, for ▲/▼ arrows), and **avgPoints**. Keep the sprint-17 partial-coverage self-suppress (~80%). Also update `docs/design-briefs/discoverability-sample-famjam-s3.json` to carry the percentile-median score so mockups/consumers stop re-deriving it.
  - **Acceptance:** `GET /api/digest/[roundId]/discoverability` returns the v2 shape (per the spec's JSON sketch) for Hip Jammers S3 and Fam Jam S3 on prod — `tastemakerScore` is the percentile-median (readable ~24–80 spread, NOT raw 0–25), bucket counts sum to each player's submission count, `songs[]` populated, `rank`/`prevRank` present; self-suppresses on partial coverage. `npm run check` passes; deployed; the exact shape recorded in the Activity Log for viz/frontend. **prevRank source** decided + noted.

- [ ] {agent: viz, id: tastemaker-component, depends: payload-v2} Build the Tastemaker section component, porting the approved mockup (`docs/planning/famjam-s3-concept-c-mobile.html`). **Two variants** via the variant system: **web/interactive** — mobile-first stacked bars with counts INSIDE the segments, median score + ▲/▼ rank-change on the left, a legend (buckets + the "median of per-song discovery percentiles, from Last.fm" score explanation), and **tappable bucket counts → a lightweight song modal** (light scrim, tap-outside-to-close, slide-up; the bucket's bar broken into one chunk per song, songs listed **most-obscure-first = rightmost chunk**, themed subtly to the bucket color/icon); **PDF/static** — bars + counts + median score + legend only, **no modal/tap** (for the PNG export). Build against the spec's documented payload shape (can start in parallel with `payload-v2`).
  - **Acceptance:** given a v2 payload the web variant renders the interactive bars + legend + ▲/▼ + tappable chunked-bar song modal (most-obscure-first); the static variant renders bars+counts+score+legend with no interactivity and reflows cleanly at ~430px; `npm run check` passes.

- [ ] {agent: frontend, id: wire-tastemaker, depends: tastemaker-component} Wire v2 into the digest page, **replacing the v1 discoverability component**, for **web + mobile-PNG export** (static variant in the export path; mirror the sprint-15 synthetic-`DigestKind` + `visualData` plumbing). Add the **GenerateModal include toggle** for the Tastemaker section (default ON) + a **partial-coverage indicator**; ensure **regen recomputes** it (pure data — no LLM prompt path). Remove/retire the old v1 leaderboard.
  - **Acceptance:** on prod, the web digest shows the interactive v2 Tastemaker section (spread scores, arrows, tappable song modal) and the **mobile PNG** shows the static fallback (no modal, legible); GenerateModal has a working include toggle + coverage indicator; regen recomputes; v1 is gone. `npm run check` passes; deployed; visual check (web + PNG) logged.

- [ ] {agent: frontend, id: integration-audit, depends: wire-tastemaker} **Integration check.** Verify the Tastemaker section's full control-surface coverage (GenerateModal toggle + indicator, regen, web + PNG export, self-suppress) — and **audit every existing digest section** (stat strip, next-round, standings, chat, podium, LLM cost) for any missing GenerateModal toggle / state indicator / export coverage, listing gaps and fixing them. This is the recurring "built-but-not-wired" cleanup the user called out — make creating digests with these sections smooth and consistent.
  - **Acceptance:** a short audit table in the Activity Log — one row per digest section × {GenerateModal toggle, indicator, web render, PNG/export render, self-suppress} — all green or with the fix applied; any gaps found are fixed + deployed. `npm run check` passes.

### Deploy

Each change deploys to prod per `CLAUDE.md`: `docker compose build --no-cache bot-ui && docker compose up -d --force-recreate bot-ui`. **Serialize deploys** (review-queue item 6) — or iterate with `npm run dev` (vite HMR in `ui/`) and deploy once at the end.

---

## Agent Roster

| Agent | Owns | Does not touch |
|---|---|---|
| backend | the discoverability v2 payload + scoring (`ui/src/routes/api/digest/[roundId]/discoverability/**`, `ui/src/lib/db/discoverability.ts`, the percentile/median computation), the sample JSON | the Tastemaker Svelte component + the digest-page wiring/GenerateModal |
| viz | the Tastemaker section component (`ui/src/lib/digest/**`, web + static variants) ported from the mockup | the `+server.ts` payload, the scoring, and the digest-page section registration / GenerateModal |
| frontend | the digest-page wiring (synthetic `DigestKind` + `visualData`), the GenerateModal toggle/indicator, the regen path, and the integration audit | the discoverability payload/scoring and the viz component internals |

---

## Decision Log

- **D1** — Tastemaker score = **median of per-song discovery percentiles** (median resists the single-outlier problem; percentile de-squashes the Last.fm proxy). Computed **server-side** in the payload.
- **D2** — Buckets on **raw obscurity** (absolute/explainable); score on **percentile** (spread). Two scales, by design.
- **D3** — v1 output = **web (interactive) + mobile-PNG (static fallback)** only. Tap-modal is web-only; PNG shows bars+counts+score+legend. wide/pdf/png-sections deferred.
- **D4** — Regen is **pure-data recompute** (no LLM comments/prompt-tweaks for this section).
- **D5** — Web-share (self-contained export → `mldigest.mattmariani.com` via a **separate Cloudflare tunnel**, app locked down) is a **separate feature/spec/sprint**, not this one. This sprint produces the interactive web render only.
- **D6** — Replace the sprint-17 v1 leaderboard outright (not parallel).

## Blockers

## Activity Log

### 2026-06-04 — docs — Sprint plan created: tastemaker v2 / Concept C (sprint-18)
- 4 tasks: payload-v2 (backend) → tastemaker-component (viz) → wire-tastemaker (frontend) → integration-audit (frontend)
- 1 backend / 3 frontend-or-viz / 0 docs; spec-driven (`digest-tastemaker-spec.md`)
- deps: component ← payload-v2 (but can start against the documented shape in parallel); wire ← component; audit ← wire. Kickoff = backend payload-v2 + viz component in parallel
- grounded in the approved mockup (`docs/planning/famjam-s3-concept-c-mobile.html`) + the sprint-15 synthetic-DigestKind wiring; replaces the v1 discoverability leaderboard
- first sprint to run under the new digest-feature spec process; integration-audit task added per user's "built-but-not-wired" cleanup ask
- sprint-17 closed so the warren advances here

### 2026-06-04 — backend — payload-v2 done + deployed + prod-verified (shape for viz/frontend)

`GET /api/digest/:roundId/discoverability` → **`{ discoverability: TastemakerPayload | null }`** (v2 replaces v1). All scoring computed **server-side**.

**Exact shape (viz/frontend build to this):**
```jsonc
{ "discoverability": {            // null when coverage is absent/partial (<80%)
  "scope": "season",
  "season": "Hip Jammers S3",
  "players": [                    // ranked most-obscure first (rank 1 = highest score)
    { "name": "Mashew", "rank": 1, "prevRank": 1,   // prevRank: number | null
      "tastemakerScore": 96,      // MEDIAN of this player's songs' discoveryPercentile (0-100)
      "avgPoints": 9.3,
      "submissionCount": 3,
      "buckets": { "radioHit": 0, "recognizable": 1, "curiousCut": 1, "rabbitHole": 1 }, // sums to submissionCount
      "songs": [                  // most-obscure-first (for the chunked-bar modal)
        { "round": "Your Permanent Record", "artist": "The Vandals",
          "title": "I Have a Date - ...", "obscurity": 39,
          "discoveryPercentile": 100, "bucket": "rabbitHole", "points": 10 } ]
    } ] } }
```
- `bucket` ∈ `radioHit`(<10) | `recognizable`(10-19) | `curiousCut`(20-29) | `rabbitHole`(30+) — on RAW obscurity.
- `tastemakerScore` is the **percentile median** → readable spread, NOT raw 0-25.

**prevRank source (decided + noted):** the corpus is the season cumulative **through the digest's round** (`r.id ≤ current`); `rank` is computed over that corpus. **`prevRank` = the same ranking recomputed over the corpus through the PRIOR round** (`r.id < current`) — round-over-round, **recomputed on the fly (no extra storage)**, mirroring the sprint-14 standings model. `prevRank` is `null` when there's no prior round or the player has no scored songs yet in the prior corpus. (For a completed/active-finished season the cumulative-through-final = whole season, so HJ S3 r104 and Fam Jam S3 r101 cover all scored songs.)

**Prod verification (`192.168.4.217:3002`):**
- **Hip Jammers S3 r104:** 9 players, score spread **33–96** (Mashew 96 → Sasha/missmara/Kristin 33); every player's buckets sum to its submissionCount; songs[]=3 each, most-obscure-first; rank/prevRank present with ▲/▼ deltas (e.g. Ronm prev6→rank3 ▲). ✅
- **Fam Jam S3 r101:** 11 players, spread **23–79** (Em 79 → arigrey83 23); bucket sums OK; songs[] 8–11 (Sarah 8); prevRank populated. ✅
- **Self-suppress:** unit-tested (null on zero AND on <80% corpus coverage); all current prod seasons are 100% covered so it won't fire live now — guards future un-backfilled seasons.

**Also:** `docs/design-briefs/discoverability-sample-famjam-s3.json` regenerated with the v2 percentile-median (`tastemakerScore` + per-song `discoveryPercentile`/`bucket` + `buckets`/`rank`/`prevRank`), spread 23–79, so mockups stop re-deriving it.

**Verification:** `npm run check` 0 errors; full suite **125 passing** (7 v2 discoverability tests). Deployed serialized. **Lane:** backend only — `discoverability.ts` (scoring) + the `/discoverability` endpoint + the sample JSON. Did NOT touch `TastemakerLeaderboard.svelte`, the digest page wiring, or `GenerateModal`. **➡ frontend:** `+page.server.ts` already passes `body.discoverability` straight through — just update its type from the v1 array to `TastemakerPayload` (object with `.players`). **➡ viz:** build the component against the shape above (`players[].songs` is pre-sorted most-obscure-first).
