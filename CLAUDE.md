# CLAUDE.md

<!-- orc-tower:adoption-stub -->

This project is **adopted by Orc Tower** (slug: `music-league-bot`).

- **Coordination doc:** `docs/coordination/sprint-1.md` (canonical decision record per
  Session O — read this before starting work).
- **Orc channel:** drop messages for orc at
  `.orc-tower/orc/inbox/<id>.json`; orc replies arrive in
  `.orc-tower/tower/inbox/`. Recipient-owned inboxes per Session M9=D.
- **Coordination protocol:** confirmation gates are sacred — orc will surface
  decision cards in the dashboard rather than autonomously committing
  changes.

This stub leaves the rest of `CLAUDE.md` for project-specific guidance. Add
your project-domain rules below this block.

<!-- orc-tower:adoption-stub-end -->

## Git workflow

- **Commit freely; do not push without confirmation.** After each task lands and smoke passes, commit locally. Do **not** `git push` to origin without explicit user confirmation.
- **Push threshold: 10.** Before any push, check `git status` vs origin. When local is **10 or more commits ahead** of `origin/master`, surface that fact in your next status report and ask whether to push. If fewer than 10 ahead, don't mention pushing — just keep committing locally.
- **Rationale:** prod deploys come from local `docker compose build`, not from `git pull`. Push is purely a backup / cross-machine sync concern, so we accumulate locally during sprints and push in batches.

## Deploy — two-loop workflow (sprint-22, ratified 2026-06-06)

> **This replaces the old "always deploy to prod for every change" rule.** That rule
> turned every one-line fix into a full Docker build, and with parallel lanes each
> doing `--no-cache build && force-recreate` it serialized into ~30-min waves. The fix
> is to split a fast **inner loop** (per change) from a single slow-ish **outer loop**
> (per wave). Full rationale + playbook: `docs/dev-loop-playbook.md`.

**Inner loop — iterate here for every change (seconds, no Docker):**
- UI is self-contained SvelteKit (`adapter-node`, with its own `/api/*` server routes +
  sqlite). Run the dev server with HMR — edits reflect in <1s, no rebuild, no container:
  ```
  cd ui && npm run dev -- --host --port 51XX   # pick a unique port PER LANE (5180, 5181, …)
  ```
  Host `ui/node_modules` is already installed, so this starts immediately. Watch it at
  `192.168.4.217:51XX`. DB: the dev server reads `./data` (same sqlite the prod volume
  mounts) — fine for read/visual iteration; **copy the DB first if a task writes** so you
  never mutate prod data while iterating.
- Backend/API edits hot-reload the same way: run the node service under `tsx watch`
  instead of rebuilding the image.
- Always run `npm run check` (svelte-check) as part of the inner loop — it catches the
  type errors a prod build would, in seconds.
- **Per-lane dev servers = zero shared-container contention**, so parallel lanes finally
  run in parallel. The only serialized step left is the single wave-gate deploy below.

**Outer loop — ONE prod deploy per wave gate (not per change):**
- After **all lanes in a wave have committed**, do a **single** authoritative prod build+swap
  (orc gates this — see serialize rule). Cached build, no `--no-cache`:
  ```
  docker compose build bot-ui && docker compose up -d --force-recreate bot-ui
  ```
  Then smoke `mlb.mattmariani.com` (→ `192.168.4.217:3002`).
- **`--no-cache` is dropped.** It was a band-aid for the concurrent-deploy stale-image
  race (review item 6) — the single serialized wave-gate deploy removes that race, so the
  layer cache is safe to use. The Dockerfile's layer order (`package.json` → `npm ci` →
  source) means a cached build reuses `npm ci` unless `package-lock.json` changed, so a
  routine deploy is a fast `vite build` + container swap (~30s) instead of ~59s clean.
- **Mandatory post-deploy assertion (replaces the safety `--no-cache` gave us).** After
  `up`, assert the change is actually in the running container before claiming success —
  e.g. `curl` the new route / grep the served bundle for a known new string. A stale layer
  can then never silently ship. (review item 6d)
- **Keep `--force-recreate`** — without it, `up -d` may keep the old container on the old
  image even after a new build (confirmed sprint-10).

**Serialize the WHOLE build→up, gated at dispatch (not "is a build running?"):**
- Only **one** `bot-ui` build+up runs at a time, full stop. The race that bit sprint-14
  and sprint-22 was two lanes both seeing a clear lane and starting together. **Orc owns
  the wave-gate deploy** — lanes commit; orc runs the one deploy after the wave lands. If a
  lane must deploy mid-wave, it acquires the deploy by announcing in the coord-doc first.

**Base image (unchanged):** all app images `FROM music-league-bot-base:chromium`
(chromium + fonts for the digest PNG export). Build once; **rebuild ONLY when
`Dockerfile.base` changes** (chromium / base node version):
```
docker build -f Dockerfile.base -t music-league-bot-base:chromium .
```
This is what already removed the ~150 MB chromium download from every app build (sprint-19).

<!-- agent-bus:start -->
## Agent coordination (agent-bus)

This repo participates in **agent-bus**, a file-based channel for coordinating
with peer agents in other repos.

- Hub: `/home/loydmilligan/Projects/agent-bus`
- This repo's registered handle: `music-league-bot` (see `/home/loydmilligan/Projects/agent-bus/registry.md`).
- Before coordinating with another agent, read `/home/loydmilligan/Projects/agent-bus/PROTOCOL.md`.
- To start a session with a peer: `/agent-connect <peer-tmux-pane> [goal-slug]`.
- If you get a doorbell ping pointing at a message file, read that file and
  follow `PROTOCOL.md`.
<!-- agent-bus:end -->

