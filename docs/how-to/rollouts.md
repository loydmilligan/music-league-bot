---
title: Rollouts — How to Enable, Watch, Resume, and Roll Back
aliases:
  - rollouts-howto
  - rollout-runbook
type: doc
doc_type: how-to
project: music-league-bot
status: draft
created: 2026-08-26
related:
  - "[[2026-08-26-rollout-entity-design]]"
tags:
  - music-league-bot
  - how-to
  - rollout
  - digest
parent:
  - - music-league-bot
---

# Rollouts — How to Enable, Watch, Resume, and Roll Back

## What a rollout is

A rollout is a per-league, config-driven automation of the weekly digest
process, replacing the hand-run `hil_autorun.py` / `mlb-hil-ledes.timer` loop
one league at a time. Its vocabulary: a **Rollout** declares an ordered list
of **cuts** (script, agent, or human steps); **skips** split the order into
**EPs** ("execution phases" — parallel batches, one per skip boundary); a
**cover** re-runs a track in a later EP with accumulated context, and a
**remaster** cover is a repair attempt that fires only when the original's
**check** failed. Two executors drive it: the app executor (bot-ui, HTTP-reachable
cuts) and the host executor (`scripts/rollout/host_executor.py`, script/agent
cuts needing python3 or the `claude` CLI, which the containers don't have).
Full design and open questions: `docs/superpowers/specs/2026-08-26-rollout-entity-design.md`.

## Enabling a rollout for a league

1. Settings → **Rollouts** tab.
2. Pick the league.
3. Check **"Rollout enabled"**.
4. Save.

Once enabled, the next `pending` `digest_jobs` row for that league is
promoted into a rollout run instead of being picked up by `runOneJob`
(`digest_jobs.status` flips to `rollout`). Every other league is completely
unaffected — this is the degenerate-safety guarantee proven by Task 10's
tests: with no rollout enabled anywhere, the old path runs byte-for-byte
as before.

## Watching a run

- Settings → Rollouts → **Runs** sub-tab shows every run's current EP, each
  cut's state (`pending` / `running` / `done` / `failed` / `skipped`),
  attempts, and remasters.
- Host-side cuts (script/agent) log to the systemd journal:
  ```
  journalctl --user -u mlb-rollout-host -n 50
  ```
- App-side cuts log through the normal bot-ui process output/logs.

## Resuming a parked run

A run **parks** at a `human` cut and fires a notification (ntfy and/or
WhatsApp, per the existing settings-grid routing) carrying a review link and
a one-time resume token — this is the digest approval gate generalized from
one hold to N holds (see Task 9).

To resume:
- Tap the link in the ntfy notification, **or**
- Paste the token into the Runs view's resume field.

Either path calls `liftHold`, which marks the human cut `done`, resumes the
run to `running`, and **spends** the token — a stale or reused token comes
back `{ ok: false, reason: 'unknown or spent token' }`.

## Rolling back

Uncheck **"Rollout enabled"** and Save. This does **not** touch an in-flight
run — it finishes on its own. It only stops new rounds from being promoted;
the next `pending` job for that league falls back to `digest_jobs` /
`runOneJob` exactly as before enabling.

## Three numbers that mean three different things

- **`check_passed`** — did the cut's declared `check` (e.g. `exit-zero`,
  `no-fail-checks`) pass? `undefined` means no check was declared, or it
  hasn't run yet.
- **`attempts`** — how many times this cut has been claimed and run. Bumped
  by both a normal retry and by `reapStaleCuts` reclaiming an abandoned
  lease (a killed host executor left a `running` row with a stale
  heartbeat).
- **`remasters`** — how many times a *cover* has fired as a repair for this
  cut specifically because its check failed. Capped by the cover's `budget`.

## Known open items (do not silently ship past these)

- **`cover-art` cut's command is unverified.** `DEFAULT_ROLLOUT` assumes
  `scripts/cover-gen/cli.py <roundId>`, which has not been confirmed against
  the actual script signature. Read `scripts/cover-gen/cli.py` before
  relying on this cut, or disable it in a league's config until verified.
- **`dupe-page` can go stale.** The `dupe-findings` agent cut writes JSON,
  but `dupe_review_page.py` still reads a hardcoded `FINDINGS` list rather
  than that file. Until a follow-up teaches the script to read findings from
  disk, the dupe review page will not reflect the current run's findings.

## Host executor service (not yet installed)

Unit files exist at:
- `~/.config/systemd/user/mlb-rollout-host.service`
- `~/.config/systemd/user/mlb-rollout-host.timer`

They mirror `mlb-hil-ledes.service`/`.timer` — a 5-minute polling timer
running `scripts/rollout/host_executor.py --once`. **They are not installed,
enabled, or started as part of this task** — that is a deliberate deployment
decision, made when the first league is actually cut over (see the checklist
below), not a build-time side effect.

## Cutover checklist (spec §11 — do not retire the old timer yet)

`mlb-hil-ledes.timer` stays enabled and doing all the work until a league has
completed one full rollout run end to end. Until then, `mlb-rollout-host`
being a no-op (`host_executor: ran 0 cut(s)`, since no league has a rollout
enabled) is the expected and correct state.

1. Let Boarz R149 (closes 2026-08-27T06:30Z) run **manually** on the existing
   tooling — no rollout involved.
2. After R149 ships, enable a rollout for **one** league only.
3. Install the host executor timer (`systemctl --user daemon-reload &&
   systemctl --user enable --now mlb-rollout-host.timer`) and confirm
   `mlb-hil-ledes.timer` is still listed and enabled alongside it.
4. Watch that league's first run cut by cut in the Runs view. Do not leave
   it unattended.
5. **Only after** one league has completed a rollout end to end:
   `systemctl --user disable --now mlb-hil-ledes.timer` and delete
   `hil_autorun.py`.
