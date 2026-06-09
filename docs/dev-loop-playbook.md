# Dev-loop playbook — fast iteration for music-league-bot

**Status:** ratified 2026-06-06 (sprint-22). Supersedes the "always deploy to prod for
every change" rule. Canonical operational summary lives in `CLAUDE.md` → Deploy; this doc
is the full rationale + recipes.

## Why this exists

The old rule ("never iterate locally; `docker compose build --no-cache && up --force-recreate`
after every change, smoke prod") was fine when changes were rare. With parallel lanes it
became the bottleneck:

- Every change — even a one-line CSS fix — paid a full Docker build.
- N lanes each deploying to the **same** `bot-ui` container forced serialization → N × build.
- Worse, lanes that started builds concurrently **raced** on `up --force-recreate`
  ("removal already in progress" / stale-container errors), turning a measured ~59s solo
  build into 5+ min under contention (sprint-14, sprint-22). `--no-cache` had been added as
  a band-aid for the resulting stale images — treating a *race* symptom with a *cache* hammer.

The chromium download (the original big cost, ~150 MB/build) was **already** fixed in
sprint-19 by baking it into `music-league-bot-base:chromium`. So the remaining pain was
structural: too many full prod builds per wave, plus the race.

## The model: inner loop vs. outer loop

| | Inner loop | Outer loop |
|---|---|---|
| **When** | every change | once per wave gate |
| **Speed** | <1s (HMR) | ~30s (cached build + swap) |
| **Tooling** | `vite dev` / `tsx watch` + `npm run check` | `docker compose build && up --force-recreate` |
| **Touches Docker?** | no | yes |
| **Parallel-safe?** | yes — per-lane port, no shared resource | serialized — one at a time, orc-gated |

You catch ~95% of issues instantly in the inner loop; the single wave-gate prod build +
smoke catches the build-only/SSR/adapter last 5%. Strictly better than before, where prod
was *also* the only smoke — just done once per wave instead of once per change.

## Inner-loop recipes

**UI lane (SvelteKit — frontend / most work):**
```
cd ui && npm run dev -- --host --port 51XX     # unique port per lane: 5180, 5181, 5182…
```
- HMR: save a `.svelte`/`.ts` file → browser updates in <1s. No rebuild, no container.
- Self-contained: SvelteKit serves the UI **and** the `/api/*` routes **and** talks to the
  sqlite DB (`adapter-node`), so the dev server is the whole app — no separate API needed.
- Watch live at `192.168.4.217:51XX`.
- **DB safety:** dev reads `./data` (the same sqlite the prod volume mounts on the host). Fine
  for read/visual work. **If your task writes to the DB, copy it first** and point `DATA_DIR`
  at the copy, so iterating never corrupts prod data:
  ```
  cp -r data /tmp/data-<lane> && DATA_DIR=/tmp/data-<lane> npm run dev -- --host --port 51XX
  ```

**Backend/API lane (node services — `bot`, `api`):**
- Hot-reload instead of rebuilding the image:
  ```
  npx tsx watch src/api/server.ts        # or the relevant entrypoint
  ```

**Every lane, every change:** run `npm run check` (svelte-check) — it surfaces the type
errors a prod build would, in seconds.

## Outer-loop procedure (the wave gate) — orc-owned

1. All lanes in the wave **commit** their work (inner-loop-verified).
2. **Orc runs ONE deploy** (serialized — never two at once):
   ```
   docker compose build bot-ui && docker compose up -d --force-recreate bot-ui
   ```
3. **Assert the change is actually live** (mandatory — this is the safety that dropping
   `--no-cache` gives up): curl the new route / grep the served bundle for a known new
   string. If it's missing → the layer cache served stale; rebuild once with `--no-cache`
   as the *exception*, not the default.
4. Smoke `mlb.mattmariani.com` and log the deploy in the coord-doc Activity Log.

If a lane genuinely must deploy mid-wave, it **acquires the deploy lane by announcing in the
coord-doc first** — "is a build running?" is not enough (two lanes can both see it clear and
start together; that's the exact sprint-22 race).

## Prod-build speedups (incremental — chromium already handled in sprint-19)

These shave the wave-gate build further. Tracked as a follow-up task (owner: viz):

1. **Drop `--no-cache`** (done — see CLAUDE.md). Cached `npm ci` layer unless `package-lock`
   changes → routine deploy is `vite build` + swap.
2. **BuildKit cache mounts** so even a *cold* `npm ci` reuses the package cache:
   ```dockerfile
   # syntax=docker/dockerfile:1
   RUN --mount=type=cache,target=/root/.npm npm ci
   RUN --mount=type=cache,target=/app/ui/node_modules/.vite npm run build
   ```
   (Enable BuildKit: `DOCKER_BUILDKIT=1`, or compose's default builder.)
3. **Move `python3 make g++` into `Dockerfile.base`** so the ui builder stops apt-installing
   build tools on every build (they only exist for native modules like better-sqlite3).
4. Validate any Dockerfile change by building to a **throwaway tag** (no `up`) and measuring,
   then coordinate the prod cutover with orc when the deploy lane is clear — never during a
   live wave deploy.

## Net effect

- Per-change iteration: ~5 min build → **<1s HMR**.
- Per-wave deploy: **one** ~30s cached build instead of N contended ~5-min builds.
- Parallel lanes actually parallel (own dev ports); the only serialized step is one
  orc-gated wave-gate deploy.
