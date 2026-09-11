# Incident 2026-09-10 — Travel host outage (music-league-bot)

**Status:** Resolved (one item outstanding: round 150 digest)
**Severity:** SEV-2 — degraded service, one user-facing deliverable missed, **no data loss**
**Duration of hard outage:** 20h 54m (2026-09-09 21:07:36 PDT → 2026-09-10 18:01:30 PDT)
**Detected by:** The owner, on returning home and asking. No automated detection.
**Scope:** music-league-bot only. Host-wide concerns routed to sysops-agent.

---

## 1. Summary

The single host (`mash-ubie`, a laptop that travels with the owner) powered off at
2026-09-09 21:07 PDT and stayed down for ~21 hours. All four containers, all six
host timers, WhatsApp connectivity, chat relay ingestion and email polling were
offline for that window.

Both ingestion paths proved **durable** — the IMAP mailbox and the Pixel relay
buffer both replayed in full on recovery, with zero detected message loss.

The real damage was narrower and sharper than "everything was down": **the round 150
digest job was driven into a terminal `failed` state by a transient failure** three
minutes before the host went down, and nothing recovers it.

**Correction (recorded deliberately):** the first pass of this report called that digest
"dead", implying the work was lost. It was not. Round 150 has 6 generated sections
(podium, villain, flow, consensus, quotes, chat) over complete underlying data
(10 submissions, 85 votes — comparable to round 149's 10/89). What is broken is the
*job status*, not the *work product*: `status=failed, attempts=3`, no `approval_token`,
no `review_url`, `finalized_at` null. The pipeline will never advance it to the approval
gate on its own. **A job status that says `failed` while ~all of the work succeeded is
itself a root cause** — it misrepresents recoverability to both humans and agents.

A second, unrelated fault (`mlb-submission-status` broken since Sep 7) had been
failing silently for **3.5 days** before this incident and was only found during
this review.

---

## 2. Timeline (PDT)

| Time | Event |
|---|---|
| Sep 05 11:21 | Host boots. Owner is away for work. |
| **Sep 07 14:48** | `mlb-submission-status` starts failing: `spawnSync cli-web-musicleague ENOENT`. **Silent. 10 consecutive failures over 3.5 days.** |
| Sep 09 20:58:45 | Music League emails `votes_are_in` (round 150) + `round_starting` (round 151). |
| Sep 09 20:59:0x | Both emails captured and recorded correctly. Digest job 150 enqueued. |
| Sep 09 21:01:10 | Digest `draft-150-7f53f825` created; share slug `Msr9DMIUHfNZ72wJ` minted. |
| **Sep 09 21:04:43** | Digest job 150 exhausts **3/3 attempts** and is marked `failed`. Error: `capture auth: curl (6) Could not resolve host: app.musicleague.com` — DNS dying as the host tore down its network. |
| Sep 09 21:05:41 | Last line the bot ever writes to its container log. |
| **Sep 09 21:07:36** | **Host powers off. Outage begins.** |
| Sep 09 21:07 → Sep 10 18:01 | 4 `user_submitted` emails (round 151) arrive; Boarz + Second Best chat continues. All buffered upstream. |
| **Sep 10 18:01:30** | **Host boots.** Containers auto-start. |
| Sep 10 18:01:43 | `mlb-submission-status` fails again (pre-existing bug). |
| Sep 10 18:02:03 | Email poller catches up — all 4 missed emails recorded. Max delay 20h50m. |
| Sep 10 18:02:39 | `mlb-hil-ledes` generates ledes for round 150 — **partial** auto-recovery over a job that is still `failed`. |
| Sep 10 ~18:02 | Bot reaches WhatsApp `ready`; control server binds :3003. |
| Sep 10 18:34 | Owner asks for a review. Investigation begins. |
| Sep 10 18:37 | `mlb-submission-status` fixed (symlink onto the unit's PATH). Verified exit 0. |
| Sep 10 ~18:46 | Chat relay backfill finishes draining. |
| — | **Round 150 digest remains `failed`. Never auto-retried.** |

---

## 3. Impact

**No data loss.** Both ingestion paths are durable by design:
- *Email* — IMAP retains server-side; the poller replayed on restart.
- *Chat* — the Pixel `grouprelay` app buffers and re-POSTs; backfill drained in ~45 min.

**What was actually lost:**

1. **Round 150's digest never reached the approval gate or the group.** The sections and
   data are intact; the job is stuck terminal and will stay that way without a manual
   requeue. *(Being handled separately by another agent — not an action item here.)*
2. **~21h of submission-tracking blindness** on round 151 (compounded by the
   independent `submission-status` bug, which made it 3.5 days).
3. **Bot container logs are detached** — the json log file was unlinked while the
   container held the fd. Post-incident forensics on the bot itself were impossible;
   liveness had to be inferred from the control-server bind instead.

**What we got lucky on — luck, not design:**
- No `voting_started` email landed in the window, so the YTM drop pipeline had nothing
  to miss. Had one arrived, the playlist + cover drop would have been ~21h late.
- The round 150/151 transition fired **8 minutes before** the host died. Eight minutes
  later and the transition itself would have been missed entirely.

---

## 4. Root causes

1. **Single point of failure with no remote hands.** The production host is a laptop
   that physically leaves the building. Once it is off, there is no path to it.
2. **Zero detection.** Mean time to detect ≈ 21h, and only because a human came home.
   Nothing pages, emails, or pushes when the bot stops.
3. **Retry budget consumed by a correlated failure.** `failOrRetry`
   (`ui/src/lib/digest/jobs.ts:40`) burns attempts against *any* error. A shutdown-
   induced DNS failure is not independent — all 3 retries hit the same dying network
   within 6 minutes, converting a transient fault into a permanent dead state.
4. **No reconcile-on-boot.** Nothing re-examines `failed` jobs after recovery. The
   system came back up and simply left the work dead, while *other* parts of the
   pipeline (ledes) moved on over it — leaving inconsistent state.
5. **No graceful shutdown.** The host went down with in-flight pipeline work.
6. **systemd PATH fragility.** Units carry a hand-written PATH; a binary living in a
   venv resolved interactively but not under systemd, and failed silently for 3.5 days.
   The uncommitted `process.execPath` fix in `scripts/ytm-drop/run.mjs` is the *same
   bug class*, already encountered and not yet generalized.

---

## 5. Response assessment

**What went well**
- Recovery of both ingestion paths was fully automatic and lossless.
- The pre-existing `submission-status` fault was found and fixed during triage.
- WhatsApp readiness was confirmed from the code path (`src/index.ts:59-71` — the
  control server only binds inside `client.on('ready')`) rather than assumed.
- Restart counts were checked, not just "Up" status — per the known "Up N hours lies"
  failure mode.

**What went badly**
- **The first review declared the system "fully up" while round 150's digest sat
  `failed`.** Infrastructure liveness was verified; *business outcomes* were not.
  Every container was green and the single thing the app exists to produce was dead.
- **An incorrect all-clear was given on the relay** ("no gap — messages flowed every
  day"). Daily row counts masked a 21h ingestion gap, and `max(ts)` was read
  mid-backfill. The conclusion was right by luck; the evidence did not support it.
- Triage checked *components*, not *pipelines*. No check existed for "is there a
  completed round without a delivered digest?" — which is the question that mattered.

---

## 6. Action items

**Owner key:** `MLB` = this repo/app. `SYS` = belongs to the system-wide process
(sysops-agent); listed here only so the app's needs are on record.

| # | Action | Type | Owner |
|---|---|---|---|
| A1 | Don't spend retry budget on transient/network errors — classify before burning attempts (`ui/src/lib/digest/jobs.ts:40`) | Fix | MLB |
| A2 | Reconcile-on-boot: after restart, surface jobs left terminal-`failed` and completed rounds with no delivered digest | Fix | MLB |
| A3 | Make job status reflect actual completeness — `failed` with 6/7 sections done is a lying status | Fix | MLB |
| A4 | Outcome-level health check: "is there a completed round with no delivered digest?" — the 30-second check that would have caught this | Detect | MLB |
| A5 | Alert on silently failing timers — `mlb-submission-status` failed 10x over 3.5 days with zero signal | Detect | MLB |
| A6 | External dead-man's-switch — must live off-box to survive total host loss | Detect | SYS |
| A7 | Durable logging — the bot's container log is detached *right now*; fix, and ship logs off-box | Ops | MLB+SYS |
| A8 | Off-box backup: `data/league.db`, `.env`, `.wwebjs_auth` (WhatsApp session) | Backup | MLB+SYS |
| A9 | Remote access to the host while travelling | Prep | SYS |
| A10 | Generalize the systemd PATH/interpreter bug class — the uncommitted `process.execPath` fix in `scripts/ytm-drop/run.mjs` is the same bug already met twice | Fix | MLB |

**Incident review process itself:** deliberately out of scope for this repo — being
designed system-wide with sysops-agent.

