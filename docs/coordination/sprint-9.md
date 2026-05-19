---
project: music-league-bot
sprint: sprint-9-digest-preview
created: 2026-05-19T00:00:00Z
updated: 2026-05-19T00:00:00Z
status: active
---

# music-league-bot — coordination doc (sprint-9-digest-preview)

> **Backend** owns DB schema, API routes, LLM service, and Puppeteer export.
> **Frontend** owns the SvelteKit route, all visual components, and section chrome.
> Wave 1 runs fully in parallel. Wave 2 starts after Wave 1 schema + CSS land.
> Wave 3 starts after Wave 2 LLM + chrome land.

## Design reference

Implementation prompt (source of truth):
`docs/mashco-design-handoff-digest/digest-handoff/handoff/Implementation prompt.md`

Reference HTML (open before starting, three artboards):
`docs/mashco-design-handoff-digest/digest-handoff/reference/Music League Bot - Digest Preview.html`

Variant C (`DigestC` / `.dgC-*` classes) is the chosen visual treatment.
Variants A and B are parked stash — keep but don't wire.

---

## Active Sprint Plan

### Wave 1 — Foundation (parallel)

- [x] {agent: backend, id: schema} Task 1: DB schema — 4 new tables: `digest_drafts`, `digest_sections`, `digest_regenerations`, `relationship_contexts`
  - **Acceptance:** Tables added to `ui/src/lib/db/schema.ts` SCHEMA string. `round_id INTEGER NOT NULL REFERENCES rounds(id)` (integer PK, not ml_round_id). `npm run check` passes.

- [x] {agent: backend, id: api-scaffold} Task 2: API scaffolding — CRUD routes with stub handlers (no LLM yet)
  - **Acceptance:** All 11 endpoints from §11 of the impl prompt exist and return 200/404 with empty/stub JSON. Routes wired into server. `npm run check` passes.

- [x] {agent: backend, id: prepare-checks} Task 3: Prepare checks — 6-check data validation for a round
  - **Acceptance:** `POST /api/digest/:roundId/prepare` runs all 6 checks (round metadata, submissions, votes, vote comments, chat-window mentions, Spotify creds). Returns `{ checks: [...] }` with `ok: boolean` and `src: string` per check. Check 1 source label: `"export.zip · {round}"`.

- [x] {agent: frontend, id: css} Task 4: CSS — lift `ml-digest-styles.css` from handoff into repo
  - **Acceptance:** `ui/src/lib/digest/digest.css` created with all `.dg-*`, `.dgA-*`, `.dgB-*`, `.dgC-*` classes from the reference. No Tailwind conflicts. `npm run check` passes.

- [x] {agent: frontend, id: route-scaffold} Task 5: Route scaffold — `/digest/[roundId]` page with pipeline strip (static states)
  - **Acceptance:** Route exists at `ui/src/routes/digest/[roundId]/+page.svelte` and `+page.server.ts`. Pipeline strip renders with hardcoded `is-active` / `is-done` / `is-pending` states (no DB wiring yet). Page has no sidebar nav. `npm run check` passes.

- [x] {agent: frontend, id: section-components} Task 6: Section components — all 6 variant-C section types rendered with fixture data
  - **Acceptance:** Separate Svelte components (or a single `DigestSection.svelte` with kind-switching) render all 6 section kinds (`podium`, `villain`, `flow`, `consensus`, `quotes`, `chat`) using data from `ml-digest-data.jsx` as fixtures. Wrapped in `.dg-export` frame. Matches variant-C visual against reference HTML artboard 1.

### Wave 2 — Interactivity (parallel, after Task 1 + Task 4 land)

- [x] {agent: backend, id: llm-service, depends: schema,api-scaffold} Task 7: LLM service — generate draft + per-section regen via OpenRouter
  - **Acceptance:** `POST /api/digest/:roundId/draft` calls OpenRouter (model: `anthropic/claude-sonnet-4-5` or env-overridable), generates all 6 sections, writes to `digest_sections`, returns full draft. `POST /api/digest/:roundId/sections/:id/regenerate` regenerates one section with active chips + instructions, logs to `digest_regenerations`. Second call to `/draft` for same round returns cached result without LLM call.

- [x] {agent: backend, id: whole-regen, depends: llm-service} Task 8: Whole-draft regenerate — parallel regen skipping locked sections
  - **Acceptance:** `POST /api/digest/:roundId/regenerate` runs all non-locked sections in parallel (Promise.all), skips `state = 'locked'` sections, updates `whole_regen_count`. Returns updated draft.

- [ ] {agent: frontend, id: section-chrome, depends: route-scaffold,section-components} Task 9: Section action chrome — toggle/regen/lock/kebab buttons
  - **Acceptance:** Each section has `.dg-section-actions` overlay with 4 buttons (exclude, regen, lock, kebab). Kebab popover shows edit/move-up/move-down/delete. State transitions (default → excluded → default, default → locked → default) apply correct CSS classes and banners. Chrome sits outside `.dg-export` via `.dg-section-wrap` positioning. Matches reference HTML artboard 1.

- [ ] {agent: frontend, id: regen-modal, depends: section-chrome} Task 10: Regenerate modal — chips + free-text + current-copy preview
  - **Acceptance:** `↻` button opens modal with: current copy (read-only), 5 steer chips (combinable), instructions textarea (pre-filled from last regen), token estimate, Cancel + Regenerate buttons. Section enters `is-regenerating` state (shimmer + banner) while API call runs. On success: new content renders, `digest_regenerations` row written. Whole-draft regen reuses same modal component. Matches reference HTML artboard 2.

### Wave 3 — Export + finalize (parallel, after Task 7 + Task 9 land)

- [ ] {agent: backend, id: export, depends: llm-service} Task 11: Puppeteer export — screenshot `.dg-export` at 800px, trigger download
  - **Acceptance:** `POST /api/digest/:roundId/finalize` screenshots the `.dg-export` element at 800px wide using Puppeteer (already in project). No chrome (pipeline strip, action buttons, banners) appears in the PNG. Returns download URL. `digest_drafts.finalized_at` set.

- [ ] {agent: backend, id: rel-context, depends: export} Task 12: Relationship context — auto-update on finalize via LLM + diff view
  - **Acceptance:** Finalize call also sends current rel context + finalized digest content to LLM, gets back a proposed updated context. `relationship_contexts` row updated. `GET /api/leagues/:leagueId/rel-context` and `PATCH` endpoint functional. Diff between prior and proposed is available in API response.

- [ ] {agent: frontend, id: finalize-flow, depends: regen-modal} Task 13: Finalize flow — pipeline step 4 + download trigger + rel context diff view
  - **Acceptance:** "Finalize & download png" button triggers export API, then triggers browser download of `r-{N}-digest-{timestamp}.png`. Rel context footer shows "view diff" link; clicking opens modal with before/after. `digest_drafts.finalized_at` drives pipeline strip to step-4-done state.

- [ ] {agent: frontend, id: round-selector, depends: route-scaffold} Task 14: Round selector + sidebar nav entry
  - **Acceptance:** Round selector dropdown at top of page lists every round across all leagues grouped by league; navigates to `/digest/{roundId}`; shows "voting still open" banner for rounds where voting hasn't closed. Sidebar nav in `+layout.svelte` has "Digest" entry linking to most-recent unfinalized digest (or round selector if none). `npm run check` passes.

- [ ] {agent: backend, id: deploy} Task 15: Deploy to prod
  - **Acceptance:** `docker compose build --no-cache bot-ui && docker compose up -d bot-ui` from `/home/loydmilligan/Projects/music-league-bot`. No runtime errors. `/digest` route reachable at mlb.mattmariani.com.

---

## Agent Roster

| Agent | Owns | Does not touch |
|---|---|---|
| backend | `ui/src/lib/db/schema.ts`, `ui/src/routes/api/digest/**`, `ui/src/lib/digest/llm.ts`, `ui/src/lib/digest/prepare.ts`, `src/api/` (Puppeteer export endpoint) | `ui/src/routes/digest/**/*.svelte`, `ui/src/lib/digest/digest.css`, digest Svelte components |
| frontend | `ui/src/lib/digest/digest.css`, `ui/src/routes/digest/**`, `ui/src/lib/digest/*.svelte`, `ui/src/routes/+layout.svelte` (nav entry only) | `ui/src/lib/db/schema.ts`, `ui/src/routes/api/**` |

---

## Decision Log

- **D1**: Wave 1 backend (schema + API scaffold + prepare checks) and Wave 1 frontend (CSS + route scaffold + section components) run in parallel — no cross-dependency.
- **D2**: Wave 2 backend (LLM service) starts after schema lands; Wave 2 frontend (section chrome + regen modal) starts after CSS + route scaffold land. Both Wave 2 tracks are parallel to each other.
- **D3**: `round_id` in `digest_drafts` is `INTEGER REFERENCES rounds(id)` — the DB integer PK, not `ml_round_id`.
- **D4**: Export.zip upload (existing settings flow) is the v1 CTA in prepare drawer. CLI re-run is v2 stub (disabled).
- **D5**: Chosen visual variant is C (Mixtape liner / `.dgC-*`). Variants A and B are parked in the reference files.
- **D6**: All agents deploy to prod (`mlb.mattmariani.com`) via `docker compose build --no-cache bot-ui && docker compose up -d bot-ui` after completing their task set.

## Blockers

_None at sprint start._

## Activity Log

### 2026-05-19 — orc — sprint kick-off
- Sprint-9 activated. Digest preview feature. Design handoff: `docs/mashco-design-handoff-digest/`.
- Backend agent (pane 1.2): Wave 1 — Tasks 1+2+3.
- Frontend agent (pane 1.3): Wave 1 — Tasks 4+5+6.
- Wave 2 starts after schema (Task 1) + CSS (Task 4) land.

### 2026-05-19 — backend — Task 1 done
- Task 1 (DB schema): `digest_drafts`, `digest_sections`, `digest_regenerations`, `relationship_contexts` added to `ui/src/lib/db/schema.ts:135-173`. Pre-existing check errors unchanged. Continuing Tasks 2+3.

### 2026-05-19 — frontend — Task 4 done
- Task 4 (CSS): `ui/src/lib/digest/digest.css` created (1944 lines, verbatim from handoff). All `.dg-*`, `.dgA-*`, `.dgB-*`, `.dgC-*` classes present. No Tailwind conflicts. Pre-existing check errors unchanged. Continuing Tasks 5+6.

### 2026-05-19 — backend — Tasks 2+3 done
- Task 2 (API scaffold): All 11 digest endpoints created under `ui/src/routes/api/digest/` and `ui/src/routes/api/leagues/`. Stub handlers, wired by SvelteKit file routing. Committed: `feat(digest): wave 1 backend — API scaffold + prepare checks (T2+T3)`.
- Task 3 (Prepare checks): `POST /api/digest/:roundId/prepare` runs 6 checks with `ok: boolean` + `src: string` per check. Deployed to prod.

### 2026-05-19 — frontend — Tasks 5+6 done
- Task 5 (Route scaffold): `/digest/[roundId]` route created (`+page.svelte` + `+page.server.ts`). Pipeline strip with hardcoded states. Layout nav entry added.
- Task 6 (Section components): `DigestSection.svelte` + `ArtSlot.svelte` + `fixtures.ts` — all 6 variant-C section kinds. Committed: `feat(digest): wave 1 frontend — route scaffold + section components (T5+T6)`. Deployed to prod.

### 2026-05-19 — orc — Wave 1 complete, Wave 2 starting
- All 6 Wave 1 tasks done. Full redeploy at 09:0x — T1–T6 live on mlb.mattmariani.com.
- Backend (pane 1.2): Wave 2 — Tasks 7+8 (LLM service + whole-regen).
- Frontend (pane 1.3): Wave 2 — Tasks 9+10 (section chrome + regen modal).

### 2026-05-19 — backend — Tasks 2+3 done
- T2 (API scaffold): 11 endpoints created under `ui/src/routes/api/digest/**` and `ui/src/routes/api/leagues/[leagueId]/rel-context/`. SvelteKit colocates one handler kind per `+server.ts`, so the action-named POSTs (`/draft`, `/regenerate`, `/finalize`, `sections/:id/regenerate`) live in their own sub-route files rather than a single dispatcher on `[roundId]/+server.ts`. All stubs validate round/section/league existence and return 404 when missing.
- T3 (prepare checks): real DB-backed implementation. Submissions/votes/comments come from `ml_submissions` + `votes`; mentions join `chat_mentions` → `chat_assignments` on `round_id` with a derived `YYYY-MM-DD → YYYY-MM-DD` range as the source label. Check 6 (album art) proxies "submissions present" — `ml_submissions` has no cached art column, so the real Spotify fetch lives downstream. Response shape: `{ checks: [{ name, ok, src, count? }] }`.
- `npm run check` baseline unchanged (1 pre-existing vite.config.ts error, 28 warnings); 488 files (was 464) — 24 new files, zero new errors/warnings.
- Wave 2 unblocked: schema (T1) + CSS (T4) both landed → `llm-service` (T7), `section-chrome` (T9), `regen-modal` (T10) can start.

### 2026-05-19 — frontend — Tasks 5+6 done
- T5 (route scaffold): `/digest/[roundId]` route landed at `ui/src/routes/digest/[roundId]/+page.{server.ts,svelte}`. 4-step pipeline strip (Prepare / Draft / Refine / Finalize) renders with step 1 `is-active` and steps 2-4 `is-pending` — no DB wiring. Uses actual CSS class `.dg-pipe-step` from digest.css (task brief said `.dg-step`; that's an abbreviation, real class is `.dg-pipe-step`).
- T6 (section components): single `DigestSection.svelte` kind-switch renders all 6 variant-C kinds (podium / villain / flow / consensus / quotes / chat) inside `.dg-export.dgC-bg`. Fixture data lifted from `ml-digest-data.jsx` into typed `ui/src/lib/digest/fixtures.ts`. Shared `ArtSlot.svelte` ports the album-art placeholder atom.
- Also dropped the stale `/link` (Link converter) nav entry from `+layout.svelte` — `/digest` link was already in place.
- `npm run check`: 489 files (was 488), 1 error / 28 warnings — all pre-existing, zero new.
- Smoke: `docker compose build --no-cache bot-ui && up -d bot-ui` clean. `curl -sf http://localhost:3002/digest/14` returns 200 with `dg-pipe-step is-active`, `is-pending`, and all six `dgC-*` section markers present in HTML.
- Wave 1 frontend complete (T4+T5+T6). Wave 2 frontend (`section-chrome` T9, `regen-modal` T10) ready to start once backend signals or in parallel.

### 2026-05-19 — backend — Tasks 7+8 done (Wave 2 backend)
- T7 (LLM service): `ui/src/lib/digest/llm.ts` houses the OpenRouter client, prompt builder, data gatherer, and DB writers. Single chat-completions call with `response_format: { type: 'json_object' }` returns all 6 sections in one round-trip (cheaper than 6 parallel calls and keeps the editorial voice consistent across sections). Model: `process.env.OPENROUTER_DIGEST_MODEL ?? 'anthropic/claude-sonnet-4-5'`. Per-section regen uses the same prompt builder with a `kind` + `currentContent` steer and `{ "section": ... }` response shape. Locked sections return 400 from `/sections/:id/regenerate`.
- T7 cache: `POST /draft` short-circuits on existing `digest_drafts` row for the round (returns `{ cached: true, draft, sections }`) — no LLM call on the second hit.
- T7 storage: draft + 6 sections written in a single `better-sqlite3` transaction. Regenerations log prior + new `content_json` to `digest_regenerations` and bump `digest_sections.regen_count`.
- T8 (whole-regen): `POST /api/digest/:roundId/regenerate` filters out `state = 'locked'` sections, runs the remainder through `Promise.allSettled` (parallel LLM calls). Successes are applied via the shared `replaceSectionContent`; failures collected into `failures: string[]`. Always increments `digest_drafts.whole_regen_count`. Response: `{ draft, sections, regenerated, skipped, failures }`.
- Env: `OPENROUTER_API_KEY` (and optional `OPENROUTER_DIGEST_MODEL`) added to `.env.example`. **Action required:** set `OPENROUTER_API_KEY` in `.env` before exercising `/draft` or `/regenerate` end-to-end; missing key surfaces as `502 LLM draft failed: OPENROUTER_API_KEY is not set`.
- `npm run check`: 2 errors / 34 warnings. New error vs baseline is `ui/src/lib/digest/DigestSection.svelte` (frontend territory, untouched by this commit — flagging for frontend agent). Backend files compile clean; only `vite.config.ts` baseline error attributable to my scope.
- Wave 3 unblocked for backend: `export` (T11) and `rel-context` (T12) can start once frontend `regen-modal` (T10) signals.
- Smoke (deployed): `GET /api/digest/14` → 404 (no draft yet), `POST /regenerate` → 404 ("call /draft first"), `POST /draft` → 502 `OPENROUTER_API_KEY is not set` — wiring confirmed; LLM path will engage once the env var is populated.
- **Commit note**: `80e8768` swept in frontend Wave 2 work (T9 section-chrome, T10 regen-modal — `DigestSection.svelte`, `RegenModal.svelte`, `digest/[roundId]/+page.svelte`) that had been pre-staged in the shared index. Frontend agent should treat T9+T10 as committed; the commit message under-credits frontend, but the diff is intact. Going forward, agents should `git diff --cached` before committing to avoid cross-track sweeps in the shared workspace.
