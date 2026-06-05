---
project: music-league-bot
sprint: sprint-19-deploy-and-mobile
created: 2026-06-05T04:35:00Z
updated: 2026-06-05T04:35:00Z
status: active
---

# music-league-bot — coordination doc (sprint-19-deploy-and-mobile)

> **Two parallel, independent workstreams (different lanes):**
>
> **1. Cache chromium in a stable Docker base layer (backend/infra).** Today
> `docker compose build --no-cache bot-ui` re-downloads ~150 MB of chromium on
> *every* deploy because `--no-cache` busts the `apt-get install chromium` layer.
> chromium is required for the digest PNG export (`ui/src/lib/digest/export.ts`
> → `puppeteer-core` → `/usr/bin/chromium`). Fix = move chromium into a separate
> stable base image that the app Dockerfiles `FROM`, so `--no-cache` app rebuilds
> stay fast. **User constraint: KEEP `--no-cache` available** for clean app
> rebuilds — restructure the layers, don't drop the flag. chromium appears in two
> Dockerfiles: `Dockerfile.ui` runtime stage (service `bot-ui`) and root
> `Dockerfile` (services `bot` + `api`).
>
> **2. Mobile/Android-PWA digest-generation menu (frontend).** The sidebar nav
> (`ui/src/routes/+layout.svelte:64`, `<aside class="hidden md:flex …">`) is
> hidden below the `md` breakpoint with **no mobile replacement**, so phone /
> installed-PWA users lose all nav — including the "Digest preview" item (:22) —
> and can't reach digest generation. Fix = a mobile nav affordance so the digest
> flow is reachable on mobile + PWA.
>
> Roster: **backend** (the Docker base-layer restructure + deploy docs) +
> **frontend** (the mobile nav). **viz is idle this sprint.** Source items:
> `docs/coordination/backlog.md` (committed `9c8d5f7`).
> **NOT in this sprint:** web-share, Concept E, scatterplot, YTM (B2-blocked),
> WhatsApp digest-history capture.

## Sprint Goals

Faster deploys, and digests you can start on mobile
Chromium cached in a base image; mobile/PWA regains the digest menu.

## Active Sprint Plan

- [x] {agent: backend, id: chromium-base-image} Create a stable base Docker image that carries chromium so the app images stop re-installing it on `--no-cache` rebuilds. Add `Dockerfile.base` (`FROM node:22-bookworm-slim`, `apt-get install -y --no-install-recommends chromium fonts-liberation`, `rm -rf /var/lib/apt/lists/*`, and the puppeteer env `PUPPETEER_SKIP_DOWNLOAD=true` / `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium`). Build + tag it `music-league-bot-base:chromium`. This is the shared foundation the two refactor tasks build on; it does not change any running service by itself.
  - **Acceptance:** `docker build -f Dockerfile.base -t music-league-bot-base:chromium .` succeeds; `docker run --rm music-league-bot-base:chromium chromium --version` prints a chromium version; base is `node:22-bookworm-slim`-derived so it can back both app images. Tag/name recorded in the Activity Log for the refactor tasks.

- [x] {agent: backend, id: bot-ui-on-base, depends: chromium-base-image} Refactor `Dockerfile.ui`'s **runtime** stage to `FROM music-league-bot-base:chromium` and **delete** its `apt-get install … chromium fonts-liberation` step (the base now provides them; keep the builder stage as-is). This is the primary deploy-latency win — `bot-ui` is the service deployed on every change. Verify a real `--no-cache bot-ui` build no longer fetches chromium and the digest **PNG export** still works on prod.
  - **Acceptance:** `Dockerfile.ui` runtime stage `FROM`s the base with no chromium apt line; `docker compose build --no-cache bot-ui` completes with **no chromium download in the build log** and in materially less wall-clock than pre-sprint (target ~couple min); after `docker compose up -d --force-recreate bot-ui`, a digest **PNG export renders on prod** (`192.168.4.217:3002`) with chromium at `/usr/bin/chromium`. `npm run check` passes. Deployed; before/after build time noted in the Activity Log.

- [x] {agent: backend, id: bot-on-base, depends: chromium-base-image} Refactor the **root `Dockerfile`** to `FROM music-league-bot-base:chromium` and delete its `apt-get install … chromium` step (set/keep `CHROMIUM_PATH=/usr/bin/chromium`). This image backs the `bot` and `api` services, so they get the same no-re-download benefit. Can run in parallel with `bot-ui-on-base`. Verify both services still build and start with chromium available.
  - **Acceptance:** root `Dockerfile` `FROM`s the base with no chromium apt line; `docker compose build --no-cache bot api` succeeds with no chromium download in the log; `docker compose up -d --force-recreate bot api` → both containers `Up`; chromium reachable inside (e.g. `docker compose exec bot chromium --version` or the `CHROMIUM_PATH` binary exists). `npm run check` passes. Deployed; noted in the Activity Log.

- [x] {agent: backend, id: deploy-flow-docs, depends: bot-ui-on-base,bot-on-base} Update the deploy documentation now that the flow has a base-image step. Edit the `CLAUDE.md` "Always deploy to prod" bullet (currently ~L29-30) to: (a) build the base **once** via `docker build -f Dockerfile.base -t music-league-bot-base:chromium .`, rebuilding it **only** when chromium/the base changes; (b) routine deploys stay `docker compose build --no-cache bot-ui && docker compose up -d --force-recreate bot-ui` — now fast because the base is cached. State the base-rebuild trigger explicitly. (No `AGENTS.md` exists in this repo, so no mirror needed.) Optionally add a make target / compose convenience for the base build.
  - **Acceptance:** `CLAUDE.md` deploy section documents the base-build step + when to rerun it, and that `--no-cache bot-ui` is preserved and now fast; a fresh `docker compose build --no-cache bot-ui` is measured ≪ the pre-sprint ~15-25 min (record the new time). Activity Log entry with the before/after numbers.

- [ ] {agent: frontend, id: mobile-digest-menu} Make the digest-generation flow reachable on mobile + the installed Android PWA. Root cause: `ui/src/routes/+layout.svelte:64` renders the only nav as `<aside class="hidden md:flex …">` — hidden below the `md` breakpoint with no mobile alternative, so the `navItems` (incl. "Digest preview", :22) vanish on phones/PWA. Add a mobile nav affordance (hamburger + drawer, or a bottom bar — match the existing Mash Co. styling) that exposes the nav items below `md`; confirm the path to digest generation works end-to-end: nav → `/digest` (round picker) → a round's digest page → the Generate button (`openGenerate`, `+page.svelte:792`/`:803`) → `GenerateModal` opens. Verify at a real mobile viewport AND in the installed Android PWA on prod.
  - **Acceptance:** at <768px and in the installed Android PWA (`192.168.4.217:3002` / mlb.mattmariani.com), a nav affordance is visible and tapping through reaches "Digest preview" → a digest page → opens `GenerateModal` via the Generate button; the desktop (`md`+) sidebar is unchanged. Verified with a mobile-viewport screenshot + a PWA check, both logged. `npm run check` passes; deployed.

### Deploy

Until `deploy-flow-docs` lands, deploy per current `CLAUDE.md`: `docker compose build --no-cache <service> && docker compose up -d --force-recreate <service>`, smoke against `192.168.4.217:3002`. **Serialize deploys** (review-queue item 6). The chromium tasks change *what* the build does, not *how* you trigger it — once `chromium-base-image` lands, build the base first, then the app services build fast.

---

## Agent Roster

| Agent | Owns | Does not touch |
|---|---|---|
| backend | Docker / infra: `Dockerfile.base` (new), root `Dockerfile`, `Dockerfile.ui`, `docker-compose.yml`, the `CLAUDE.md` deploy section | the SvelteKit nav/layout, digest UI components, the digest data/scoring |
| frontend | the app nav/shell (`ui/src/routes/+layout.svelte`), the mobile/PWA navigation affordance, the digest-page entry to `GenerateModal` | the Dockerfiles / deploy flow, the digest payload/scoring |
| viz | _idle this sprint — no tasks_ | — |

---

## Decision Log

- **D1** — chromium moves to a shared base image (`music-league-bot-base:chromium`) that both `Dockerfile.ui` (→ `bot-ui`) and root `Dockerfile` (→ `bot`+`api`) `FROM`. `--no-cache` is **kept** for app rebuilds (user constraint); only the base is built-once-and-cached. Rationale: every deploy currently re-downloads ~150 MB chromium; the base layer removes that tax without giving up clean app rebuilds.
- **D2** — Mobile nav is an *additive* affordance below `md`; the desktop sidebar (`hidden md:flex`) is left unchanged. The bug is purely "no nav exists on mobile," not "the desktop nav is wrong."

## Blockers

## Activity Log

### 2026-06-05 — backend — deploy-flow-docs DONE → **backend lane CLOSED for sprint-19**
- Rewrote the `CLAUDE.md` "## Deploy" section (docs-only, no deploy): (a) new bullet — chromium base is built **once** via `docker build -f Dockerfile.base -t music-league-bot-base:chromium .`, rebuilt **only** when chromium / the base node version changes (i.e. when `Dockerfile.base` is edited); routine code deploys never rebuild it. (b) Routine deploy stays `docker compose build --no-cache <service> && docker compose up -d --force-recreate <service>` — `--no-cache` kept, now fast because chromium comes from the cached base. Cited measured before/after: **bot-ui ~15–25 min → ~59 s** (bot+api ~37 s). `--force-recreate` bullet preserved.
- No `AGENTS.md` in repo → no mirror needed.
- All 4 backend tasks done: chromium-base-image → (bot-ui-on-base ∥ bot-on-base) → deploy-flow-docs. Only `mobile-digest-menu` (frontend) remains open this sprint.

### 2026-06-05 — backend — bot-ui-on-base + bot-on-base DONE (both deployed + prod-verified)
- **Ordering note:** a `--no-cache bot-ui` build was already running against the UN-refactored Dockerfile.ui (re-downloading chromium for nothing) — killed it first, then refactored, then rebuilt. Refactor-first, build-second.
- **bot-ui-on-base:** `Dockerfile.ui` runtime stage now `FROM music-league-bot-base:chromium`; deleted its `apt-get install chromium fonts-liberation` line (builder stage unchanged).
  - `docker compose build --no-cache bot-ui` → **0:58.77 (≈59 s)**, **no chromium download in the log** (runtime stage resolved straight from the base). **Before/after: ~15–25 min → ~59 s.**
  - `up -d --force-recreate bot-ui` → container Up; `chromium --version` in-container = `Chromium 148.0.7778.215`, `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium`.
  - **PNG export prod-verified:** `POST /api/digest/{112,104}/export {"format":"png-sections"}` → 6 valid section PNGs each; fetched `r-104-…-podium.png` = real `PNG image data, 1284 x 984` (358 KB). `npm run check` → 0 errors (31 pre-existing warnings, none from this change).
- **bot-on-base:** root `Dockerfile` now `FROM music-league-bot-base:chromium`; deleted its chromium apt step; kept `CHROMIUM_PATH=/usr/bin/chromium`.
  - `docker compose build --no-cache bot api` → **0:37.30 (≈37 s)**, no chromium download.
  - `up -d --force-recreate bot api` → both Up & healthy (bot: `[whatsapp] Client ready`; api: `[bracket-api] Listening on :3001`); `chromium --version` + `CHROMIUM_PATH` confirmed inside both.
- Deploys serialized (bot-ui first, then bot+api). Next: `deploy-flow-docs` (update CLAUDE.md with the base-build step + when to rerun it).

### 2026-06-05 — backend — chromium-base-image DONE
- Added `Dockerfile.base`: `FROM node:22-bookworm-slim` → `apt-get install -y --no-install-recommends chromium fonts-liberation` → `rm -rf /var/lib/apt/lists/*`; env `PUPPETEER_SKIP_DOWNLOAD=true` + `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium`.
- **Image name/tag for follow-on tasks: `music-league-bot-base:chromium`** (build: `docker build -f Dockerfile.base -t music-league-bot-base:chromium .`).
- Acceptance ✓: build succeeded; `docker run --rm music-league-bot-base:chromium chromium --version` → `Chromium 148.0.7778.215 built on Debian GNU/Linux 12 (bookworm)`. Base is `node:22-bookworm-slim`-derived, so it backs both `Dockerfile.ui` runtime (bot-ui) and root `Dockerfile` (bot+api).
- No running service changed by this task alone. Next: bot-ui-on-base ∥ bot-on-base point their `FROM` at this base + drop their chromium apt lines.

### 2026-06-05 — docs — Sprint plan created: deploy-and-mobile (sprint-19)
- 5 tasks: chromium-base-image → (bot-ui-on-base ∥ bot-on-base) → deploy-flow-docs [backend, 4]; mobile-digest-menu [frontend, 1]; viz idle
- two independent workstreams from `docs/coordination/backlog.md` (committed `9c8d5f7`): chromium stable base layer (backend/infra) + mobile/PWA digest-generation menu (frontend)
- deps: bot-ui-on-base & bot-on-base ← chromium-base-image (need the base to `FROM`); deploy-flow-docs ← both refactors (docs must reflect a working flow). Kickoff = chromium-base-image (backend) ∥ mobile-digest-menu (frontend) in parallel
- methodology: testing none / review none — no TDD or review scaffolding; acceptance gates on `npm run check` + prod verification
- root causes pre-located: chromium re-download = `--no-cache` busting the apt layer in `Dockerfile.ui`/`Dockerfile`; mobile nav gap = `+layout.svelte:64` `hidden md:flex` sidebar with no mobile replacement
- sprint-18 (tastemaker v2) closed + pushed (`44da260`) so the warren advances here
