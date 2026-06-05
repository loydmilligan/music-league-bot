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

## Deploy

- **Chromium lives in a built-once base image — build it first, then it's cached.** All app images (`bot-ui` via `Dockerfile.ui`, `bot`+`api` via root `Dockerfile`) `FROM music-league-bot-base:chromium`, which carries chromium + fonts (needed for the digest PNG export). Build the base with:
  ```
  docker build -f Dockerfile.base -t music-league-bot-base:chromium .
  ```
  **Rebuild the base ONLY when chromium or the base node version changes** (i.e. when you edit `Dockerfile.base`). Routine code deploys do **not** rebuild it — the cached base is what makes `--no-cache` app rebuilds fast.
- **Always deploy to prod for testing.** Local iteration is not the workflow on this project. After a code change lands, run `docker compose build --no-cache <service> && docker compose up -d --force-recreate <service>` (e.g. `<service>` = `bot-ui`) and smoke against `mlb.mattmariani.com` (→ `192.168.4.217:3002`). Do not iterate locally and skip the prod redeploy. `--no-cache` is **kept** (clean app rebuilds) and is now fast because chromium comes from the cached base instead of being re-downloaded each build: **`bot-ui` went from ~15–25 min → ~59 s** (sprint-19, measured 2026-06-05; `bot`+`api` ~37 s).
- **Use `--force-recreate` on the `up -d` step.** Without it, `docker compose up -d bot-ui` may keep the existing container running against the old image even when `build` produced a new one. Confirmed 2026-05-20 (sprint-10 Wave 1 frontend smoke).

