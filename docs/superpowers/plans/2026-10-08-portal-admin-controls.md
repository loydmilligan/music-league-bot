# Portal admin controls — implementation plan

Spec: `docs/superpowers/specs/2026-10-08-portal-admin-controls-design.md`
Execution: on the current working tree (piece 4 is already in flight, uncommitted). TDD per task — bot-ui side tests run under `ui/` (`cd ui && npx vitest run <file>`; the ui suite is excluded from the root vitest project, which only collects `tests/**`), bside sources imported by relative path exactly as `ui/src/lib/portal/homeCards.test.ts` does. Root `npm test` covers the bot core only. `npm run check` in `bside/` after every b-side task (4 pre-existing TasteSettings errors in ProfileScreen.svelte; not caused by this work).

---

## Task 1 — Config model + catalog (bot-ui)

- `ui/src/lib/portalAdmin/config.ts`: `PortalAdminConfig` type, `DEFAULT_CONFIG`, `SECTION_IDS`, `FREQUENCIES`, `KPI_CATALOG` (ids `songs | points | winners | noteWords`), `defaultConfig()` (every KPI selected), `mergeConfig(current, patch)` (deep-merge `sections`, unknown ids dropped), `parseConfig(raw)` (zod).
- Storage: `settings` key `portal_admin_config:<leagueId>` via the existing `readSetting`/`writeSetting` helpers (new `ui/src/lib/portalAdmin/store.ts`, mirroring `portalJson.ts`'s `readSetting`).
- Tests: defaults select every catalog id; partial patch merges and preserves untouched sections; bad frequency / unknown section id rejected; `prompt: null` survives a merge.

## Task 2 — KPI stable ids

- `buildKpis` stamps `id` on each KPI; `KpiItemSchema` gains `id: z.string().optional()`.
- HomeScreen filters on `portal.sections.byNumbers.kpis` when present, else renders all.
- Tests: `buildKpis` returns the four ids (existing `buildReadModel` fixtures); a read model with no `id`s still validates; filter falls back to all.

## Task 3 — `portal.json`: sections + roundLinks

- `ui/src/lib/portal/portalJson.ts`:
  - `PortalJson` gains `sections: PublicSections | null` and `roundLinks: PortalRoundLinks[]`.
  - `roundLinks` assembled from `rounds.spotify_playlist_url`, `ytm_drops.ytm_url`, the ytm video-review `videoUrl`, and `https://app.musicleague.com/l/{seasons.source_competition_id}/{rounds.ml_round_id}/` — **URLs + round number only**.
  - `sections` = display subset of the config (`enabled`, `cards`, `links`, `kpis`, `players`) — no prompts, no `runState`.
- `writePortalJson` runs `findLeaks` over the new fields as it already does the rest.
- Tests: link assembly per source with nulls; leaky string rejected; display subset omits `prompt`/`runState`; `bside/src/lib/portal.ts` mirror types updated.
- Rewire every `writePortalJson` call site that already exists so an admin save triggers a rewrite.

## Task 4 — Current-round card (bside)

- `bside/src/lib/homeCards.ts`: add `currentRound(feed, now)` → `{ round, phase: 'submission' | 'voting' } | null` (in-flight round from `songsDue`/`votesDue`); keep `upNext()` as the fallback.
- `bside/src/lib/portal.ts`: `roundLinks` type + `roundLinksFor(portal, n)` helper.
- `HomeScreen.svelte`: replace the *Up next* card with **Current round** — name, phase pill, deadline, and one button per link that exists (Spotify / YouTube Music / YouTube video / Music League), all `target="_blank" rel="noopener"`. Falls back to *Up next* with no pill when no round is in flight.
- Add the **Open theme survey** card (`feed.surveyOpen` → `/{slug}/survey`).
- Tests: phase boundary at `songsDue`; no feed → null; link buttons only for non-null urls; hidden round name never comes from `portal.roundLinks`.

## Task 5 — Section gating + drop *Fresh off the press* (bside)

- `HomeScreen.svelte`: render each section only when `portal.sections?.<id>.enabled ?? true` (default-on so a stale `portal.json` changes nothing).
- Remove the *Fresh off the press / Latest round* section; move its "All digests →" archive link into the *This week* footer.
- Move the *Post to Home* admin card from the Access tab to the B-side tab (`AdminScreen.svelte`).
- Tests: enabled flags gate sections; missing `sections` object renders everything; archive link still present.

## Task 6 — b-side admin screen: tabs

- `AdminScreen.svelte` → tab shell: **Access · B-side · Season planner**; new tabs gated on `session.api.adminSession().admin` (already fetched). Access tab content unchanged.
- New `bside/src/lib/portalAdminApi.ts`: typed client over `/api/portal-admin/<slug>/…` (`credentials: 'same-origin'`, 10 s timeout, same error mapping as `surveyApi.ts`).
- Tests: `portalAdminApi` URL building, timeout, 401/405 mapping (mocked fetch).

## Task 7 — B-side tab UI

- Section cards: include toggle, frequency select, *last run* / *next due (pending automation)*, **Run now** (202 → poll → *Updated hh:mm* / *Failed: …*).
- Per-section editors: This-week card + link checkboxes; KPI pill picker fed by the catalog endpoint (all pre-selected); family per-player pills with All/None and a live count; yearbook season select; pulse + moments prompt textareas with *Reset to default*.
- `POST/PUT config` on every change (debounced for textareas), optimistic UI with rollback on error.
- Tests: picker pre-selection equals catalog size; a deselected KPI is not sent as selected; save→reload round-trip against a mocked endpoint.

## Task 8 — Season planner derivation

- `ui/src/lib/portalAdmin/plan.ts`: `deriveTasks(season, rounds, now)` per spec §7.2 (pure, no DB).
- `ui/src/lib/portalAdmin/taskStore.ts`: upsert-by-`key` with the preservation rules (never overwrite `done`, `skipped`, or `custom`; update `due_at` for open derived rows; do not resurrect a deleted-and-done key).
- Schema: `portal_admin_tasks` (spec §7.1) via idempotent `CREATE TABLE IF NOT EXISTS` + migration on open.
- Tests: full 10-round derivation; idempotent re-derive; deadline change moves an open row; done row survives; custom row survives; season.start precedes R1 submission; R1 review due when R2 enters submission.

## Task 9 — Planner API

- `ui/src/routes/api/portal-admin/[slug]/…` handlers: `config` (GET/PUT), `sections` (GET), `run` (POST) + `run/[jobId]` (GET), `plan` (GET `?days=`), `plan/derive` (POST), `plan/task` (POST/PATCH/DELETE).
- Shared `handlePortalAdmin(fn)` wrapper: `verifyPortalAdmin` first (fail closed), then route.
- `run` reuses the existing update pipeline and stamps `runState`.
- Tests: zod validation failures → 400; unknown section id → 400; plan window grouping (today / tomorrow / +2…+6, overdue pinned).

## Task 10 — Auth (fail-closed)

- `ui/src/lib/portalAdmin/auth.ts`: `verifyPortalAdmin(req)` — RS256 verify of `Cf-Access-Jwt-Assertion` against the team JWKS (cached, `kid` refresh), `iss`/`exp`/`aud`, `email ∈ PORTAL_ADMIN_EMAILS`; every failure → 401 with a generic body.
- `hooks.server.ts`: mount the `/api/portal-admin` route group with an explicit allow-list; unmatched path under the prefix → 404 (never falls through to a page route).
- Tests: missing/expired/wrong-audience/bad-kid token, empty `PORTAL_ADMIN_EMAILS` (fail closed), unknown path under the prefix → 404.

## Task 11 — Planner UI (bside)

- `bside/src/routes/AdminScreen.svelte` → Season planner tab, or a dedicated `PlannerPanel.svelte`:
  - **Day planner** (default): next 7 days, grouped Today / Tomorrow / +2…+6, overdue group pinned above, one-tap done toggle, expandable detail + notes, dimmed empty days.
  - **Full season**: grouped by round with `n / m done`, inline **+ Add task**, due-date edit, skip.
  - Header counts (`N open · M overdue`) + view switch.
- Tests: window grouping and ordering; overdue precedence; done toggle payload.

## Task 12 — Transport

- `Caddyfile.digest`: new `handle /api/portal-admin/*` block after `/api/survey/*` (GET/POST/PUT, 405 otherwise, 64 KB cap, `reverse_proxy bot-ui:3002`) + the exception comment recording the Access gating and the "no third bot-ui path" rule.
- `docker-compose.yml`: document the Access dependency on `digest-static` (no functional change).
- Verify: `docker run --rm -v $PWD/Caddyfile.digest:/etc/caddy/Caddyfile caddy:2-alpine caddy validate`; throwaway-container probe for 405 / 413 / pass-through / `/api/p/*` untouched.

## Task 13 — Cloudflare Access (ops, out of band)

- Self-hosted Access application `digest.mattmariani.com/api/portal-admin*`, policy = admin group.
- `PORTAL_ADMIN_EMAILS` in `.env` (and bot-ui's env file), matching the Access group.
- Recorded in `ops/` notes + the Caddy comment.

## Task 14 — Verify + deploy

- `npm test` (root), `cd bside && npm run check && npm run build`.
- Playwright against the Second Best portal: tabs gated on admin, KPI picker pre-selects 4, section toggle survives reload, Run now runs to *Updated*, planner shows the next 7 days with round-badged tasks, direct `localhost:3002/api/portal-admin/…` with a spoofed email header → 401.
- Copy `bside/dist` to `digests/_bside/`, rebuild bot-ui, `caddy validate`, reload the tunnel.
- Update `docs/how-to/player-portal-and-digest-workflow.md` §1 "For admins".

**Dependency order:** 1 → 2, 3 → 4, 5 → 6 → 7, 8 → 9 → 11, 10 can land any time after 9 starts, 12 after 9, 13/14 last.
