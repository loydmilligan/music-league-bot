---
project: music-league-bot
sprint: sprint-12-remediation-ml-login-data-digest
created: 2026-05-31T22:50:32Z
updated: 2026-05-31T22:50:32Z
status: active
---

# music-league-bot — coordination doc (sprint-12-remediation-ml-login-data-digest)

> **Remediation sprint.** The `cli-web-musicleague auth login` flow broke
> (Playwright launched a headed browser with no X server). That blocks the
> export.zip data pull, which blocks fresh round data, which blocks digest
> generation. **Backend** owns the login fix + the data refresh. **Frontend**
> owns the recent-changes summary, the clean-baseline checks, and verifying the
> digest path is generatable once data is current.
>
> **Final boss (user-driven, not an agent task):** once login + data land, the
> user generates a digest for the most recent round in **Hip Jammers**,
> **Fam Jam**, and **Second Best** at https://mlb.mattmariani.com.

## Sprint Goals

- Get Music League login working again and pull fresh round data
  Restore the broken login, refresh the latest rounds, generate a digest end to end.

## Active Sprint Plan

- [ ] {agent: backend, id: login-fix} Restore the `cli-web-musicleague auth login` flow. Root cause from the captured failure: Playwright `launch_persistent_context` opened a **headed** Chromium with no X server (`Missing X server or $DISPLAY`, `ozone_platform_x11`). The login is interactive (user completes Spotify OAuth in the browser), so it fundamentally needs a visible browser OR a reuse of the already-authenticated persisted profile at `~/.config/cli-web-musicleague/browser-profile`. Decide and document the approach — propagate `$DISPLAY` to the `ml-auth-trigger.mjs` graphical-terminal spawn (the `/login` route), wrap in `xvfb-run`, or reuse the persisted profile for the non-interactive `leagues export` step while keeping the interactive login on a real display. Touch `scripts/ml-auth-trigger.mjs` and the CLI auth path under `musicleague/agent-harness/cli_web/musicleague/{commands,core}/auth.py` as needed.
  - **Acceptance:** Running the login flow (either `cli-web-musicleague auth login` directly in the orc workspace context, or `POST /login` via the host daemon) completes the Spotify OAuth without the `Missing X server / $DISPLAY` error. After completion, `node scripts/ml-auth-probe.mjs` (or the heartbeat in `src/api/mlAuthHeartbeat.ts`) reports an authenticated/valid session, and `data/ml-auth.json` shows a non-expired status. Document the chosen approach + the exact command to re-login in this coord-doc's Activity Log.

- [ ] {agent: backend, id: data-refresh, depends: login-fix} Restore the export.zip data pull and bring the latest rounds current for the three target leagues. Use the existing host-side bridge (`ml-auth-trigger.mjs` `/export-zip` → `cli-web-musicleague leagues export <id>` → `parseZip` + `importZipData`). **Hard constraint (documented in sprint-11's backend log):** `leagues export` only includes the *currently in-progress* round per league — completed rounds return zero deltas. Confirm which round is currently open in Hip Jammers, Fam Jam, and Second Best, run the export+import for each, and verify the round data landed. If the user's "recent round" is already closed for any league, surface that as a Blocker in this doc rather than silently no-op.
  - **Acceptance:** For each of Hip Jammers, Fam Jam, and Second Best, the current round's `import_log` shows a fresh `export.zip (cli-trigger)` entry, and the digest-prep export.zip checks (Submissions / Votes / Vote comments — prep-check indices 1,2,3) read green at https://mlb.mattmariani.com. List the three roundIds + their pre/post check states in the Activity Log.

- [ ] {agent: backend, id: core-tests} Bring the core/vitest suite to a known-clean, documented baseline. Run `npm test` (and `npm run test:integration` if it doesn't require live credentials — if it does, gate it behind login-fix and note that). Fix anything that rotted in core/server/spotify since sprint-11; for failures that are environmental (need live ML/Spotify auth), document them as skipped-with-reason rather than leaving a red suite.
  - **Acceptance:** `npm test` exits 0 with the pass/skip count recorded in the Activity Log; any intentionally-skipped tests name the reason (e.g. "requires live ml-auth, run post-login-fix"). No unexplained failures remain.

- [x] {agent: frontend, id: recent-changes} Produce the recent-changes summary the user asked for: what shipped since the last digest cut. Cover sprint-10 + sprint-11 (visible UI changes + under-the-hood) per the version+changelog handoff ritual. Update `CHANGELOG.md` (create if absent) and bump the UI version string synced to `package.json`.
  - **Acceptance:** `CHANGELOG.md` has a dated entry covering sprint-10 + sprint-11 shipped work (CLI export.zip ingest, Import-from-CLI button, unified rating bars + realtime fix, research-tab manual sort + auto-after-all-4, YTM Songlink ingest, extension wordmark icons), with the current version number; the same version renders in the webapp UI and matches `package.json`. Link the summary in this doc's Activity Log.

- [x] {agent: frontend, id: check-clean} Get `npm run check` to a clean baseline. The recurring pre-existing error is the `vite.config.ts` `test` overload (flagged in every sprint-11 Activity Log entry) — fix it so the build/check is error-free, and report the warning count.
  - **Acceptance:** `npm run check` exits with **0 errors** (the vite.config.ts overload resolved); warning count recorded in the Activity Log. No new errors introduced.

- [ ] {agent: frontend, id: digest-verify, depends: data-refresh} Verify the digest path is generatable end-to-end against the refreshed data, so the user's final-boss step is unblocked. For the current round in each of the three leagues, load `/digest/[roundId]` in the prepare stage, confirm the export.zip checks are green (post data-refresh), exercise the "Import from CLI" button + ml-auth badge, and confirm "Generate draft" produces a draft. Do **not** finalize — that's the user's call. Report any UI-side breakage found.
  - **Acceptance:** For Hip Jammers, Fam Jam, and Second Best current rounds: `/digest/[roundId]` prepare stage shows all export.zip checks green and "Generate draft" returns a draft (HTTP 200, draft content rendered). Any breakage is logged with the roundId + symptom in the Activity Log; if all three generate cleanly, log "digest path verified — ready for user finalize."

### Deploy

Each backend/frontend change deploys to prod per the always-deploy-to-prod convention in `CLAUDE.md`: `docker compose build --no-cache bot-ui && docker compose up -d --force-recreate bot-ui`. The `ml-auth-trigger` daemon runs host-side — restart it after edits via `systemctl --user restart mlb-auth-trigger.service`.

---

## Agent Roster

| Agent | Owns | Does not touch |
|---|---|---|
| backend | `scripts/ml-auth-trigger.mjs`, `scripts/ml-auth-probe.mjs`, `src/api/mlAuthHeartbeat.ts`, the `cli-web-musicleague` auth + export paths under `musicleague/agent-harness/cli_web/**`, `data/ml-auth.json` state, the export.zip import pipeline (`parseZip` / `importZipData`), `tests/**` (vitest core) | `ui/src/routes/digest/**` (frontend digest UI), `CHANGELOG.md`, `vite.config.ts` |
| frontend | `CHANGELOG.md`, the UI version string, `vite.config.ts` (the `test` overload error), `ui/src/routes/digest/[roundId]/+page.svelte` (verify-only — no new features this sprint) | `scripts/ml-auth-trigger.mjs`, `musicleague/**`, `data/ml-auth.json`, the import pipeline, `tests/**` |

---

## Decision Log

- **D1** — Remediation-only sprint. No new features; restore the broken login → refresh data → confirm digest path. Feature/brainstorm sprint is the next cycle.
- **D2** — Roster is backend + frontend (the sprint-10 extension agent / pane 1.4 stays paused).
- **D3** — "Recent round" for the final boss = the *currently in-progress* round per league, because `leagues export` only ships the open round. If the round the user wants is already closed, that's a Blocker, not a silent no-op.
- **D4** — Login fix approach (DISPLAY propagation vs xvfb-run vs persisted-profile reuse) is the backend agent's call; must be documented in the Activity Log with the exact re-login command.

## Blockers

## Activity Log

### 2026-06-01 — frontend — Wave 1 done: recent-changes + check-clean

**check-clean (id: check-clean) — DONE**
- Root cause of the recurring `vite.config.ts` error: `defineConfig` was imported
  from `'vite'`, whose `UserConfigExport` type has no `test` field → svelte-check
  `"No overload matches this call … 'test' does not exist"`. Fixed by importing
  `defineConfig` from `'vitest/config'` (vitest is already a devDep) — the
  vitest-aware config type accepts the `test` block. One-line import swap, added
  an explanatory comment.
- `npm run check` (run in `ui/`): **0 ERRORS, 28 WARNINGS** (was 1 error / 28
  warnings). Warnings are all pre-existing a11y + `state_referenced_locally`
  advisories — untouched this sprint, no new errors introduced.

**recent-changes (id: recent-changes) — DONE**
- Created `CHANGELOG.md` (repo root) with a dated `[0.2.0] — 2026-06-01` entry
  covering sprint-10 + sprint-11: CLI export.zip ingest, Import-from-CLI button,
  unified rating bars + realtime fix, research-tab manual sort + auto-after-all-4,
  Settings → API tokens, API tokens + bearer auth, Spotify URL ingest, YTM
  Songlink fallback, extension wordmark icons — split into Visible / Under the
  hood / Build sections. **Summary:** `CHANGELOG.md` → `[0.2.0]`.
- Bumped `ui/package.json` `0.0.1 → 0.2.0`. Surfaced the version in the sidebar
  footer (`ui/src/routes/+layout.svelte`) as `mash co. · v{appVersion}`, imported
  directly from `../../package.json` so the rendered version can never drift from
  the package version.

**Deploy + smoke**
- `docker compose build --no-cache bot-ui && docker compose up -d --force-recreate bot-ui` — built + recreated clean.
- Smoke `http://192.168.4.217:3002/` → 200; footer renders `mash co. · v0.2.0`,
  matching `ui/package.json`. Acceptance met (same version in UI + package.json).

**Lane note:** stayed in frontend lane — touched only `vite.config.ts`,
`ui/package.json`, `ui/src/routes/+layout.svelte`, and `CHANGELOG.md`. No
scripts/musicleague/import-pipeline/tests changes. `digest-verify` remains
blocked on backend `data-refresh` (Wave 2).

### 2026-05-31 — docs — Sprint plan refresh: remediation (ML login → data → digest)
- replaced `## Active Sprint Plan` body with 6 tasks for: restore `cli-web-musicleague` login (X-server/headed-Playwright root cause), restore export.zip data pull + refresh the 3 leagues' current rounds, core vitest baseline, recent-changes/CHANGELOG summary, `npm run check` clean (vite.config.ts overload), and end-to-end digest-path verify
- 3 backend / 3 frontend / 0 docs
- two real dependency chains: `data-refresh` depends `login-fix` (no auth → no pull); `digest-verify` depends `data-refresh` (no fresh data → can't confirm green). Everything else parallel.
- final boss (user generates the digests for Hip Jammers / Fam Jam / Second Best) is explicit user UAT, not an agent task — gated on `data-refresh` + `digest-verify`.
