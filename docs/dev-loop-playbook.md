# Dev-loop playbook — fast iteration for music-league-bot

**Status:** ratified 2026-06-06 (sprint-22); updated 2026-06-25 (orc-tower retired; added the
shared-image / merge-to-master-before-deploy rule). Supersedes the "always deploy to prod for
every change" rule. Canonical operational summary lives in `CLAUDE.md` → Deploy; this doc
is the full rationale + recipes.

> **Coordination note (2026-06-25):** orc-tower and the sprint coord-doc are retired. Where
> this doc says "orc-gated" or "log in the coord-doc," read it as: lanes self-coordinate, and
> the deploy builds from `master`. See "Prod runs one shared image" below — that rule is what
> keeps concurrent lanes from clobbering each other now that there's no central gate.

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
| **Parallel-safe?** | yes — per-lane port, no shared resource | serialized — one at a time; merge to `master`, then build from the main checkout |

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

## Prod runs one shared image — deploy from `master`

The prod `bot-ui` container runs a **single** image tag, `music-league-bot-bot-ui`, which is
nothing more than *whatever the last `docker compose build` produced* from its build context.
That has a sharp consequence:

- A deploy run from the **main checkout** builds from `master`. Work that exists **only** on a
  feature branch / worktree is not in `master`, so it is **not** in that image — and the
  deploy silently **overwrites** any earlier deploy that *did* carry it.
- So a deploy built from a worktree-only branch is **transient**: the next `master`-based
  deploy (by any lane) erases it.

**2026-06-25 incident.** A lane built+deployed its worktree-branch image (the metadata-queue
redesign). A second lane later merged unrelated avatars work to `master` and deployed from the
main checkout — clobbering the redesign with a redesign-free image (the new API routes 404'd,
the UI reverted). The two branches turned out to touch disjoint files, so the fix was: merge
both into `master` (clean, no conflicts), one rebuild from the main checkout, verify **both**
feature sets in the bundle. Both shipped and now persist because they're on `master`.

**The rule:** **merge your branch into `master` BEFORE you deploy**, then build + `up` from the
main checkout. That gives you (a) `master` as the single source of truth for what's live,
(b) correct prod `./data` bind-mount, and (c) the next lane *integrates* with your change
instead of erasing it.

## Outer-loop procedure (the deploy)

1. Lane **commits** its inner-loop-verified work, then **merges to `master`** (resolve any
   conflicts on the branch first; verify `npm run check` + tests on the merged result).
2. From the **main checkout** (`/home/loydmilligan/Projects/music-league-bot`, on `master`),
   run **ONE** deploy — serialized, never two `bot-ui` build+ups at once:
   ```
   docker compose build bot-ui && docker compose up -d --force-recreate bot-ui
   ```
3. **Assert the change is actually live** (mandatory — the safety that dropping `--no-cache`
   gives up). **Check the CLIENT bundle, not just a route:** grep a served
   `/_app/immutable/*.js` chunk (or in-container `/app/ui/build`) for a known new **UI**
   string. A server route returning 200 does *not* prove the client bundle rebuilt — they
   cache independently (2026-06-25: a stale `COPY ui/`+`npm run build` layer served old client
   JS while the new API routes answered 200; only a bundle grep caught it). If the marker is
   missing → the layer cache served stale; rebuild once with `--no-cache` as the *exception*.
4. Smoke `mlbot2.mattmariani.com` (→ `192.168.4.217:3002`).

With orc-tower retired there is no central gate: coordinate the single deploy lane directly
with other active lanes, or simply be the only one deploying. Merging to `master` first is
what makes a missed hand-off non-fatal — concurrent deploys then integrate rather than clobber.

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
   then cut over to prod when the deploy lane is clear — never concurrently with another
   lane's `bot-ui` build+up.

## Net effect

- Per-change iteration: ~5 min build → **<1s HMR**.
- Per-wave deploy: **one** ~30s cached build instead of N contended ~5-min builds.
- Parallel lanes actually parallel (own dev ports); the only serialized step is one
  orc-gated wave-gate deploy.
