---
project: music-league-bot
sprint: sprint-30
title: Player Research Polish — collapsible UX, league themes, LLM caching
status: active
created: 2026-06-14T00:00:00Z
activated: 2026-06-14
updated: 2026-06-14T00:10:00Z
---

# music-league-bot — coordination doc (sprint-30)

> **Polish pass on the Player Research tab.** Sprints 28–29 stacked a lot onto the
> per-player panel (dossier, fingerprint, vote probe, submission predictor) — this
> sprint makes it pleasant to use and stops the costly LLM calls re-running. Five
> backlog items: collapsible/default-collapsed sections (PR-1), song list moved to
> the end (PR-2), theme picker wired with descriptions (PR-3) and scoped to the
> league reusing the AssignPopover pattern (PR-11), and caching of LLM-generated
> predictions with visible provenance (PR-4). Items defined in
> `docs/coordination/backlog.md` (PR-1..PR-4, PR-11). Origin: owner review after
> sprint-29, 2026-06-13.

## Sprint Goals

- Make the Player Research tab pleasant and cheap to use
  Collapsed by default, league-scoped themes, and cached predictions with provenance.

## Agent Roster

| Agent | Owns | Does not touch |
|---|---|---|
| backend | DB + `$lib/db/*` + `$lib/predict/*` services, `/api/*` routes, LLM harness, caching layer | Svelte components, page routes |
| frontend | Svelte components + routes, hands-on UI verification | DB schema, services, API route internals |
| orc | sprint gate: cross-checks, version + CHANGELOG, ratification card, prod deploy, context resets | project code (orc manages; project agents work) |

## Working agreements (sprint-30)

- Backlog (`docs/coordination/backlog.md`, items PR-1..PR-4, PR-11) is the source — each
  task names its PR; consult it before touching code.
- Reuse existing patterns: the caching follows the **Taste Fingerprint** persist+provenance+
  regenerate pattern; the league-scoped theme picker reuses **`AssignPopover.svelte`** (groups
  rounds by `leagueName`, `/api/rounds/open`). Do not invent parallel mechanisms.
- The three frontend tasks all edit `PlayerResearchTab.svelte` — they run SERIALLY (one lane),
  chained by `depends:`. The backend caching task is file-disjoint and runs in parallel.
- Hands-on means hands-on: UI claims require driving the real dev UI (`npm run dev`, port
  5173 — NEVER 4444) at desktop and 412×892, noting what was clicked.
- Mid-task context discipline: past ~60-70% context, write a handoff and request a reset from orc.
- No prod deploy except by orc at the gate.

## Active Sprint Plan

<!-- Task syntax (parser contract):
     - [ ] {agent: <roster>, id: <slug>, depends: <id,id>} Body
       - **Acceptance:** verifiable check.
     Status marks: [ ] pending · [-] in-progress · [x] done · [!] blocked.
     `agent:` must match the Agent Roster. `depends:` is one comma-separated key. -->

- [-] {agent: backend, id: predict-cache} **PR-4 — cache LLM predictions with provenance.** Add a cache path for the costly per-player LLM tasks so repeat views don't re-pay. For `vote-probe` and `submission-predict`: before calling the model, look up the latest matching `prediction_runs` row by cache key (vote-probe: `player_id` + song + theme; submission-predict: `player_id` + theme) and return it instead of calling, UNLESS a `forceRegen` flag is passed. The endpoints' responses must include provenance — `model`, `cost_usd`, `generated_at`, and call params — and a flag indicating cache-hit vs fresh. The Taste Fingerprint already works this way (persist + provenance + explicit regenerate) — match that pattern. Touch only `$lib/predict/*` + the two `/api/players/:id/{vote-probe,submission-predict}` route files.
  - **Acceptance:** a second identical `POST .../vote-probe` (or `.../submission-predict`) returns the cached result WITHOUT a new model call (assert via a spy/stub call-count in a vitest); passing `forceRegen:true` does call the model and writes a new `prediction_runs` row; the response carries `model`/`cost_usd`/`generated_at` provenance; `npm run check` 0 errors; `npx vitest run` green.

- [-] {agent: frontend, id: layout-polish} **PR-1 + PR-2 — collapsible sections (default collapsed) + song list last.** In `ui/src/lib/components/PlayerResearchTab.svelte`, make each section of the per-player panel collapsible and **default to collapsed**; move the **Songs Submitted** section to the **bottom** of the panel (it's the longest). Keep all existing functionality; just restructure layout + add collapse state per section. Match the Mash Co. tokens already in the file.
  - **Acceptance:** selecting a player shows all sections collapsed by default; each expands/collapses on click; Songs Submitted renders last; verified hands-on on dev (5173) at desktop AND 412×892 with the clicks noted in the Activity Log; `npm run check` 0 errors.

- [ ] {agent: frontend, id: theme-picker, depends: layout-polish} **PR-3 + PR-11 — theme picker: pass description + scope to league.** Two fixes to the theme picker shared by the Vote Probe and Submission Predictor panels in `PlayerResearchTab.svelte`: (PR-3) when a real theme is selected, pass its real `description` (not an empty string) to the predict/probe API — the backend templates already emit Name+Description, so confirm a real description reaches the model; freeform must let the user enter both name + description. (PR-11) **scope the theme list to the relevant league** instead of the global `/api/history/themes` dump — reuse the `AssignPopover.svelte` pattern (rounds grouped by `leagueName`, sourced from `/api/rounds/open` or the league-scoped equivalent); add a league selector if needed so the user only sees that league's themes.
  - **Acceptance:** picking a real theme sends a non-empty description to the API (verify in the network request / a logged prompt); the theme list shows only the selected league's themes (not all leagues); freeform still works with name+description; verified hands-on on dev at desktop + 412×892 (noted in Activity Log); `npm run check` 0 errors.

- [ ] {agent: frontend, id: cache-affordances, depends: theme-picker,predict-cache} **PR-4 (UI) — provenance stamp + Regenerate on the prediction panels.** Now that the API returns cache + provenance (predict-cache), surface it on the Vote Probe and Submission Predictor panels in `PlayerResearchTab.svelte`: show a "generated {date} · {model} · ${cost}" stamp on a returned result (mirror the Taste Fingerprint stamp already in the file), and a **Regenerate** button that re-requests with `forceRegen:true`. On first open of a player+theme that has a cached result, show the cached result with its stamp rather than forcing a fresh call.
  - **Acceptance:** a returned vote-probe / submission result shows the provenance stamp; Regenerate triggers a fresh call (new stamp/date); re-opening a previously-run player+theme shows the cached result instantly with its stamp; verified hands-on on dev at desktop + 412×892 (noted in Activity Log); `npm run check` 0 errors.

- [ ] {agent: orc, id: gate-close, depends: cache-affordances} **Gate — cross-check, ship, close.** Orc runs the gate: cross-check both lanes' acceptance, independent `npm run check` + `npx vitest run`, version bump + CHANGELOG, ratification card, one cached prod deploy, a 412×892 prod smoke (panel collapsed-by-default + songs-last; pick a league-scoped theme; run a prediction then re-open it → served from cache with provenance stamp), panes reset, doc closed.
  - **Acceptance:** all worker tasks `[x]`; 0 typecheck errors + vitest green; v-bump + CHANGELOG committed; ratification card emitted + ratified; prod smoke passes (collapse + songs-last + league themes + cache-hit-with-stamp) with 0 console errors; doc `status: closed`.

## Decision Log

### 2026-06-14 — Sprint scope = Player Research polish (owner, after sprint-29)
Bundles backlog PR-1 (collapsible/default-collapsed), PR-2 (songs last), PR-3 (theme
description wiring), PR-11 (league-scoped theme picker, reuse AssignPopover), PR-4 (cache
LLM predictions + provenance). Structure: the 3 frontend tasks edit the same component
(`PlayerResearchTab.svelte`) so they chain serially; the backend caching task is disjoint
and runs in parallel with the frontend chain.

## Ratification Log

_(gate card lands here when it resolves)_

## Blockers

_None._

## Activity Log

### 2026-06-14 — orc — Sprint-30 ACTIVATED · predict-cache + layout-polish dispatched (Wave 1)
- status planned → active; dispatched the two dependency-free tasks in parallel —
  predict-cache to backend (%55), layout-polish to frontend (%56). File-disjoint
  (backend = $lib/predict + routes; frontend = PlayerResearchTab.svelte). Both `[-]`.
- theme-picker opens when layout-polish lands; cache-affordances needs both theme-picker + predict-cache; then gate.

### 2026-06-14 — docs — Sprint plan authored: Player Research polish (PR-1..4, PR-11)
- created sprint-30 coord-doc; `## Active Sprint Plan` body has 5 tasks
- 1 backend (predict-cache) / 3 frontend (layout-polish → theme-picker → cache-affordances, serial on PlayerResearchTab.svelte) / 1 orc gate
- deps: theme-picker ← layout-polish; cache-affordances ← theme-picker + predict-cache; gate ← cache-affordances
- predict-cache (backend) runs parallel with the frontend chain; opening wave = predict-cache ∥ layout-polish
- status `planned` — kickoff (first dispatch) is confirmation-gated; awaiting owner "go"
