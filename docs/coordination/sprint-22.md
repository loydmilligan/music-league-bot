---
project: music-league-bot
sprint: sprint-22-history-foundation
created: 2026-06-06T21:35:00Z
updated: 2026-06-06T21:35:00Z
status: active
---

# music-league-bot — coordination doc (sprint-22-history-foundation)

> **Phase 1 (Foundation) of the History research milestone.** Full design:
> `docs/brainstorming/history-research-tool.md` (READ IT — tabs, visual language,
> badges, theme tags, active-round mgmt, phasing). This sprint builds the
> substrate the later phases need; it does NOT build the song-search/theme/player
> tab internals yet (those are phases 2–4).
>
> **In scope:** rename "Round history" → **"History"** + a **tabbed shell** (3
> tabs present as stubs: Song search / Theme research / Player research);
> **active-round management** (per-league active slot, manual mark-active, "no
> active round → choose/create-with-dates" modal, round creation w/ deadlines);
> **theme property-tag system** (taxonomy + schema + API) and **tag existing
> themes** (at least the active leagues').
> **NOT in scope:** the tab internals (Spotify search cards, theme-similarity
> results, player summaries) — phases 2–4. viz idle.

## Sprint Goals

Stand up the History shell, active-round slots, and theme tags
Rename to History, 3 stub tabs, per-league active round + a theme-tag system to power later phases.

## Active Sprint Plan

- [x] {agent: frontend, id: history-shell} Rename the nav item **"Round history" → "History"** (`ui/src/routes/+layout.svelte`) and build the **tabbed History screen** at `/history` with **three tabs** — **Song search**, **Theme research**, **Player research** — present as **stubs** (empty/"coming soon" panels are fine; tab switching works, deep-link/route per tab if easy). Match the app's Mash Co. styling.
  - **Acceptance:** nav reads "History"; `/history` renders a 3-tab shell, tabs switch; stub panels labeled. `npm run check` passes; deployed; visual check (desktop + mobile) logged.

- [x] {agent: backend, id: active-round-model} Backend for **active-round management**: a way to mark **leagues as active**, hold one **active-round slot per active league**, **create a round with dates** (submission + voting deadlines), and set/clear a league's active round. Build on existing `currentRoundId`/`currentRoundPhase` (`layout.ts`) + seasons `status`. Expose an API the UI reads/writes (follow existing route patterns).
  - **Acceptance:** API returns, per active league, its active-round (or null); endpoints to mark-league-active, set-active-round, and create-round-with-deadlines work; verified for the current leagues (HJ, Fam Jam, etc.) on prod. `npm run check` passes; deployed; shape logged for active-round-ui.

- [ ] {agent: frontend, id: active-round-ui, depends: active-round-model,history-shell} The **active-round screen/area**: one **slot per active league** showing its active round (theme + dates). When a league is active but has **no resolvable active round → a modal warning: "No active round — choose from this list, or create a new round now"** (create includes setting dates). Lets the user manually keep each league's active round accurate.
  - **Acceptance:** active leagues each show an active-round slot; a league missing an active round triggers the modal with choose-from-list + create-new (with date inputs); setting persists via active-round-model. `npm run check` passes; deployed; visual check logged.

- [x] {agent: backend, id: theme-tag-model} The **theme property-tag system**: a tag **taxonomy** (categories: semantic / musicality / energy-feel / instrument / artist; extensible) + **schema** to attach **multiple tags per theme/round** + API to read/write a round's tags. This powers Phase-3 theme similarity = **tag overlap (no LLM)**.
  - **Acceptance:** schema stores multi-tag-per-round with category; API reads/writes a round's tags; taxonomy seeded; `npm run check` passes; deployed; shape logged for theme-tagging.

- [ ] {agent: backend, id: theme-tagging, depends: theme-tag-model} **Tag existing themes** with the taxonomy — at minimum the **active leagues' rounds** (a manual/seed pass + a simple way to add/edit tags later; NO LLM required). Capture how many themes got tagged.
  - **Acceptance:** the active leagues' round themes carry property tags; a documented way to add/edit tags exists; count of tagged themes logged in the Activity Log. `npm run check` passes; deployed.

### Deploy
Deploy per `CLAUDE.md` (chromium base = fast): `docker compose build --no-cache bot-ui && docker compose up -d --force-recreate bot-ui`, smoke `192.168.4.217:3002`. Serialize deploys.

---

## Agent Roster

| Agent | Owns | Does not touch |
|---|---|---|
| backend | active-round model/API + round-create-with-dates, the theme property-tag schema/taxonomy/API, tagging existing themes | the History UI / tab shell / modal UI |
| frontend | the History tabbed shell + rename, the active-round screen + modal UI | the active-round/theme-tag backend models, digest internals |
| viz | _idle this sprint — no tasks_ | — |

---

## Decision Log
- **D1** — Phase 1 = Foundation only (shell + active-round mgmt + theme tags). Tab internals are phases 2–4.
- **D2** — All 3 tabs exist as **stubs** from the shell now (Player research full build = Phase 4).
- **D3** — Theme similarity (Phase 3) will use **tag overlap, no LLM**; this sprint builds the tag system + tags existing themes.
- **D4** — Active-round mgmt is **manual-first** (mark-active, set/create with dates) on top of existing detection.

## Blockers

## Activity Log

### 2026-06-06 — backend — theme-tag-model LANDED (deployed + prod-verified) → unblocks theme-tagging
Theme property-tag system complete (D11 — similarity = tag overlap, no LLM). `npm run check` 0 errors; 7 new unit tests + 65 db tests green; deployed to prod and all endpoints smoked, test tags cleaned up (no round is tagged — clean slate for theme-tagging).

**⚠️ Deploy serialization note:** my build raced a concurrent frontend `bot-ui` build (we both saw a clear lane and started at 15:00). Both build from the same working tree so the image contains BOTH lanes' code (correctness OK), but the racing `up -d --force-recreate` collided ("removal already in progress" / stale-container errors). Resolved by waiting for both builds to exit then running one authoritative `up -d --force-recreate`. Container now fresh + serving. **Lesson for orc: serialize the whole build→up, not just "is a build running?" — check at dispatch, not just at agent start.**

**Schema** (3 tables, in `schema.ts` via `CREATE IF NOT EXISTS` — auto-applies on existing prod DB, no migration; seeded idempotently by `seedThemeTags()` on every boot):
- `theme_tag_categories (key, label, description, sort_order)` — the **seeded, extensible** category taxonomy. Seeded: `semantic, musicality, energy-feel, instrument, artist`.
- `theme_tags (id, category→categories.key, value, created_at, UNIQUE(category,value))` — the (category,value) **vocabulary**, reused across rounds. Seeded with ~50 starter values.
- `round_theme_tags (round_id→rounds, tag_id→theme_tags, added_at, PK(round_id,tag_id))` — the **multi-tag-per-round** join. `idx_round_theme_tags_tag` = reverse lookup for the Phase-3 overlap query. ON DELETE CASCADE both sides.
- Normalization: category keys + values are trim+lowercase (spaces→hyphens) so overlap is clean equality — no "Chill" vs "chill" dupes.

**API for `theme-tagging`:**
- `GET /api/theme-tags` → `{ categories: [{key,label,description,sortOrder}], tags: [{id,category,value}] }` — the full taxonomy + current vocabulary.
- `POST /api/theme-tags` `{ category, value }` → `{ tag }` — create/get a vocab tag; **auto-creates the category if new** (the extensibility hook).
- `GET /api/rounds/:roundId/tags` → `{ roundId, tags: [{id,category,value}] }`.
- `PUT /api/rounds/:roundId/tags` `{ tags: Array<{id} | {category,value}> }` → **replace** the round's full set (upserts vocab on the fly). **This is the workhorse for the seed pass** — send `{category,value}` pairs and unknown ones get created. Returns the new set.
- `POST /api/rounds/:roundId/tags` `{ category, value }` → add a single tag (201). `DELETE /api/rounds/:roundId/tags/:tagId` → detach one (leaves vocab intact). These are the "simple add/edit later" path.
- Errors: empty category/value → 400; unknown round → 404; bad tag-ref shape → 400.

**DB helper for the count report:** `countTaggedRounds(db)` (db/themeTags.ts) → distinct rounds with ≥1 tag — use it to log "N themes tagged".

**Prod-verified:** taxonomy seeded (5 cats / 50 tags); PUT replace on r118 created vocab `dance` on the fly; POST created `air-drums`; DELETE + empty-PUT cleanup confirmed; 400/404 paths confirmed. Round 118 left untagged.

Backend lane now idle — `theme-tagging` is unblocked and is my next task unless redirected.

### 2026-06-06 — orc — Wave 1 closed (2/2), Wave 2 dispatched
- Wave 1 done + deployed: `history-shell` [x] (`1b2b5d5`) + `active-round-model` [x] (`08b12ad`, prod-verified). Ticked history-shell (agent left it `[ ]`).
- Pushed: `4df04c9..1b2b5d5 master -> master` (was 11 ahead of origin; frontend did the single push).
- Wave 2 in flight: frontend → `active-round-ui` (deps satisfied), backend → `theme-tag-model` (no dep). Deploys serialized (both target bot-ui). `theme-tagging` still waits on `theme-tag-model`.

### 2026-06-06 — frontend — history-shell BUILT + DEPLOYED
- Renamed nav item **"Round history" → "History"** (`ui/src/routes/+layout.svelte`); dropped the stale round-count chip (was `13` — meaningless now it's a research tool, not a round list). Shared `navList` snippet → rename shows in both desktop rail + mobile drawer.
- New route `ui/src/routes/history/+page.svelte`: **3-tab shell** — Song search / Theme research / Player research. Each tab is a labeled **stub** ("COMING SOON" pill + one-line blurb of its future job). Mash Co. styling (font-display h1, mono breadcrumb, accent-underline tabs, dashed-border stub panel).
- Tabs are **deep-linkable**: `?tab=themes` / `?tab=players` (songs = default, no param). ARIA `tablist`/`tab`/`tabpanel` + arrow-key nav. Tab strip `overflow-x-auto` so no tab clips on narrow mobile.
- **Acceptance met:** nav reads "History"; `/history` renders 3-tab shell; tabs switch + deep-link; stubs labeled. `npm run check` → **0 errors** (warnings unchanged at 31; no new ones). Deployed to prod (`bot-ui`), smoked `192.168.4.217:3002`. Visual check logged: desktop (1280) + mobile (390) — all 3 tabs render, active state + panel content track selection.
- Stayed in UI lane; did not touch active-round / theme-tag backend. NOTE for `active-round-ui`: the active-round screen + modal is a **separate later task** — this shell does not include it.

### 2026-06-06 — backend — active-round-model LANDED (deployed + prod-verified)
Active-round management backend complete. `npm run check` 0 errors; 8 new unit tests + 58 db tests green; deployed to prod (`bot-ui`) and all endpoints verified against live leagues, prod state restored (temp data cleaned).

**Data model** — two columns on `leagues` (schema + in-place migration in `client.ts`):
- `is_active INTEGER` — operator-marked "currently played" (D4 manual-first). Migration **backfilled is_active=1** for leagues with an active season → fam-jam (id 2) + nostalgia-pit (id 4) came up active automatically; hip-jammers/second-best inactive (all seasons complete).
- `active_round_id INTEGER REFERENCES rounds(id)` — the manual active-round slot (one per league, nullable).

**Resolution order** (`db/activeRound.ts`): manual slot → derived current-round of the active season → `null`. `null` is the signal for the UI's "no active round → choose/create" modal. `source` field tells which path won.

**API for `active-round-ui`:**
- `GET /api/active-rounds` → `{ leagues: LeagueActiveRound[] }`, only `is_active` leagues.
  ```ts
  LeagueActiveRound = {
    leagueId, slug, name, isActive,
    activeSeasonId: number | null,            // create-round target
    activeRound: {                            // null → show the modal
      id, name, theme, submissionDeadline, votingDeadline,
      phase: 'upcoming'|'submission'|'voting'|'archive',
      source: 'manual' | 'derived',
    } | null,
    availableRounds: [{ id, name, phase, submissionDeadline, votingDeadline }], // the modal's "choose from list" (active season's rounds)
  }
  ```
- `PATCH /api/leagues/:leagueId/active` — body `{ active: boolean }` → returns the league's refreshed `LeagueActiveRound`. (mark-league-active)
- `PUT /api/leagues/:leagueId/active-round` — body `{ roundId: number | null }` (null clears) → refreshed `LeagueActiveRound`. Rejects a round from another league with **400**. `DELETE` on same path also clears. (set-active-round)
- `POST /api/leagues/:leagueId/rounds` — body `{ name, theme?, submission_deadline?, voting_deadline?, set_active? }` → `201 { round: { roundId, seasonId }, league: LeagueActiveRound }`. Validates ISO dates + voting-after-submission (400), needs an active season (409). Hand-created rounds get a synthetic `ml_round_id` = `manual:<seasonId>:<ts>`. (create-round-with-deadlines)

**Prod verification:** GET shows fam-jam→r118(derived,voting)/nostalgia-pit→r113(derived); mark-active on HJ surfaced it with `activeRound:null` + empty list (modal path), then restored; set-active-round fam-jam→r119 flipped source to `manual`, cross-league r113 rejected 400, DELETE reverted to derived r118; create round 130 stored deadlines+theme then deleted.

**Note for active-round-ui:** the modal's "create new round" should POST to `/api/leagues/:id/rounds` with `set_active:true` so the new round becomes the slot in one call. **Gotcha:** a manual round later imported from ML arrives under its real ml_round_id → a duplicate row; reconcile by pointing the slot at the imported round + deleting the manual one (same deadline-gap class we hit with S4/S2/r70).

Next backend task: `theme-tag-model` (no dep — picking it up).

### 2026-06-06 — orc — Wave 1 dispatched (in flight)
- frontend → `history-shell` (pane 1.3): implementing; mid-deploy (`docker compose build --no-cache bot-ui`)
- backend → `active-round-model` (pane 1.2): implementing (~11% ctx)
- `theme-tag-model` [backend]: queued behind active-round-model (single backend agent serializes)
- verify agent (pane 1.1): checking sprint-22 deploy + session bridge
- Wave 2 (`active-round-ui`, `theme-tagging`) blocked on wave-1 deps; deploys serialized

### 2026-06-06 — docs — Sprint plan created: history-foundation (sprint-22)
- 5 tasks: history-shell [frontend] + active-round-model [backend] + theme-tag-model [backend] kickoff in parallel → active-round-ui [frontend, ← model+shell], theme-tagging [backend, ← tag-model]
- Phase 1 of the History milestone (brainstorm: `docs/brainstorming/history-research-tool.md`); foundation only, tab internals deferred to phases 2–4; viz idle
- methodology: testing none / review none; acceptance gates on `npm run check` + prod
- sprint-21 (season-recap) closed so the warren advances here
