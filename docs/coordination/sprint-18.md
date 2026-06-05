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

- [x] {agent: viz, id: tastemaker-component, depends: payload-v2} Build the Tastemaker section component, porting the approved mockup (`docs/planning/famjam-s3-concept-c-mobile.html`). **Two variants** via the variant system: **web/interactive** — mobile-first stacked bars with counts INSIDE the segments, median score + ▲/▼ rank-change on the left, a legend (buckets + the "median of per-song discovery percentiles, from Last.fm" score explanation), and **tappable bucket counts → a lightweight song modal** (light scrim, tap-outside-to-close, slide-up; the bucket's bar broken into one chunk per song, songs listed **most-obscure-first = rightmost chunk**, themed subtly to the bucket color/icon); **PDF/static** — bars + counts + median score + legend only, **no modal/tap** (for the PNG export). Build against the spec's documented payload shape (can start in parallel with `payload-v2`).
  - **Acceptance:** given a v2 payload the web variant renders the interactive bars + legend + ▲/▼ + tappable chunked-bar song modal (most-obscure-first); the static variant renders bars+counts+score+legend with no interactivity and reflows cleanly at ~430px; `npm run check` passes.

- [x] {agent: frontend, id: wire-tastemaker, depends: tastemaker-component} Wire v2 into the digest page, **replacing the v1 discoverability component**, for **web + mobile-PNG export** (static variant in the export path; mirror the sprint-15 synthetic-`DigestKind` + `visualData` plumbing). Add the **GenerateModal include toggle** for the Tastemaker section (default ON) + a **partial-coverage indicator**; ensure **regen recomputes** it (pure data — no LLM prompt path). Remove/retire the old v1 leaderboard.
  - **Acceptance:** on prod, the web digest shows the interactive v2 Tastemaker section (spread scores, arrows, tappable song modal) and the **mobile PNG** shows the static fallback (no modal, legible); GenerateModal has a working include toggle + coverage indicator; regen recomputes; v1 is gone. `npm run check` passes; deployed; visual check (web + PNG) logged.

- [x] {agent: frontend, id: integration-audit, depends: wire-tastemaker} **Integration check.** Verify the Tastemaker section's full control-surface coverage (GenerateModal toggle + indicator, regen, web + PNG export, self-suppress) — and **audit every existing digest section** (stat strip, next-round, standings, chat, podium, LLM cost) for any missing GenerateModal toggle / state indicator / export coverage, listing gaps and fixing them. This is the recurring "built-but-not-wired" cleanup the user called out — make creating digests with these sections smooth and consistent.
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

### 2026-06-04 — viz — tastemaker-component done: `TastemakerSection.svelte` (commit 5f12a22)
Ported the approved Concept C mockup (`docs/planning/famjam-s3-concept-c-mobile.html`) into a real Svelte section component → **`ui/src/lib/digest/TastemakerSection.svelte`** (new file; v1 `TastemakerLeaderboard.svelte` left for frontend to retire). Built against backend's payload-v2 shape above; reads it from the **`data` prop** (the section's `visualData`), implements `VisualComponentProps`.
- **Two variants off one component**, split on `?export=1` (the flag the export render sets), per spec §3:
  - **WEB / interactive:** mobile-first stacked bars with **counts INSIDE** the segments (buckets ordered mainstream→obscure); the **median Tastemaker score** + **▲green/▼red/– rank-change** (prevRank in parens) on the left by the rank; a **legend** (4 buckets + the score explanation: *"median of your songs' discovery percentile … from Last.fm play counts"*); **tappable bucket counts → a lightweight song modal** — light scrim (`rgba 0.34` + `blur 1px`), tap-outside / Esc / Close to dismiss, gentle slide-up; the bucket's bar **broken into one chunk per song**, songs listed **most-obscure-first = rightmost chunk** (opacity ramps up toward the right), themed to the bucket color + a line-art icon (radio/headphones/magnifier/rabbit-hole), with chunk↔row hover-sync.
  - **EXPORT / static (mobile PNG):** bars + counts + median score + ▲/▼ + legend only — segments are **disabled** (no modal/tap), no overlay markup. No horizontal overflow at ~430px.
- **Self-suppresses** (renders nothing) on null/empty payload; defensive read (accepts the `TastemakerPayload` object or a `{ discoverability }` wrapper).
- **Verification:** `npm run check` **0 errors** (file not flagged). Smoked in isolation via Playwright with a v2-shaped payload: web rendered bars+legend+arrows+scores (79/67/23 spread) and the tap-modal (green Rabbit-Hole theming, chunked bar `4→1`, songs `ob 47→31` most-obscure-first, row↔chunk highlight); export variant confirmed via DOM — segment is a **disabled button → click opens no modal**, legend+scores+counts present, `scrollWidth === innerWidth` (no overflow). Temp `_viz-preview` harness removed after.
- **Lane hygiene:** added only the one new `.svelte` file + scoped CSS. Did NOT touch the `/discoverability` payload, the scoring, the digest-page section registration, or `GenerateModal`.
- **➡ handoff to frontend (`wire-tastemaker`):** register **`TastemakerSection`** for the `discoverability` synthetic `DigestKind` (replacing v1 `TastemakerLeaderboard`), pass the v2 payload (`body.discoverability` → `TastemakerPayload`) as the section's **`visualData`**; the static variant is automatic in the export path (the component reads `?export=1`). Then retire `TastemakerLeaderboard.svelte`. GenerateModal include toggle + coverage indicator + regen-recompute are frontend's per the task.

### 2026-06-04 — frontend — wire-tastemaker done + deployed + prod-verified (commit dbfb722)

Wired discoverability **v2** `TastemakerSection` into the digest page, **replacing v1** `TastemakerLeaderboard`, for **web (interactive) + mobile-PNG (static)**. Mirrors the sprint-15 synthetic-`DigestKind` + `visualData` plumbing — the static variant is automatic via the component's own `?export=1` read.

**Changes (frontend lane only):**
- `+page.svelte` registry: `discoverability → TastemakerSection` (was `TastemakerLeaderboard`); import swapped.
- `+page.server.ts`: `discoverability` typed **`TastemakerPayload`** (imported from `$lib/db/discoverability.ts`) — was the v1 `DiscoverabilityRow[]`; removed the now-dead `DiscoverabilityRow` type.
- `showDiscoverability` now reads the v2 **object** (`.players.length`) and gates on a session **`discoverabilityExcluded`** (the modal include toggle); eyebrow → "Tastemaker".
- **GenerateModal**: added a **Tastemaker DATA row** mirroring Season standings — **include toggle (default ON)** + a **coverage indicator** (`● coverage ready` / `⚠ incomplete coverage`), driven by a new `tastemakerCoverage` prop derived on the page (`ready` when the payload has players, else `incomplete`). `GenerateParams` gains `tastemaker: { include }`; the `/draft` endpoint ignores unknown body fields (like `standings`), so the toggle is purely session-scoped client-side.
- **Regen = pure-data recompute**: no LLM path — the section's data is re-fetched from `/api/digest/:roundId/discoverability` (which recomputes from `song_popularity`) on every load / `invalidateAll`. No prompt/comments wiring.
- **Retired** `TastemakerLeaderboard.svelte` (deleted; only the page referenced it).

**Prod verification (`192.168.4.217:3002`, r104 Hip Jammers S3):**
- **Web (interactive):** 9 player bars, score spread **96→33**, **6 ▲/▼ rank arrows** with prevRank in parens (Ronm ▲(6), gregamariani ▼(3), Kristin ▲(8)); buckets mainstream→obscure with counts inside; legend on top. **Tap-modal works** — slide-up + light scrim, headphones-themed "RECOGNIZABLE · 1 SONG" header, chunked bar with FAMILIAR→MOST OBSCURE axis, song row (Beastie Boys "Fight For Your Right", ob 13), Close. ✅
- **Mobile PNG (`?export=1`):** `is-export` set, **segments disabled → click opens no modal**; bars+counts+score+▲/▼+legend render and **reflow cleanly** (section `scrollWidth==width`, 392px; the 23px doc-level overflow at 430 is app-shell padding, not the section — export uses a 520px viewport + screenshots `.dg-export`). Legible. ✅
- **GenerateModal:** Tastemaker row present, **include default ON**, **"● coverage ready"** (green) indicator. ✅
- **v1 gone:** registry + import swapped, file deleted. ✅

**Verification:** `npm run check` **0 errors** (31 pre-existing warnings, none in touched files). Deployed serialized (`build --no-cache bot-ui` + `up -d --force-recreate`). **Lane hygiene:** touched only the page wiring + GenerateModal; did NOT touch the `/discoverability` payload, the scoring, or the `TastemakerSection` component internals. **➡ next:** `integration-audit` (frontend) — control-surface audit across all digest sections.

### 2026-06-04 — frontend — integration-audit done + deployed + prod-verified (commit 4a41419) — CLOSES SPRINT-18

Audited **every digest section's control surface** across 5 dimensions and fixed the gaps. **Two gaps found** — `stats` and `next-round` had no GenerateModal include toggle — both fixed; all sections now uniform.

**Audit table** (✅ = present/working · all green after fix):

| Section | Kind | GenModal toggle | Indicator | Web render | PNG/export render | Self-suppress |
|---|---|---|---|---|---|---|
| A-side / podium | LLM | ✅ enabled checkbox | ✅ excluded/locked/regen banners | ✅ | ✅ in `.dg-export` | ✅ exclude + empty-item guards |
| B-side / villain | LLM | ✅ | ✅ | ✅ | ✅ | ✅ |
| Credits / flow | LLM | ✅ | ✅ | ✅ | ✅ | ✅ |
| Consensus | LLM | ✅ | ✅ | ✅ | ✅ | ✅ |
| Liner quotes | LLM | ✅ | ✅ | ✅ | ✅ | ✅ (`{#if items.length}`) |
| Back cover / chat | LLM | ✅ | ✅ | ✅ (ChatMoments) | ✅ | ✅ |
| By the numbers / **stats** | data | ✅ **FIXED** (was missing) | ✅ **FIXED** availability | ✅ | ✅ in `.dg-export` | ✅ `showStats` gate |
| Season standings | data | ✅ include + recompute | ✅ **FIXED** availability (+ reconcile/edit) | ✅ StandingsChart | ✅ in `.dg-export` | ✅ `showStandings` gate |
| Next-round preview / **nextRound** | data | ✅ **FIXED** (was missing) | ✅ **FIXED** availability | ✅ | ✅ in `.dg-export` | ✅ `showNextRound` gate |
| **Tastemaker** / discoverability | data | ✅ (wire-tastemaker) | ✅ coverage ready/incomplete | ✅ interactive | ✅ static fallback (`?export=1`) | ✅ null/empty + <80% |
| LLM cost banner | meta | n/a (not a content section) | ✅ shows $ + "in-app only" | ✅ | **intentionally excluded** (`data-export-hide`, outside `.dg-export`) | ✅ shows $0.0000 |

**Fixes applied (commit 4a41419):**
- GenerateModal: added **By the numbers** (stats) + **Next-round preview** include toggles (default ON), each with an availability indicator; added an availability indicator to the **Season standings** row too — all four DATA rows now match the Tastemaker pattern. `GenerateParams` gains `stats` / `nextRound` `{ include }` (`DataGenOpt`).
- page: session-scoped `statsExcluded` / `nextRoundExcluded` gate `showStats` / `showNextRound` (mirroring `standingsExcluded` / `discoverabilityExcluded`); `statsAvailability` / `standingsAvailability` / `nextRoundAvailability` passed to the modal.

**Tastemaker full control surface re-verified on prod (r104):** ✅ GenModal toggle (default ON) + `● coverage ready` indicator · ✅ web interactive (96→33 spread, ▲/▼, tap-modal) · ✅ mobile-PNG static fallback (segments disabled, no modal) · ✅ regen recompute (pure-data re-fetch) · ✅ self-suppress (null/empty + <80%, unit-tested by backend).

**Prod verification (`192.168.4.217:3002`, r104):** GenerateModal renders **6 LLM rows + 4 DATA rows = 10 toggles**, every data row shows include-ON + `● COVERAGE READY`. `npm run check` **0 errors** (31 pre-existing warnings). Deployed serialized.

**Known limitation (consistent, by design — not a per-section gap):** include/exclude toggles are **session-scoped web-view state** (LLM via `sectionStates`, data via `*Excluded`); section state is **not persisted to the DB**, so the server-side **PNG/PDF export re-renders from the persisted draft** regardless of session excludes. This is pre-existing and uniform across all 10 sections — persisting exclude state is a separate feature, not part of this audit. The "6/6 sections" modal header counts only the LLM `sections` array (cosmetic; the 4 data rows toggle independently and don't gate the Generate button).

**Sprint-18 complete:** payload-v2 ✅ · tastemaker-component ✅ · wire-tastemaker ✅ · integration-audit ✅. Tastemaker v2 (Concept C) shipped to prod (web interactive + mobile-PNG static); v1 leaderboard retired; all digest sections have a uniform, consistent control surface.
