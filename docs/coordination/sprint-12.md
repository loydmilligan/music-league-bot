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

- [x] {agent: backend, id: login-fix} Restore the `cli-web-musicleague auth login` flow. Root cause from the captured failure: Playwright `launch_persistent_context` opened a **headed** Chromium with no X server (`Missing X server or $DISPLAY`, `ozone_platform_x11`). The login is interactive (user completes Spotify OAuth in the browser), so it fundamentally needs a visible browser OR a reuse of the already-authenticated persisted profile at `~/.config/cli-web-musicleague/browser-profile`. Decide and document the approach — propagate `$DISPLAY` to the `ml-auth-trigger.mjs` graphical-terminal spawn (the `/login` route), wrap in `xvfb-run`, or reuse the persisted profile for the non-interactive `leagues export` step while keeping the interactive login on a real display. Touch `scripts/ml-auth-trigger.mjs` and the CLI auth path under `musicleague/agent-harness/cli_web/musicleague/{commands,core}/auth.py` as needed.
  - **Acceptance:** Running the login flow (either `cli-web-musicleague auth login` directly in the orc workspace context, or `POST /login` via the host daemon) completes the Spotify OAuth without the `Missing X server / $DISPLAY` error. After completion, `node scripts/ml-auth-probe.mjs` (or the heartbeat in `src/api/mlAuthHeartbeat.ts`) reports an authenticated/valid session, and `data/ml-auth.json` shows a non-expired status. Document the chosen approach + the exact command to re-login in this coord-doc's Activity Log.

- [x] {agent: backend, id: data-refresh, depends: login-fix} Restore the export.zip data pull and bring the latest rounds current for the three target leagues. Use the existing host-side bridge (`ml-auth-trigger.mjs` `/export-zip` → `cli-web-musicleague leagues export <id>` → `parseZip` + `importZipData`). **Hard constraint (documented in sprint-11's backend log):** `leagues export` only includes the *currently in-progress* round per league — completed rounds return zero deltas. Confirm which round is currently open in Hip Jammers, Fam Jam, and Second Best, run the export+import for each, and verify the round data landed. If the user's "recent round" is already closed for any league, surface that as a Blocker in this doc rather than silently no-op.
  - **Acceptance:** For each of Hip Jammers, Fam Jam, and Second Best, the current round's `import_log` shows a fresh `export.zip (cli-trigger)` entry, and the digest-prep export.zip checks (Submissions / Votes / Vote comments — prep-check indices 1,2,3) read green at https://mlb.mattmariani.com. List the three roundIds + their pre/post check states in the Activity Log.

- [x] {agent: backend, id: core-tests} Bring the core/vitest suite to a known-clean, documented baseline. Run `npm test` (and `npm run test:integration` if it doesn't require live credentials — if it does, gate it behind login-fix and note that). Fix anything that rotted in core/server/spotify since sprint-11; for failures that are environmental (need live ML/Spotify auth), document them as skipped-with-reason rather than leaving a red suite.
  - **Acceptance:** `npm test` exits 0 with the pass/skip count recorded in the Activity Log; any intentionally-skipped tests name the reason (e.g. "requires live ml-auth, run post-login-fix"). No unexplained failures remain.

- [x] {agent: frontend, id: recent-changes} Produce the recent-changes summary the user asked for: what shipped since the last digest cut. Cover sprint-10 + sprint-11 (visible UI changes + under-the-hood) per the version+changelog handoff ritual. Update `CHANGELOG.md` (create if absent) and bump the UI version string synced to `package.json`.
  - **Acceptance:** `CHANGELOG.md` has a dated entry covering sprint-10 + sprint-11 shipped work (CLI export.zip ingest, Import-from-CLI button, unified rating bars + realtime fix, research-tab manual sort + auto-after-all-4, YTM Songlink ingest, extension wordmark icons), with the current version number; the same version renders in the webapp UI and matches `package.json`. Link the summary in this doc's Activity Log.

- [x] {agent: frontend, id: check-clean} Get `npm run check` to a clean baseline. The recurring pre-existing error is the `vite.config.ts` `test` overload (flagged in every sprint-11 Activity Log entry) — fix it so the build/check is error-free, and report the warning count.
  - **Acceptance:** `npm run check` exits with **0 errors** (the vite.config.ts overload resolved); warning count recorded in the Activity Log. No new errors introduced.

- [x] {agent: frontend, id: digest-verify, depends: data-refresh} Verify the digest path is generatable end-to-end against the refreshed data, so the user's final-boss step is unblocked. For the current round in each of the three leagues, load `/digest/[roundId]` in the prepare stage, confirm the export.zip checks are green (post data-refresh), exercise the "Import from CLI" button + ml-auth badge, and confirm "Generate draft" produces a draft. Do **not** finalize — that's the user's call. Report any UI-side breakage found.
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

### B1 — Fam-Jam has no in-progress round to refresh (D3 unsatisfiable for this league)
`leagues list --all` for the logged-in account (Mashew) shows **every** Fam Jam
season as `status=complete` ("Fam Jam III: Playing for Keeps", "Fam Jam II",
"Fam Jam"), and none appear as a *current* league — so `leagues export` cannot
return an in-progress round for Fam-Jam, and the host daemon's name-match
(`leagues list`, current-only) wouldn't even find it. There is no fresh round
data to pull. **No digest target for Fam-Jam this sprint.** If the user wants a
Fam-Jam digest, it must target an already-completed round via a manual
export.zip upload (data is already in the DB up to round "Did I Make Myself
Clear?"), or via an account where a Fam Jam season is active. **Needs user
decision.**

### B2 — D3's premise is inverted by ML's actual export behavior (digest target redefined)
D3 assumed "`leagues export` only ships the open round." The live exports prove
the **opposite**: the zip contains the **completed** rounds and *excludes* the
currently in-progress round (ML withholds submissions/votes until a round
closes, for anonymity). So the in-progress rounds — Hip Jammers **rid=105**
"Pump Up The Sasha" and Second Best **rid=112** "Sultry Bluesy Voices" — have
**zero** exportable data and cannot be digested. The digestable "most recent
round" is therefore the **most-recent-completed** round per league:
**Hip Jammers → rid=104 "Department of Education"**, **Second Best → rid=110
"Guilty Pleasures"** — both now fully green (see Activity Log). Proceeding on
this interpretation for the frontend handoff; **flagged for user confirmation.**

### B3 — pre-existing duplicate submissions in a Blocked league (Fam-Jam rid=100)
The de-anon import bug (fixed this wave — see Activity Log) had already
duplicated Fam-Jam round 100 "Bangers by Trash" (11→22 submissions) in a prior
sprint. Because Fam-Jam can't be re-imported (B1), the self-healing re-import
can't clean it. Left as-is rather than running a raw `DELETE` against the live
shared DB without consent (auto-mode guardrail also blocked that). Low impact
(not a digest target). **Cleanup needs user go-ahead** (one-line dedup, or a
manual Fam-Jam export.zip re-upload once accessible).

## Activity Log

### 2026-06-01 — frontend — digest-verify: digest path verified for r-104 + r-110 (Wave 2)

Verified the digest path end-to-end against the refreshed data for the two
user-approved targets (per Blocker B2, these are the most-recent-*completed*
rounds, not the in-progress ones). All checks driven against prod
(`192.168.4.217:3002` ← mlb.mattmariani.com). **Verify-only — nothing finalized.**

**r-104 "Department of Education" (Hip Jammers)**
- `POST /api/digest/104/prepare` → export.zip checks **green**: Submissions 9 ✓ ·
  Votes 56 ✓ · Vote comments 14 ✓ (matches handoff 9/56/14). Round metadata ✓,
  Album art ✓. Chat-window mentions is `optional` + absent → does not gate.
- `GET /digest/104` loaded in the **prepare** stage (no prior draft); `allChecksOk`
  true → "Generate draft" CTA shown.
- `POST /api/digest/104/draft` → **HTTP 200** (~39s LLM), draft `draft-104-bf747c03`.
  Page reload renders the **refine** stage: `dg-export` frame, mast deck
  "5 sections · whole-regen count 0", section titles (The Podium / Villain /
  Consensus…) with real vote-aware prose. Draft content rendered. ✓

**r-110 "Guilty Pleasures" (Second Best)**
- `POST /api/digest/110/prepare` → export.zip checks **green**: Submissions 9 ✓ ·
  Votes 54 ✓ · Vote comments 15 ✓ (matches handoff 9/54/15). Metadata + Album art ✓.
- `GET /digest/110` → **prepare** stage, "Generate draft" shown.
- `POST /api/digest/110/draft` → **HTTP 200** (~37s), draft `draft-110-9f4fd24b`,
  5 sections (podium, villain, flow, consensus, quotes). Refine stage renders the
  framed digest with content. ✓

**ml-auth badge:** `GET /api/ml-auth` → `{status:"ok"}` (green "ml ok") — backend's
login-fix is reflected; badge would render healthy.

**Import-from-CLI button:** correctly **not shown** on either round — the button is
gated on `exportZipChecksFailing` (any of Submissions/Votes/Vote comments failing),
and all three are green post-refresh. That's the intended UX (no import needed when
data is already current); did not POST `/import-export-zip` to avoid a needless
re-trigger of the host CLI against green data.

**No UI-side breakage found.** The 5-vs-6-section count is expected: the chat
section self-suppresses when chat-window mentions are absent (existing optional-chat
behavior), consistent across both rounds.

**digest path verified — ready for user finalize** for r-104 + r-110.

Fam Jam III "Playing for Keeps" final round is **not** verified yet — awaiting its
roundId from backend once green (per handoff; not blocking this entry).

### 2026-06-01 — backend — data-refresh: refreshed the 3 leagues; D3 premise corrected; import dup bug fixed

**TL;DR for frontend digest-verify — use these roundIds (most-recent-COMPLETED, the only digestable ones):**

| League | Digest-target round | roundId | Submissions [1] | Votes [2] | Vote comments [3] |
|---|---|---|---|---|---|
| Hip Jammers | "Department of Education" | **104** | 9 ✅ | 56 ✅ | 14 ✅ |
| Second Best | "Guilty Pleasures" | **110** | 9 ✅ | 54 ✅ | 15 ✅ |
| Fam-Jam | — | — | — (Blocker B1) | — | — |

All three prep-checks `[1,2,3]` read **green** for rid=104 and rid=110 via the live
`POST /api/digest/<id>/import-export-zip` at https://mlb.mattmariani.com (verified
against the endpoint's `checks` payload, not just raw counts). Fresh
`export.zip (cli-trigger)` import_log entries (status=success) exist for
`hip-jammers s3` and `second-best s1` dated 2026-06-01T21:45Z.

**Key finding — the in-progress round is NOT what gets exported (D3 was backwards).**
ML's `leagues export` zip contains the **completed** rounds and omits the
in-progress one (submissions/votes hidden until a round closes). So the
"currently open" rounds the sprint pointed at have no data:

| League | ML current (in-progress) round | our roundId | exportable data? |
|---|---|---|---|
| Hip Jammers | `3e21ddb63f` "Pump Up The Sasha" | 105 | **none** (pre 0/0/0 → post 0/0/0) |
| Second Best | `4599e79ee4` "Sultry Bluesy Voices" | 112 | **none** (pre 0/0/0 → post 0/0/0) |

→ digest target redefined to most-recent-completed (rid=104 / rid=110). See **Blocker B2**.
**Fam-Jam**: every Fam Jam season is `complete` and not a current league for this
account → no in-progress round exists to refresh. See **Blocker B1**.

**Pre → post check states for the digest targets (this wave's deltas):**
- Hip Jammers rid=104 "Department of Education": pre **0/0/0 (RED/RED/RED)** → post **9/56/14 (GREEN×3)**. Round had never been imported with data; this export brought it.
- Second Best rid=110 "Guilty Pleasures": pre **0/0/0 (RED/RED/RED)** → post **9/54/15 (GREEN×3)**.
- (Side effect, also refreshed: HJ rid=103 votes 0→47; SB rid=109 de-anonymized, votes 0→65.)

**Import duplication bug found + fixed (committed separately).** First Hip Jammers
import doubled round 103 submissions (9→18, only 9 distinct tracks). Root cause:
rounds imported while in-progress store submissions with `competitor_id IS NULL`
(submitter hidden); the table's `UNIQUE(round_id,spotify_uri,competitor_id)`
treats NULL≠id, so the post-completion refresh inserted a duplicate instead of
de-anonymizing. Pre-existing damage existed on Fam-Jam rid=100 (11→22) too,
proving it predates this session. Fix: `upsertSubmission` now deletes the stale
anonymous placeholder before upserting the identified row (+ widened DO UPDATE);
re-imports are idempotent and **self-heal** prior duplication. Verified: re-import
collapsed rid=103 back to 9 (distinct 9) and de-anonymized SB rid=109 (anon→0).
rid=100 remains dup'd (Blocker B3 — Fam-Jam not re-importable). Added
`ui/src/lib/db/submissions.test.ts` (2 tests, pass). Deployed:
`docker compose build --no-cache bot-ui && up -d --force-recreate bot-ui`.

**Mechanics used:** `POST /api/digest/<roundId>/import-export-zip` (host daemon
`/export-zip` → `cli-web-musicleague leagues export <mlLeagueId> -o …` →
`parseZip` → `importZipData` → `logImport` → `runPrepChecks`). ML league ids:
Hip Jammers `b514fe6352994d6fadd602dee3cbaeb7`, Second Best
`948e0131250c4ce1b449ab6b453261f6`.

### 2026-06-01 — backend — login-fix: restore `cli-web-musicleague` auth (root cause + headless self-heal)

**Root cause (deeper than the captured symptom).** Two distinct problems were
conflated under "Missing X server / $DISPLAY":

1. **The real blocker — expired ML session, silently un-refreshable.** Music
   League keeps **no durable session cookie of its own**; the logged-in session
   is re-minted every time by replaying the Spotify OAuth handshake. The httpOnly
   cookie that actually carries the API session is named, literally,
   `app.musicleague.com`. The old `refresh_auth()` navigated straight to `/home/`,
   which *renders* logged-in via live Spotify SSO but never re-mints that cookie —
   so it extracted **only tracking cookies** (`_ga`, `cto_bundle`, panorama…),
   saved them as "authenticated", and every curl_cffi API call then 401→AUTH_EXPIRED.
   Evidence: replaying the browser's own `/home/` cookies via curl_cffi → bounced to
   `/login/`. The "Login with Spotify" button builds a Spotify authorize URL with
   `show_dialog=true`, so the consent screen always appears — the step the
   straight-to-/home/ refresh skipped.
2. **The X-server symptom — interactive headed-login fallback.** When the daemon's
   systemd user unit starts *before* the graphical session, its env has no
   `DISPLAY` (`DISPLAY=undefined` in the May 19 journal). The headed Chromium the
   interactive `auth login` opens then dies with "Missing X server". The current
   daemon happened to have `DISPLAY=:0`, but it's load-order-fragile.

**Approach chosen (D4 — my call): persisted-profile reuse for a non-interactive,
headless self-heal; DISPLAY-hardening for the interactive fallback.** The profile's
Spotify session (`sp_dc`) is still alive, so the *only* interactive step (the
Spotify consent click) can be scripted. Proven end-to-end headlessly (no X, no
human): `/login/` → click "Login with Spotify" → Spotify consent
`button[data-testid="auth-accept"]` → redirect `/home/` → capture the
`app.musicleague.com` session cookie (1248 B) → curl_cffi replay = **AUTH OK**.

**Changes:**
- `musicleague/.../core/auth.py` — rewrote `refresh_auth()` to drive the full
  `/login/`→Spotify-consent→`/home/` flow via a new shared
  `_drive_spotify_login(page, auto_consent=…)`; added `_has_session_cookie()` so a
  tracker-only cookie set is rejected (never saved as authenticated). Falls back to
  `None` (→ "run auth login") only when the Spotify session itself is dead
  (password prompt detected).
- `musicleague/.../commands/auth.py` — new `auth refresh` command: deterministic
  non-interactive re-mint, headless, **no display required**.
- `scripts/ml-auth-trigger.mjs` — `loginEnv()` falls back to `DISPLAY=:0`
  (override `ML_AUTH_TRIGGER_DISPLAY`) when both `DISPLAY`/`WAYLAND_DISPLAY` are
  unset, so the headed interactive login survives boot-before-session. `/health`
  now reports `effectiveDisplay`.
- `musicleague/.../tests/test_core.py` — added 3 `_has_session_cookie` regression
  tests (incl. the tracker-only-is-not-a-session case).
- Cleanup: killed a stale parked kitty login terminal (PID 894677) and cleared a
  stale Chromium `SingletonLock`/`SingletonCookie`/`SingletonSocket` in the profile.

**Exact re-login commands:**
- **Routine / non-interactive (use this first — no display needed):**
  `cli-web-musicleague auth refresh`
  (also runs automatically on any 401 via the client's auto-refresh, and via the probe.)
- **Full interactive (only if `auth refresh` reports the Spotify session expired):**
  via UI `POST /login` (host daemon spawns kitty with `DISPLAY` ensured), or directly
  on a real display: `cli-web-musicleague auth login`.

**Acceptance — verified:** `auth refresh` → 63 cookies saved, **no X-server error**;
`cli-web-musicleague --json users me` → `Mashew` (2 current / 6 completed leagues);
`node scripts/ml-auth-probe.mjs` → `status=ok`; `data/ml-auth.json` → `"status":"ok"`,
non-expired. Daemon restarted (`systemctl --user restart mlb-auth-trigger.service`),
`/health` → `effectiveDisplay=:0`. CLI mocked suite: **61 passed**. No bot-ui rebuild
needed (host-side CLI/daemon only; container reads `data/ml-auth.json` via volume).

### 2026-06-01 — backend — core-tests: vitest suite to a clean, deterministic baseline

**Two real problems, both fixed (root cause, not masked):**
1. **Collection crash.** `npx vitest run` died before any test with
   `EACCES scandir .wwebjs_auth/session/ActorSafetyLists` — vitest, with no root
   config, scanned the whole project root and hit the **root-owned WhatsApp
   container Chromium profile** (and would also pull the separate SvelteKit app
   under `ui/`). Fixed by adding a root **`vitest.config.ts`** that scopes
   `include: ['tests/**/*.test.ts']` and excludes `.wwebjs_auth/**`, `ui/**`,
   `musicleague/**`, `data/**`, node_modules, dist. (This is the *core* suite
   config only — distinct from the frontend-owned `ui/vite.config.ts`, untouched.)
2. **`npm test` never exited.** `scripts.test` was bare `vitest`, which drops into
   **watch mode** ("Waiting for file changes…", exit 124) — so it can never
   "exit 0" per acceptance. Changed `test` → `vitest run`; added `test:watch`
   (`vitest`) to preserve the watch workflow. `test:integration` unchanged.

**Result — `npm test` exits 0:** **11 files / 124 tests passed, 0 skipped.** No
tests needed gating: `spotify.integration.test.ts` (7 tests, real Spotify API)
is **green** — Spotify client-credentials are valid in this env, independent of
the ML login. (If that env ever lacks Spotify creds, those 7 would need
`describe.skipIf` gating; today they pass, so nothing is artificially skipped.)
`npm run build` (tsc) still exits 0. No unexplained failures remain.

Also (login-fix side-suite, separate from `npm test`): the Python CLI pytest
`musicleague/tests/test_core.py` runs **61 passed** including the 3 new
`_has_session_cookie` regression tests.

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
