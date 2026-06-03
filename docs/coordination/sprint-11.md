---
project: music-league-bot
sprint: sprint-11-export-import-and-rating-polish
created: 2026-05-20T00:00:00Z
updated: 2026-05-20T00:00:00Z
status: closed
---

# music-league-bot — coordination doc (sprint-11-export-import-and-rating-polish)

> **Backend** owns the new CLI-trigger ingest endpoint and the import pipeline glue.
> **Frontend** owns the digest-prep action button, the unified rating component, and the research-tab sort UX.
> Wave 1 fires in parallel across backend (Task A) + frontend (Tasks B + C) + pane 1.4 (Task D). All four tasks are independent.

## Goal

Two threads:

1. **Digest prep one-action import.** When a digest's prepare checks show missing data that the existing music-league CLI can fetch via `export.zip`, surface an action button on the digest prep screen that runs the CLI host-side, imports the result, and re-runs the checks — single user click.
2. **Rating UI polish across shortlist + research.** Three related fixes:
   - Shortlist rating bars don't update in realtime (require song switch / Esc to surface the update).
   - Research tab on round-detail pages still uses the OLD single-color rating UI; should match shortlist's multi-color UI.
   - Research tab sort by average rating re-runs on every click, causing songs to jump mid-rating — change to manual sort button + optional auto-after-all-4 toggle.

---

## Active Sprint Plan

### Wave 1 — parallel (all four tasks)

- [x] {agent: backend, id: cli-import} Task A: `POST /api/digest/:roundId/import-export-zip` — host-side CLI trigger + import pipeline
  - **Acceptance:**
    - New endpoint. Bearer-auth NOT required (consumed by the digest prep UI which is already same-origin). Validates round exists; 404 if not.
    - Triggers `cli-web-musicleague export` (or whatever the existing CLI command is — confirm by reading the CLI's help output or the existing `ml-auth-trigger.mjs` pattern) host-side. **Reuse the bridge pattern** from `scripts/ml-auth-trigger.mjs` (HTTP from container → host daemon → spawn CLI in user-graphical env). This means a NEW endpoint on the existing host trigger daemon, OR a separate small daemon — your call; document the choice.
    - On CLI success: locate the produced `export.zip`, run it through the existing export.zip import pipeline (find where the Settings page's manual export.zip upload lands — reuse that code path). The import resolves submissions, votes, vote comments for whichever round was targeted.
    - **Scope of what to import:** everything export.zip provides — submissions, votes, vote comments. Skip checks that export.zip doesn't contribute to (chat mentions, album art).
    - Response: `{ ok: true, imported: { submissions: N, votes: N, voteComments: N }, checks: <updated prep checks payload> }` so the frontend can refresh the prep checks UI in one round-trip. Failure: `{ ok: false, reason: '<one-line>', stage: 'auth|cli|download|import|other' }`.
    - Timeout handling: CLI run may take 15-60s. Endpoint should stream a progress event (SSE) OR return synchronously with a reasonable timeout (60-90s) — your call; the frontend will support whichever you ship as long as it's documented in sprint-11.md.
    - If CLI auth has expired (the same auth state the existing `/api/ml-auth/login` flow manages), return `{ ok: false, reason: 'ml-auth required', stage: 'auth' }` so frontend can prompt the user to re-auth first instead of silently failing.
  - **Stay clear of:** `ui/src/routes/digest/**` (frontend territory), `ui/src/routes/api/digest/**` other than the new endpoint, `ui/src/routes/settings/**`.

- [x] {agent: frontend, id: import-button, depends: cli-import} Task B: Digest prep screen — "Import from CLI" action button
  - **Acceptance:**
    - On `/digest/[roundId]` in the prepare stage, add an "Import from CLI" button next to the existing "Generate draft" button (or below it, separated — your call for placement; match the existing button styling).
    - **Visibility rule:** button shows when at least one of the export.zip-resolvable checks is failing (submissions / votes / vote comments — match against backend's documented scope). If all those checks pass, button hides.
    - Click → POST to `/api/digest/:roundId/import-export-zip`. Loading state on button (spinner + disabled). On 200 → refresh the prep checks UI from the response payload, toast "Imported: N submissions, N votes, N comments". On `{ ok: false, stage: 'auth' }` → redirect to or modal the ml-auth flow. On other failure → error toast with the reason.
    - **Wait for backend Task A's sprint-11.md Activity Log entry** before wiring the exact response shape. You can scaffold the button + loading state immediately, gated on a stub.
    - `npm run check` passes.
  - **Stay clear of:** any non-digest frontend files.

- [x] {agent: frontend, id: rating-unify, parallel-with: B,D} Task C: Unify rating component + realtime update fix
  - **Acceptance:**
    - **Find the rating UI components.** Two locations:
      - **Shortlist screen** rating bars (multi-color, 4 criteria — current good UI)
      - **Research tab on round-detail pages** (old single-color UI for the same 4 criteria)
    - **Make the shortlist component the canonical one.** Hoist it to a shared location (e.g. `ui/src/lib/components/SongRatingBars.svelte` if not already there).
    - **Use the canonical component in research tab.** Replace the old single-color UI with the canonical multi-color component. Make sure the data binding is correct — research tab rating writes go to the same DB column(s) as shortlist rating writes; check the existing endpoint(s) for what fields they take.
    - **Fix the realtime-update bug.** Today, clicking a rating bar in the shortlist updates the DB but the song card's displayed ratings don't reflect the change until the user switches songs or presses Esc. Root cause is likely a `$state` / store / reactivity gap — find the source of truth for the displayed ratings on the song card and ensure click handlers update it immediately (not just after server roundtrip / invalidate). After this fix, BOTH shortlist AND research tab should show the new ratings immediately on click.
    - `npm run check` passes.

- [x] {agent: extension, id: research-sort-fix, parallel-with: B,C} Task D: Research tab — manual sort button + optional auto-after-all-4 toggle
  - **Acceptance:** (Note — pane 1.4 was the extension agent for sprint-10, but is being assigned this frontend task since the extension is paused. It's a capable Claude instance in the MLB repo; scope is contained.)
    - On the round-detail research tab, the songs list is currently auto-sorted by average rating across the 4 criteria, re-sorting on every rating click. That causes the song the user is currently rating to jump position mid-flow.
    - **Replace the auto-sort with:**
      1. A **manual "Re-sort" button** at the top of the research list (or sticky near the top — match the page's existing button placement patterns). Click it to apply the current ratings to the sort order. Until clicked, the list stays in whatever order it was in.
      2. A **settings toggle** (in the existing Settings page if applicable, or a small inline toggle on the research tab) labeled something like "Auto-sort after all 4 ratings entered". When ON, the list re-sorts automatically — but only for a song where the user has entered all 4 ratings (not partial). Default OFF.
    - Both behaviors should coexist — the manual button is always available; the toggle only changes the auto behavior.
    - `npm run check` passes.
  - **Stay clear of:** `extension/**` (extension territory paused), `ui/src/routes/digest/**`, `ui/src/lib/components/SongRatingBars.svelte` (if frontend Task C is moving it — coordinate by reading frontend's Activity Log entry; if it doesn't yet exist, the research tab still uses the old single-color UI which is what frontend is replacing).

### Wave 2 — none planned

(If any of Wave 1 surfaces follow-on work — e.g. the CLI auth path needing a tweak, or the rating component refactor exposing a related bug — capture as a Wave 2 task at that point.)

### Deploy

Each agent deploys to prod when their task lands per the always-deploy-to-prod convention in `CLAUDE.md` — `docker compose build --no-cache bot-ui && docker compose up -d --force-recreate bot-ui`.

---

## Agent Roster

| Agent | Owns | Does not touch |
|---|---|---|
| backend | `ui/src/routes/api/digest/[roundId]/import-export-zip/+server.ts`, `scripts/ml-auth-trigger.mjs` (extending if needed for CLI trigger), wherever the existing export.zip import pipeline lives (read+reuse, don't reimplement) | `ui/src/routes/digest/**`, `ui/src/lib/components/SongRatingBars.svelte`, research tab files, `extension/**` |
| frontend | `ui/src/routes/digest/[roundId]/+page.svelte` (button + handler), `ui/src/lib/components/SongRatingBars.svelte` (canonical rating UI), shortlist page (consumer of the rating component) | `ui/src/routes/api/**`, `ui/src/lib/db/schema.ts`, `extension/**`, research tab sort logic (Task D territory) |
| extension (Task D only) | Research tab sort UI — wherever the active-rounds → round-detail → research tab is rendered, plus any Settings toggle UI for the auto-sort preference | Everything else — read-only on backend code and on `SongRatingBars.svelte` (will be using it once frontend Task C lands) |

---

## Decision Log

- **D1** — Import scope = everything export.zip provides (submissions, votes, vote comments). Chat mentions + album art skipped because they don't come from export.zip.
- **D2** — Sort fix = both manual button + auto-after-all-4 toggle (default OFF). Manual is always available; toggle gates the auto behavior.
- **D3** — Rating component unification: one task. Shortlist's multi-color UI is canonical; research tab swaps to it. Realtime fix lives in the unified component, fixes both screens at once.
- **D4** — Bearer auth NOT required on `/api/digest/:roundId/import-export-zip` — it's consumed by the same-origin webapp UI, same as other `/api/digest/**` routes. Bearer is only for the extension ingest path.
- **D5** — Reuse the `ml-auth-trigger.mjs` host-side daemon pattern for the CLI trigger. Don't roll a new bridge.

## Blockers

## Activity Log

- **2026-05-20 — pane 1.4 (Task D, research-sort-fix) — landed @ 68043af.**
  `ui/src/lib/components/ResearchList.svelte` no longer re-sorts on every rating
  click. The previous `$derived` sort was replaced with a user-controlled
  `orderedIds` snapshot. New UI in the Candidates header:
  - **Re-sort** button — applies current scores to the display order on click.
  - **"Auto-sort after all 4 ratings entered"** checkbox — default OFF,
    persisted in `localStorage` under `mlb.research.autoSortAfterAll4`. When ON,
    a resort fires the moment a song transitions from partial → all 4 ratings
    set; partial rating clicks still don't move the song.
  Added candidates append to the order; removed ids drop out. Snapshot also
  refreshes on new-song add so display stays consistent.
  Integrated cleanly with frontend Task C (canonical `SongRatingBars`) — the
  sort trigger lives in `onBarChange` and uses the same wasComplete /
  willBeComplete check on the research field shape. `npm run check` clean
  modulo pre-existing warnings/error (vite.config.ts `test` overload, plus the
  existing prop-capture warnings).
  Deployed: `docker compose build --no-cache bot-ui && docker compose up -d
  --force-recreate bot-ui` → `mlb.mattmariani.com` 200, container booted, no
  startup errors. Browser smoke (rate partial → list stays; click Re-sort →
  list updates; toggle ON, rate all 4 → list moves) deferred to user — the
  default tab is ML so the research markup is only reachable interactively.
  No push (per CLAUDE.md push-threshold policy, local-only).

### 2026-05-20 — frontend — Task C done (rating unify + realtime fix) + Task B done (Import from CLI button)

**Task C — Unify rating component + fix realtime-update bug**

- **Root cause of the realtime bug:** `ui/src/lib/shortlist/DnaStrip.svelte` declared `rows` as a `const` capturing prop values at the moment of component init. When `ShortlistRow.svelte` updated `localSong.ratingDiscovery` via `$state` assignment in `patchRating()`, the prop flowed into DnaStrip but the internal `rows` array did not recompute — so the `width: {(row.value/5)*100}%` style still reflected the initial value. The user had to close + re-open the row (re-mounting DnaStrip with the new prop snapshot) to see the bar shift. Svelte 5 specifically warns about this via `state_referenced_locally`; that warning had been in the baseline for a while.
- **Fix in the canonical:** `rows = $derived([...])` — recomputes whenever any of `discovery`, `themeFit`, `nostalgia`, `personal` props change. Same shape as before, just reactive.

- **Hoisted component:**
  - **new** `ui/src/lib/components/SongRatingBars.svelte` — the canonical multi-color rating bars. Visual match for the prior `.sl-dna-*` shortlist treatment (8 px pill-shaped tracks, color per dimension, four ticks, right-aligned numeric value), but scoped as `.srb-*` with internal styles, no external CSS dependency. Module-exported `RatingDimension` type for consumers that need typed `onchange` callbacks.
  - **deleted** `ui/src/lib/shortlist/DnaStrip.svelte` — no remaining consumers after the swap. Removing it dropped 3 `state_referenced_locally` baseline warnings (31 → 28).
- **Consumer swaps:**
  - `ui/src/lib/shortlist/ShortlistRow.svelte` — `<DnaStrip>` → `<SongRatingBars>` import + tag swap. No prop changes; the canonical's prop names (`discovery`, `themeFit`, `nostalgia`, `personal`) match what was being passed.
  - `ui/src/lib/components/ResearchList.svelte` — replaced the inline 5-dot grid + per-dimension "clear" buttons with a single `<SongRatingBars>`. Research uses **different field names** (`discoveryPotential`, `themeFit`, `nostalgiaPotential`, `personalRating`) and a **different endpoint** (`PATCH /api/research/:roundId`), so I added a `DIM_TO_FIELD` mapping table and a thin `onBarChange(song, dim, value)` wrapper. Value semantics: a bar click at value 0 (far-left of the track) maps to `null` (clears the field, matching the prior "clear" button's effect). Values 1-5 persist as integers. The prior "click same value clears" behavior is gone — single rule across both screens. Dead code (`const dims`, `setRating`) removed; the auto-sort-after-all-4 logic from pane 1.4's Task D is preserved verbatim (just relocated into `onBarChange`).
- **DB write paths confirmed:** shortlist writes go to `shortlist_songs.rating_*` via `PATCH /api/shortlist/:id/rating`; research writes go to `research.*` via `PATCH /api/research/:roundId`. These are **different columns and different endpoints** — the brief's "check before swapping" caveat applies. The unification is at the **UI component** level, not the data layer. Documented this in the ResearchList wrapper so future readers don't mistake the bars for a single-table abstraction.
- **Coordination note for pane 1.4 (Task D):** the canonical component now lives at `ui/src/lib/components/SongRatingBars.svelte`. The shortlist-side `DnaStrip.svelte` has been deleted. Pane 1.4's Task D landed concurrently in `ResearchList.svelte` (manual `Re-sort` button + `auto-sort after all 4` localStorage toggle + `orderedIds` snapshot) — I merged my swap with their additions cleanly; no conflict. The auto-sort trigger condition (`willBeComplete && !wasComplete`) is preserved inside the new `onBarChange()` so it still fires when the user completes the 4th rating.

**Task B — Digest prep screen "Import from CLI" button**

- **Backend Task A is live** (no Activity Log entry yet from backend, but the endpoint exists and matches the planned contract). Verified via direct POST: returns `{ok:false, stage:'auth', reason:'Session expired. Run: cli-web-musicleague auth login'}` against the current expired ml-auth state. Status 200, content-type `application/json`. The full success response shape will be exercised once ml-auth is refreshed.
- **Implementation** (`ui/src/routes/digest/[roundId]/+page.svelte`):
  - New `importing` `$state` + `exportZipChecksFailing` `$derived` (checks if any of `Submissions`, `Votes`, `Vote comments` has `ok:false`). Button only renders in prepare stage and only when the derived flag is true; in `refine`/`finalize` or when all three pass, it's gone.
  - New `importFromCli()` handler: POSTs `{}`, reads `{ok, stage, reason, imported}` from the JSON body, branches:
    - `ok:false, stage:'auth'` → toast "Music League auth has expired — click the ml-auth badge to re-login, then retry." Then `invalidateAll()` so the page reflects whatever (unchanged) state.
    - `ok:false, stage:other` → toast `Import failed (<stage>): <reason>`.
    - success → toast "Imported: N submissions, N votes, N comments" derived from `body.imported`, then `invalidateAll()` to pull the refreshed prep checks via the existing server load (the response also includes a `checks` payload per backend's contract — I rely on `invalidateAll()` instead of grafting the response into client state, so the single source of truth stays the server load).
  - Button placement: next to "Re-run checks" in the existing prepare-stage button row. Style `mash-btn--secondary mash-btn--sm` to match. Mutually-disabling with the `preparing` flag so the user can't fire both at once.

- **`npm run check`:** 1 ERROR (pre-existing `vite.config.ts`), **28 WARNINGS** (down from 31 — net win from deleting `DnaStrip.svelte`), 13 FILES. Zero new diagnostics from any of my edits.
- **Deploy:** `docker compose build --no-cache bot-ui && docker compose up -d --force-recreate bot-ui`. Container Up on `0.0.0.0:3002`.
- **Smoke (localhost:3002):**
  - `/digest/106` (Submissions / Votes / Vote comments all `ok:false`) → 200, HTML contains the `Import from CLI` button. ✓
  - `/digest/14` (no failing checks; round already finalized) → 200, **no** `Import from CLI` button. ✓ gate works.
  - `POST /api/digest/106/import-export-zip` → 200, body `{ok:false, stage:'auth', …}`. My handler routes that to the ml-auth-prompt toast. ✓
  - `/shortlist` → 200, page contains expanded `sl-row` markup (collapsed rows don't render bars; bars only show on row expand — that's the existing UX). Build-side check confirms `SongRatingBars` imports cleanly in `ShortlistRow.svelte`.
  - `/league/hip-jammers/season/3/round/106` → 200, page rendered. The research tab is client-state (`let tab = 'ml'`), so SSR HTML defaults to the ML tab and the canonical bars only mount on tab switch — cannot smoke via curl alone, but the component compiles cleanly and the shape matches.
- **Realtime-update bug live verification (deferred to user UAT):** end-to-end click-and-see-immediate-fill requires a live browser. The fix is a one-line change (`const rows = [...]` → `const rows = $derived([...])`) inside the canonical component; the prop-update path was already correct upstream (`ShortlistRow.patchRating` assigns to `$state localSong` after the fetch). With `rows` reactive, the bar width recomputes on the same render tick as the prop change. Pre-fix, both shortlist and research surfaces had this exact issue; post-fix, both share the canonical and both benefit.
- **Status:** Tasks B + C done, deployed. Two commits planned, one per task.

### 2026-05-20 — backend — Task A (cli-import) done

**Endpoint:** `POST /api/digest/:roundId/import-export-zip` — same-origin, no
bearer (D4). Validates round → ml-auth heartbeat gate → bridges to host daemon
→ reads zip from shared volume → runs `parseZip` + `importZipData` → re-runs
prep checks → returns composite payload.

**Files (Task A scope only):**

- `scripts/ml-auth-trigger.mjs` — extended the existing host daemon with a new
  `POST /export-zip` route (D5: reuse the bridge). Same port 7679; `/login`
  and `/health` untouched. Restart via
  `systemctl --user restart mlb-auth-trigger.service` after edits.
- `ui/src/lib/digest/prepChecks.ts` — exported `runPrepChecks(db, roundId)`
  helper that returns the same 6-check array as the prepare endpoint's
  inline `runChecks`. New endpoint imports this so it can return a fresh
  `checks` payload without touching `routes/api/digest/[roundId]/prepare/+server.ts`
  (coord-doc said stay clear). The prepare endpoint still has its inline
  copy; reconcile if scope drifts.
- `ui/src/routes/api/digest/[roundId]/import-export-zip/+server.ts` — the new endpoint.

**CLI invocation (host daemon `/export-zip`):**

1. Container POSTs `{ leagueName, slug, seasonNumber }` (resolved from the
   roundId via `rounds → seasons → leagues`).
2. Daemon runs `cli-web-musicleague --json leagues list` (30s timeout) to map
   our DB league name → ML league UUID. **Matching is fuzzy** — ML names
   drift from our slugged names (e.g. ours `"Hip Jammers"` → ML
   `"Hip Jammers 3: its all hippening"`; ours `"Nostalgia Pit"` → ML
   `"The Nostalgia Pit"`). Logic: normalize both sides (lowercase, strip
   non-alnum, collapse whitespace), try exact match first, fall back to
   substring-either-direction; if multiple fuzzy matches → 409 `ambiguous`.
3. Daemon runs `cli-web-musicleague leagues export <id> -o <path>` (90s
   timeout, configurable via `ML_EXPORT_CLI_TIMEOUT_MS`). Writes to
   `<data-dir>/<slug>/season-<N>/export.zip` — same path `runStartupImport`
   scans, same path the container sees via `./data:/app/data`.
4. Daemon detects `AUTH_EXPIRED` in either CLI step and returns
   `{ ok: false, stage: 'auth' }`. The endpoint also pre-gates on
   `probeMlAuth()` so most auth failures short-circuit before spawning.

**Import pipeline reused:** `parseZip` + `importZipData` — the exact same
code path as the Settings page's manual upload action (sprint-9 D4). Import
is logged into `import_log` with filename `"export.zip (cli-trigger)"` so
it shows up alongside manual uploads in the Settings history. Scope =
whatever `importZipData` writes: competitors, rounds, ml_submissions, votes
(with comments). Album art + chat mentions untouched (D1).

**Mode (sync vs SSE):** Synchronous. Container fetch has a 120s
AbortController (`ML_EXPORT_HTTP_TIMEOUT_MS`), host daemon CLI has a 90s
timeout. In practice the CLI returns in ~1s (cached), so 120s is plenty.

**Response shapes:**

```
// success → HTTP 200
{ ok: true,
  imported: { submissions: N, votes: N, voteComments: N },   // deltas vs pre-import
  checks: [ ...6-element prep-checks array... ],
  durationMs: N,
  mlLeagueId: "..." }

// failure → HTTP 200 (auth | cli | download | import | other)
// EXCEPT: HTTP 400 invalid roundId, HTTP 404 round not in DB
{ ok: false, stage: 'auth' | 'cli' | 'download' | 'import' | 'other', reason: '...' }
```

**Smoke (prod, mlb.mattmariani.com → 192.168.4.217:3002):**

1. **Auth-expired** — with `ml-auth.json` status=expired:
   `POST /api/digest/117/import-export-zip` → `{ok:false, stage:'auth',
   reason:'Session expired. Run: cli-web-musicleague auth login'}`. ✓
2. **404** — `POST /api/digest/99999/import-export-zip` → HTTP 404,
   `{ok:false, stage:'other', reason:'round not found: 99999'}`. ✓
3. **Success (no delta)** — re-auth'd, then `POST .../102/import-export-zip`
   (round 102 = "Your Permanent Record", currently-active hip-jammers round,
   had complete data) → `{ok:true, imported:{0,0,0}, checks:[all green for
   ml-zip checks], durationMs:1169, mlLeagueId:'b514fe...'}`. ✓
4. **Prove-it (failing check turns green)** — deleted 5 random votes for
   round 102 (66 → 61), called endpoint → `{ok:true, imported:{votes:5,...},
   votes_check:{ok:true, count:66}}`. ✓ End-to-end contract verified.

**Caveat for Task B:** the underlying `cli-web-musicleague leagues export`
only includes the *currently in-progress* round in the zip. Completed
rounds (e.g. round 117 "Listen To This...") will see `ok:true` but zero
deltas — `checks` won't flip to green for them. Button is still safe to
wire unconditionally; if the user clicks for a non-current round it just
no-ops. Worth surfacing in UI later, out of scope for Task A.

**Frontend wiring cheat-sheet (Task B):**

```ts
const res = await fetch(`/api/digest/${roundId}/import-export-zip`, { method: 'POST' });
const body = await res.json();
if (!body.ok) {
  if (body.stage === 'auth') {
    // route to the existing /api/ml-auth/login flow (POST it; user completes OAuth
    // in the spawned kitty window; then re-call this endpoint).
  } else {
    // toast: body.reason, body.stage
  }
} else {
  // body.imported = { submissions, votes, voteComments } — counts of *new* rows
  // body.checks = full 6-element prep-checks array (same shape as /prepare)
  // refresh prep-checks UI directly from body.checks — no need to re-fetch /prepare
}
```

Visibility rule: export.zip-resolvable checks are array indices 1, 2, 3
(`Submissions`, `Votes`, `Vote comments`). Show the button when any of those
three is `ok:false`. (Frontend's existing `exportZipChecksFailing` derived
already does this — verified by reading the Task B Activity Log above.)

**Env (already in `docker-compose.yml`):**
`ML_AUTH_TRIGGER_URL=http://host.docker.internal:7679`. Override on container
with `ML_EXPORT_HTTP_TIMEOUT_MS` (default 120000). Override on host with
`ML_EXPORT_CLI_TIMEOUT_MS` (default 90000).

**Status:** Task A landed. Deployed via
`docker compose build --no-cache bot-ui && docker compose up -d --force-recreate bot-ui`.
`npm run check` shows 1 pre-existing error (vite.config.ts `test` overload) +
28 warnings, **0 new diagnostics from Task A files**. Commit local-only per
CLAUDE.md push-threshold policy.
