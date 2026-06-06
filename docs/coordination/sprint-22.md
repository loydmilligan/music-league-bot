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

- [ ] {agent: frontend, id: history-shell} Rename the nav item **"Round history" → "History"** (`ui/src/routes/+layout.svelte`) and build the **tabbed History screen** at `/history` with **three tabs** — **Song search**, **Theme research**, **Player research** — present as **stubs** (empty/"coming soon" panels are fine; tab switching works, deep-link/route per tab if easy). Match the app's Mash Co. styling.
  - **Acceptance:** nav reads "History"; `/history` renders a 3-tab shell, tabs switch; stub panels labeled. `npm run check` passes; deployed; visual check (desktop + mobile) logged.

- [ ] {agent: backend, id: active-round-model} Backend for **active-round management**: a way to mark **leagues as active**, hold one **active-round slot per active league**, **create a round with dates** (submission + voting deadlines), and set/clear a league's active round. Build on existing `currentRoundId`/`currentRoundPhase` (`layout.ts`) + seasons `status`. Expose an API the UI reads/writes (follow existing route patterns).
  - **Acceptance:** API returns, per active league, its active-round (or null); endpoints to mark-league-active, set-active-round, and create-round-with-deadlines work; verified for the current leagues (HJ, Fam Jam, etc.) on prod. `npm run check` passes; deployed; shape logged for active-round-ui.

- [ ] {agent: frontend, id: active-round-ui, depends: active-round-model,history-shell} The **active-round screen/area**: one **slot per active league** showing its active round (theme + dates). When a league is active but has **no resolvable active round → a modal warning: "No active round — choose from this list, or create a new round now"** (create includes setting dates). Lets the user manually keep each league's active round accurate.
  - **Acceptance:** active leagues each show an active-round slot; a league missing an active round triggers the modal with choose-from-list + create-new (with date inputs); setting persists via active-round-model. `npm run check` passes; deployed; visual check logged.

- [ ] {agent: backend, id: theme-tag-model} The **theme property-tag system**: a tag **taxonomy** (categories: semantic / musicality / energy-feel / instrument / artist; extensible) + **schema** to attach **multiple tags per theme/round** + API to read/write a round's tags. This powers Phase-3 theme similarity = **tag overlap (no LLM)**.
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

### 2026-06-06 — docs — Sprint plan created: history-foundation (sprint-22)
- 5 tasks: history-shell [frontend] + active-round-model [backend] + theme-tag-model [backend] kickoff in parallel → active-round-ui [frontend, ← model+shell], theme-tagging [backend, ← tag-model]
- Phase 1 of the History milestone (brainstorm: `docs/brainstorming/history-research-tool.md`); foundation only, tab internals deferred to phases 2–4; viz idle
- methodology: testing none / review none; acceptance gates on `npm run check` + prod
- sprint-21 (season-recap) closed so the warren advances here
