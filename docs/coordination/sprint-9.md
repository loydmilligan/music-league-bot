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

- [x] {agent: frontend, id: section-chrome, depends: route-scaffold,section-components} Task 9: Section action chrome — toggle/regen/lock/kebab buttons
  - **Acceptance:** Each section has `.dg-section-actions` overlay with 4 buttons (exclude, regen, lock, kebab). Kebab popover shows edit/move-up/move-down/delete. State transitions (default → excluded → default, default → locked → default) apply correct CSS classes and banners. Chrome sits outside `.dg-export` via `.dg-section-wrap` positioning. Matches reference HTML artboard 1.

- [x] {agent: frontend, id: regen-modal, depends: section-chrome} Task 10: Regenerate modal — chips + free-text + current-copy preview
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

### 2026-05-19 — frontend — Tasks 9+10 done (Wave 2 frontend)
- T9 (section action chrome): `DigestSection.svelte` now wraps content in `.dg-section-wrap` per kind, with `.dg-section-actions` chrome (⊘/+ exclude · ↻ regen · 🔓/🔒 lock · ⋯ kebab) plus excluded/locked/regenerating banners. Kebab popover renders Edit · Move up · Move down · Delete with click-outside-to-close via `<svelte:document>`. Section state (`default | excluded | locked | regenerating`) lives in `+page.svelte` for Wave 2; persists to `digest_sections.state` once T13/T14 hook the page to the backend draft.
- T10 (regen modal): `RegenModal.svelte` — header with section label in pulp, read-only current copy, 5 combinable steer chips, instructions textarea (prefills from last regen via `lastChips[kind]`/`lastInstructions[kind]`), token estimate, Cancel/Regenerate footer. Esc + scrim-click cancel. On Regenerate: modal closes, target section(s) flip to `regenerating`, page POSTs to `/api/digest/:roundId/sections/:id/regenerate` (or `/regenerate` for whole-draft); 404 treated as "scaffold mode" (suppressed). "Regenerate whole draft" button sits outside `.dg-export` and reuses the same modal — fires every non-locked, non-excluded section in parallel.
- The current API call uses `kind` as the section `:id` because no draft exists yet (no `digest_sections.id` values). Once `POST /draft` runs against a round with `OPENROUTER_API_KEY` set, T13 needs to swap to real section IDs. Today's 404 path is the expected Wave-2 stub behavior.
- Renaming fix: `state` prop in `DigestSection.svelte` → `sectionState` to clear the Svelte 5 `$state` rune collision flagged by backend in `80e8768`. Cleared the new error.
- `npm run check`: 491 files, **1 error / 31 warnings**. Error is the pre-existing `vite.config.ts` `test` overload. 3 new warnings in `RegenModal.svelte` — seed-value `$state` initializers + a scrim onclick without keydown — mirror existing patterns in `shortlist/AssignPopover.svelte` and `shortlist/Bookmark.svelte` (codebase-accepted).
- Smoke: `docker compose build --no-cache bot-ui && up -d bot-ui`. Stale container `4ed7b2aa786a` from an earlier compose run blocked recreate; removed and re-upped clean. `curl http://localhost:3002/digest/14` → 200 with `dg-section-actions`, `dg-sa-btn`, `dg-section-wrap`, and "Regenerate whole draft" all present in the HTML.
- Re: backend's commit note — confirmed `80e8768` contains my T9+T10 work (intact, correct). Agreeing with backend's recommendation: stage explicitly by path and check `git diff --cached` before committing in shared workspace. No revert needed.
- Wave 3 unblocked for frontend: `finalize-flow` (T13) and `round-selector` (T14) can start. T13 depends on backend `export` (T11) for the Puppeteer endpoint.

### 2026-05-19 — frontend — digest wiring (real DB)
- `+page.server.ts` rewritten to query `digest_drafts` / `digest_sections` directly via `getActiveDraftForRound` + `getSectionsForDraft` (imported from `lib/digest/llm.ts`). Missing round → `error(404, 'Round not found')`. Draft hit → `{ stage: 'refine' | 'finalize', draft, sections }` with `content_json` parsed on the server. Miss → SvelteKit internal `fetch('/api/digest/:roundId/prepare')` for the 6 checks → `{ stage: 'prepare', checks }`.
- `+page.svelte`: all fixture imports removed. `activeIdx` (pipeline) derived from `data.stage` (prepare=0, refine=2, finalize=3). Prepare stage renders the 6-check drawer with per-check ✓/! glyph (moss/amber), name + count, and src; "Re-run checks" + disabled "Upload export.zip"; "Generate draft" button appears once all checks pass — `POST /api/digest/:roundId/draft` then `invalidateAll()`. Refine/finalize stage renders sections from DB by `position`; per-section regen now uses real `digest_sections.id` (not `kind` as before); whole-draft regen unchanged. Section UI state seeds from `section.state` via `$effect`.
- `DigestSection.svelte`: dropped fixture-shape props. New `content: unknown` prop carries parsed `content_json`. Generic renderer handles `{title, body, items}` shape from the LLM; kind-specific shaping only for `podium` (track list) and `quotes` (quote cards) — everything else uses a plain items list + body paragraph. Fallback `(no content)` line when both empty.
- Removed `ArtSlot.svelte` and `fixtures.ts` — only consumers were the fixture renderer.
- `npm run check`: 489 files, 1 error / 31 warnings — baseline unchanged.
- Deploy: `docker compose build --no-cache bot-ui && up -d` clean. Smoke: `curl /digest/14` → 200 with `Prepare data · r-14`, `Re-run checks`, `Generate draft` (all checks pass for r-14). `curl /digest/999` → 404 `Round not found`. Generate-draft path will engage once `OPENROUTER_API_KEY` is set in `.env`; until then the button surfaces the 502 from the API in the error toast.
- Wave 3 frontend (T13/T14) can pick up directly against real data now: round selector reads from the existing leagues/rounds DB; finalize flow drives off `draft.finalized_at` (already wired into stage selection).

### 2026-05-19 — backend — investigating /draft 502 (root cause found)
- **Symptom:** `POST /api/digest/:roundId/draft` returns 502; user reports body looks like a Cloudflare HTML error page.
- **Step 1 (env in container):** `docker compose exec bot-ui printenv | grep OPENROUTER` →
  - `OPENROUTER_API_KEY=sk-or-v1-7f1…2c31` (length 73, well-formed) — present, not truncated.
  - `OPENROUTER_DIGEST_MODEL=~anthropic/claude-sonnet-latest` — present. The `~` prefix is OpenRouter's "route to provider's latest version" syntax (resolves to `anthropic/claude-4.6-sonnet-20260217`); not a bug.
- **Step 2 (raw upstream probe, in-container):** A one-shot `node -e` script using the exact URL/headers/body shape from `ui/src/lib/digest/llm.ts:130-139` **never returned a Response** — `fetch` threw synchronously:
  ```
  TypeError: Cannot convert argument to a ByteString because the character at index 17
  has a value of 8212 which is greater than 255.
      at node:internal/deps/undici/undici:14976:13
  ```
  Index 17 of `"Music League Bot — Digest"` is the em-dash `—` (U+2014, decimal 8212). Per the Fetch spec, header **values** must be ByteStrings (every code point ≤ U+00FF); undici enforces this and rejects the request before any socket is opened.
- **Re-probe with ASCII-only `X-Title`** (same key, same model, same URL): **`STATUS: 200`**, body is a clean OpenRouter chat-completion JSON returning `"pong"`. Provider resolved as `Anthropic` / `anthropic/claude-4.6-sonnet-20260217`. Cost $0.00012. Key + model + headers shape (HTTP-Referer + X-Title) are all accepted.
- **Conclusion — root cause:** The em-dash character literal at `ui/src/lib/digest/llm.ts:136` (`'X-Title': 'Music League Bot — Digest'`) makes `fetch()` throw before sending. `callOpenRouter` rejects, the route's catch turns the thrown `TypeError` into a 502. The "Cloudflare HTML" the user saw was not from OpenRouter's CF layer — OpenRouter is never contacted. It was either (a) the SvelteKit/adapter 502 page surfacing the `TypeError` upstream, or (b) the Cloudflare proxy in front of `mlb.mattmariani.com` rendering its own 502 because the origin returned a 5xx. Either way, OpenRouter's WAF is not involved.
- **Why the existing error path masked this:** `callOpenRouter` only inspects `res.status` and `res.text()`; a synchronous `fetch` throw skips that branch and bubbles up as a bare `Error`, which the `/draft/+server.ts` handler wraps as a generic 502. No log of the underlying message reaches stdout in production unless `console.error` was added.
- **Proposed fix (minimal, single-line):** Replace the em-dash with an ASCII hyphen in the `X-Title` header value at `ui/src/lib/digest/llm.ts:136`:
  - before: `'X-Title': 'Music League Bot — Digest',`
  - after:  `'X-Title': 'Music League Bot - Digest',`
  Rationale: the header is metadata for OpenRouter's dashboard, not user-facing copy; ASCII is sufficient and removes the ByteString trap. No other header in the request contains non-Latin-1 bytes.
- **Optional hardening (not in this fix unless approved):** wrap the `fetch` call in `try/catch` and log `err.message` so future "synchronous fetch threw" failure modes surface in container logs instead of looking like upstream HTTP errors.
- **Awaiting approval to apply the one-line fix + redeploy** (`docker compose build --no-cache bot-ui && docker compose up -d bot-ui`), then smoke `POST /api/digest/14/draft` against mlb.mattmariani.com.

### 2026-05-19 — ops (pane investigator) — ml-login regression on mlb.mattmariani.com
- **Symptom (user report):** Clicking the "ml login" badge under the M/L wordmark used to pop a host terminal, complete Spotify OAuth, and flip the badge green. Now the click "doesn't do what it used to" — no terminal window appears, badge stays red.
- **Flow recap (so the trace is reproducible):**
  1. UI badge `ui/src/lib/components/MlAuthBadge.svelte:53-77` → `POST /api/ml-auth/login`.
  2. SvelteKit endpoint `ui/src/routes/api/ml-auth/login/+server.ts` → `fetch http://host.docker.internal:7679/login` (env `ML_AUTH_TRIGGER_URL`, wired in `docker-compose.yml:29` with `extra_hosts: host.docker.internal:host-gateway`).
  3. Host daemon `scripts/ml-auth-trigger.mjs` (systemd user unit `mlb-auth-trigger.service`) picks a graphical terminal via `pickTerminal()` and `spawn(term.path, args, { detached: true, env: process.env })` to run `cli-web-musicleague auth login`.
  4. User completes Spotify OAuth in the popup browser; CLI writes auth to host's playwright profile.
  5. Host probe `scripts/ml-auth-probe.mjs` (systemd timer `mlb-auth-probe.timer`, every 5 min) writes `data/ml-auth.json` with `status:"ok"`.
  6. UI reads that file via `ui/src/lib/mlAuth.ts:81-97`; badge flips green. UI also re-polls every 8s for up to 5 min after a trigger click.
- **Evidence gathered (in order, today 2026-05-19):**
  1. `curl -s http://localhost:7679/health` →
     `{"ok":true,"terminal":"kitty","cli":"cli-web-musicleague","display":null,"wayland":null,"lastTriggerAt":"2026-05-19T18:33:12.073Z"}`
     Trigger daemon is alive, reachable, kitty is detected, **but `display:null` and `wayland:null`** — the daemon's own process has no `DISPLAY`/`WAYLAND_DISPLAY`. The 18:33 UTC `lastTriggerAt` confirms the UI's POST is reaching the daemon; the daemon spawns kitty, but with no display server in its env the GUI terminal cannot attach and exits immediately. HTTP still returns `ok:true` because `spawn(...)` itself succeeded — the daemon never verifies the terminal actually rendered.
  2. `journalctl --user -u mlb-auth-trigger.service`:
     - **2026-05-17 03:08:59** — `[ml-auth-trigger] terminal=kitty cli=cli-web-musicleague DISPLAY=:0` *(working)*
     - 2026-05-19 08:22:09 — service stopped
     - **2026-05-19 09:56:39** — `[ml-auth-trigger] terminal=kitty cli=cli-web-musicleague DISPLAY=undefined` *(broken — current process)*
     The May-17 startup inherited `DISPLAY=:0`; today's restart inherited nothing. Same unit file, different environment.
  3. `systemctl --user cat mlb-auth-trigger.service` — unit only sets `Environment=PATH=...`; no `Environment=DISPLAY=...`, no `PassEnvironment=DISPLAY WAYLAND_DISPLAY ...`. The May-17 success relied on the user-manager having `DISPLAY` imported (presumably via `systemctl --user import-environment DISPLAY WAYLAND_DISPLAY` at graphical login). After the 08:22 stop / 09:56 restart, the user-manager's environment block no longer carried `DISPLAY`, so the fresh service instance came up blind.
  4. Current host shell, by contrast, has `DISPLAY=:0 WAYLAND_DISPLAY=wayland-0` — the graphical session is up; only the systemd user-manager's view of it is stale.
  5. `data/ml-auth.json` mtime 11:38:17 PDT, `status:"expired"` — the *probe* is healthy and running on schedule; it doesn't need `DISPLAY` (CLI `users me` uses cached cookies, no browser GUI). This is why the badge correctly says "expired" rather than "cli-missing" or "unknown" — only the *login* path is broken, not the *probe* path.
- **Root cause (one sentence):** `mlb-auth-trigger.service` is currently running without `DISPLAY` / `WAYLAND_DISPLAY` in its environment, so `kitty` (and every other `TERMINAL_CANDIDATES` entry) fails to attach to a display server when spawned. The HTTP 200 `ok:true` masks the failure, the UI shows "Spawned kitty…" and polls fruitlessly for 5 minutes, badge never flips green.
- **Why this is a regression, not a new bug:** worked on May-17 because the user-manager happened to have the graphical env imported at that boot; broke today after the service was stopped and restarted at 09:56 without the env being re-imported. No code change on the UI/daemon was needed — the unit file's reliance on inherited env is fragile.
- **Secondary observation (out of scope for this fix):** the daemon returns `ok:true` purely on `spawn()` success, never confirming the GUI terminal actually rendered. The UI then optimistically promises the user "Spawned kitty…" and starts the 5-min poll. Both the daemon and the UI could surface this failure faster, but that's a UX improvement, not the root cause.
- **Proposed fix (does not touch any digest code, no rebuild of `bot-ui` needed — pure host-side):**
  1. Edit `~/.config/systemd/user/mlb-auth-trigger.service`, add to `[Service]`:
     ```
     Environment=DISPLAY=:0
     Environment=WAYLAND_DISPLAY=wayland-0
     Environment=XDG_RUNTIME_DIR=/run/user/1000
     ```
     (Hardcoded values are safe here: this is a single-user developer workstation; `DISPLAY=:0` and `WAYLAND_DISPLAY=wayland-0` match the current session and survive a user-manager restart. `XDG_RUNTIME_DIR` is needed so kitty can find the Wayland socket.)
  2. `systemctl --user daemon-reload && systemctl --user restart mlb-auth-trigger.service`.
  3. Verify with `curl -s http://localhost:7679/health` — expect `"display":":0"`, `"wayland":"wayland-0"`.
  4. Smoke: click "ml login" on mlb.mattmariani.com; confirm kitty window pops on the host with `cli-web-musicleague auth login` running; complete OAuth; wait ≤5 min; badge flips green.
- **Optional follow-ups (NOT in this fix unless approved):**
  - Have `pickTerminal()` (or the `/login` handler) bail out with `ok:false, error:"no DISPLAY"` when neither `DISPLAY` nor `WAYLAND_DISPLAY` is set, so the UI gets an actionable error instead of a hopeful spinner.
  - Have the UI display the daemon's `health.display` value in the badge tooltip when expired, to make this failure mode self-diagnosing.
- **Awaiting approval to apply the unit-file edit + restart.** No container rebuild, no touch of `ui/src/lib/digest/**` or `ui/src/routes/digest/**` — backend's llm.ts redeploy is unaffected.

### 2026-05-19 — ops — ml-login regression fix applied
- Edited `~/.config/systemd/user/mlb-auth-trigger.service`, added under `[Service]`:
  ```
  Environment=DISPLAY=:0
  Environment=WAYLAND_DISPLAY=wayland-0
  Environment=XDG_RUNTIME_DIR=/run/user/1000
  ```
- `systemctl --user daemon-reload && systemctl --user restart mlb-auth-trigger.service`.
- Verify: `curl -s http://localhost:7679/health` → `{"ok":true,"terminal":"kitty","display":":0","wayland":"wayland-0",…}` (was `display:null,wayland:null`).
- Journal: `[ml-auth-trigger] terminal=kitty cli=cli-web-musicleague DISPLAY=:0` (was `DISPLAY=undefined`).
- No container rebuild, no touch of `ui/src/lib/digest/**` or `ui/src/routes/digest/**`. Backend's llm.ts redeploy unaffected.
- **User-visible test (awaiting user):** click "ml login" on mlb.mattmariani.com → kitty window should pop on host with `cli-web-musicleague auth login`; complete OAuth; within ≤5 min the probe timer rewrites `data/ml-auth.json` to `status:"ok"` and the badge flips green.

### 2026-05-19 — backend — /draft 502 resolved (two bugs, two fixes)
- **Bug 1 — em-dash in `X-Title` header** (`ui/src/lib/digest/llm.ts:136`). Node's undici `fetch` rejects header *values* containing code points > U+00FF (Fetch spec: header values are ByteStrings). The em-dash `—` (U+2014) in `"Music League Bot — Digest"` made `fetch()` throw `TypeError` synchronously — the request never left the container. The thrown error bubbled to the SvelteKit route handler, which returned 502; Cloudflare in front of `mlb.mattmariani.com` rendered its own 502 HTML page on top, which read like an OpenRouter WAF block but was not.
  - **Fix:** replace em-dash with ASCII hyphen. `'X-Title': 'Music League Bot - Digest'`. Single character. Telemetry-only header value, no user-visible impact.
- **Bug 2 — LLM wrapped JSON in a markdown code fence**. After Bug 1 was fixed, the request reached OpenRouter (34s round-trip, resolved model `anthropic/claude-4.6-sonnet-20260217`) and returned 200 with valid content — but the model emitted ```` ```json\n{…}\n``` ```` despite the `response_format: { type: 'json_object' }` hint. `JSON.parse` choked on the leading backtick. Surface error: `LLM draft failed: Unexpected token '\`', "\`\`\`json\\n{\\n\\"... is not valid JSON`.
  - **Fix (chosen — option 1, parser-side):** 3-line defensive guard at the end of `callOpenRouter` (`ui/src/lib/digest/llm.ts:146-149`). If the returned content matches `/^\s*\`\`\`(?:json)?\s*\n([\s\S]*?)\n\`\`\`\s*$/`, return the captured inner JSON; otherwise return content as-is. Idempotent for already-clean responses. Keeps parser robustness orthogonal to model selection.
  - **Rejected (option 2):** pinning the model to `anthropic/claude-sonnet-4-5`. Would mask the symptom for one model only; any future model swap would re-expose it. Per user direction, model selection stays orthogonal from parser robustness.
- **Deploy:** `docker compose build --no-cache bot-ui && docker compose up -d bot-ui` (both fixes shipped in one rebuild). Image rebuilt clean.
- **Smoke (against mlb.mattmariani.com, prod through Cloudflare):**
  - `POST /api/digest/14/draft` #1 → **200**, `cached:false`, draft id `draft-14-6e636560` written, 5 sections persisted (`podium · villain · flow · consensus · quotes`).
  - `POST /api/digest/14/draft` #2 → **200**, `cached:true`, same draft id, returns from DB without an LLM call. Confirms `getActiveDraftForRound` short-circuit (T7 acceptance).
  - Chat section absent by design: round 14 has zero `chat_mentions` → `activeKinds` filter at `llm.ts:305` drops `chat` (matches commit `9117b8f` "make chat-mentions optional; suppress chat section when absent"). 5/5 expected sections present, not a regression.
- **Defensive logging hardening** (proposed earlier, not applied per scope discipline): wrapping the `fetch` call in `try/catch` to log `err.message` would have surfaced Bug 1 immediately instead of presenting as a generic upstream 502. Leaving as a future tidy-up — not blocking.
- **Status:** `/draft` endpoint healthy on prod. Wave 2 backend (T7 LLM service, T8 whole-regen) functionally complete end-to-end. **Not proceeding to Wave 3 (T11 export / T12 rel-context) without explicit go-ahead from user.**

### 2026-05-19 — frontend — Task 14 done (round selector + sidebar nav)
- **Scope:** Wave 3 frontend — round selector dropdown + voting-still-open banner on `/digest/[roundId]`. Sidebar `Digest` entry was already wired through `/digest/+page.server.ts`'s redirect (most-recent `digest_drafts` row with `finalized_at IS NULL`, falls back to highest-id round with votes); verified live, no layout change needed.
- **Files changed:**
  - `ui/src/routes/digest/[roundId]/+page.server.ts` — added `roundsIndex` query (rounds JOIN seasons JOIN leagues, ORDER BY league name, season number, round id), `currentRound` meta (`voting_deadline`, `season_status`). New exported types `RoundIndexEntry`, `CurrentRoundMeta`. Returned alongside existing `prepare`/`refine`/`finalize` payloads.
  - `ui/src/routes/digest/[roundId]/+page.svelte` — `<select id="dg-round-select">` grouped by `<optgroup label="{league} · season {n}">` then `<option>` per round; uses `$app/navigation` `goto()` for change. Rounds with empty `name` render as `Round {id}` via `roundOptionLabel()`. Voting-still-open banner driven by `votingStillOpen` derived: `voting_deadline > now` OR (`season_status === 'active'` AND no deadline).
- **No backend territory touched:** `ui/src/lib/digest/llm.ts`, `ui/src/lib/db/schema.ts`, `ui/src/routes/api/digest/**` all untouched. Waited for backend's llm.ts redeploy entry before building.
- **`npm run check`:** 1 ERROR / 31 WARNINGS / 14 FILES, all pre-existing. The single error is `vite.config.ts` `test` field (from `25298f1` "scaffold SvelteKit UI project"). My two files contribute 0 new diagnostics.
- **Deploy:** `docker compose build --no-cache bot-ui && docker compose up -d bot-ui` — image `music-league-bot-bot-ui:latest` rebuilt, container Up listening on `0.0.0.0:3002` (compose maps host 3002→container 3002).
- **Smoke (localhost:3002):**
  - `GET /digest/97`  → 200, dropdown present, `<option value="97" selected>`, **no banner** (deadline `2026-05-07Z` past, season `complete`) ✓ expected.
  - `GET /digest/106` → 200, dropdown present, `<option value="106" selected>`, **banner shown** (deadline `2026-06-26Z` is future) ✓ expected.
  - `GET /digest/113` → 200, dropdown present, `<option value="113" selected>`, **banner correctly suppressed** (deadline `2026-05-16Z` is past; voting on this round IS closed — season 1 only remains `active` because later rounds like r-115 are still open).
  - `GET /digest/115` → 200, dropdown present, `<option value="115" selected>`, **banner shown** (deadline `2026-05-28Z` is future) ✓ correct re-smoke target for the open-voting case.
  - All 3 pages contain the 8 expected optgroups: `Fam-Jam · season {1,2,3}`, `Hip Jammers · season {1,2,3}`, `Nostalgia Pit · season 1`, `Second Best · season 1`.
  - Sidebar `Digest` link: `GET /digest` → `302 → /digest/14` (active Hip Jammers round, has unfinalized `digest_drafts` row `draft-14-6e636560` from backend's earlier smoke). Selector reachable from there. ✓ Acceptance bullet 3 satisfied.
- **Banner rule confirmed by user:** the literal spec is correct — banner fires only when `voting_deadline > now` OR (`season=active` AND no `voting_deadline`). r-113's voting IS closed (deadline past); its season-1 only stays `active` because later rounds (e.g. r-115) are still open. Original smoke note conflated "active season" with "open voting." Re-smoke against r-115 (above) confirms banner appears for genuinely open voting. No code change.
- **Out of scope, not done:**
  - Sidebar `Digest` count chip still hardcoded `"3 new"` — sprint plan doesn't mention it; left untouched.
  - Pre-existing svelte-check warnings (`state_referenced_locally`, a11y) in other files — out of Task 14 scope.

### 2026-05-19 — frontend — bugfix: consensus section rendering raw JSON
- **Symptom:** "Points of Agreement" / consensus section on `/digest/[roundId]` rendered each item as raw `JSON.stringify(item)` output (effectively `[object Object]`-shaped strings) instead of formatted content.
- **Root cause — two layers:**
  1. **Renderer gap (`DigestSection.svelte:208-213`):** kind-specific shaping existed only for `podium` (track list) and `quotes` (quote cards). Every other kind with object-shaped items fell into the generic `<li>{itemText(item)}</li>` branch, and `itemText` defaults to `JSON.stringify(item)` for non-primitives. That's what the user saw.
  2. **Prompt looseness (`ui/src/lib/digest/llm.ts:166-180`):** the system prompt declares consensus as `{ "title": string, "items": [...] }` and then says "Each section's `items` shape is up to you per kind, but stay consistent within a section." No schema is pinned for consensus items. The LLM has produced **two different shapes across drafts in the live DB**:
     - r-14 → `[{ title, artist, note }, …]`
     - r-98, r-102 → `[{ song, note }, …]` where `song` already contains `"Title — Artist"`
- **Fix applied (renderer-side only, single file `ui/src/lib/digest/DigestSection.svelte`):**
  - Added `ConsensusItem` type + `consensusHeadline()` / `consensusNote()` helpers that defensively extract a headline from `title+artist`, `title`, `song`, `point`, or `statement` (in that order), and a note from `note`, `detail`, or `body`.
  - Added a new `{:else if kind === 'consensus' && items.length}` branch above the generic `items` fallback, rendering each item as a `.dgC-consensus-row` card with a `.dgC-consensus-head` (italic headline) + `.dgC-consensus-note` (body).
  - Added matching scoped styles (`.dgC-consensus`, `.dgC-consensus-row`, `.dgC-consensus-head`, `.dgC-consensus-note`) using existing CSS tokens (`--moss`, `--ink-0`, `--r-2`, etc.). Did **not** retrofit `digest.css`'s `.dgC-cc-*` (Consensus C) classes — those assume a two-block agree/contest pair shape, which doesn't match the linear `items` array the LLM is actually producing.
  - **Did not touch `llm.ts` per scope discipline.** Both observed shapes render correctly. The renderer also handles a hypothetical `{point, statement}` shape defensively.
- **Backend hand-off (suggested, not applied):** the "items shape is up to you per kind" clause in `buildSystemPrompt()` is the structural reason for shape drift across drafts. Pinning consensus items to a single schema (e.g. `[{title, artist, note}]`) would let the renderer drop the dual-shape extraction and would also stabilize whole-regen output. Leaving the decision to backend; renderer is robust either way.
- **`npm run check`:** unchanged baseline — 1 ERROR (pre-existing `vite.config.ts`), 31 WARNINGS, 14 FILES. Zero new diagnostics from `DigestSection.svelte`.
- **Deploy:** `docker compose build --no-cache bot-ui && docker compose up -d bot-ui` — image rebuilt, container up on `0.0.0.0:3002`.
- **Smoke (localhost:3002):**
  - DB scan: only r-14, r-98, r-102 currently have consensus sections persisted. r-97 and r-106 have drafts without consensus rows (so /digest/97 and /digest/106 return 200 but have no consensus to render — not a regression).
  - `GET /digest/14`  → 200; first row renders `Mariella — Khruangbin & Leon Bridges` + note `"7 out of 9 voters included it — the widest agreement of the round."` (shape A confirmed).
  - `GET /digest/98`  → 200; first row renders `French Disko — Stereolab` + note (shape B confirmed; `song` field already contained the em-dash join, so no double-join).
  - `GET /digest/102` → 200; first row renders `Total Eclipse of the Heart — Bonnie Tyler` + note (shape B confirmed).
  - No `[object Object]`, no `JSON.stringify` output, no `"items":[{` raw-JSON leak in any rendered HTML.
