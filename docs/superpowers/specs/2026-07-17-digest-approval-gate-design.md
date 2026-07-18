# Digest Approval Gate (Phase 2 — HiL via ntfy) — Design Spec

**Date:** 2026-07-17
**Status:** approved (design)
**Builds on:** `docs/superpowers/specs/2026-07-17-digest-auto-pipeline-mvp-design.md` (Phase 1 = spine → auto-send, merged at `5f0e5b2`)
**Related backlog:** `BACKLOG.md` item 11 (four follow-ups — three folded here)

## Goal

Fill in the `hil` (human-in-the-loop) branch that Phase 1 left as a stub. Today the
runner reaches `rendered` for a `hil`-mode league and returns `'held'`, doing
nothing further (`ui/src/lib/digest/runner.ts:36`). Phase 2 turns that hold into:

> round ends → digest auto-captured + generated + rendered → **ntfy push to your
> phone** → you tap **Approve** (finalizes + sends immediately), **Deny** (drops
> it), or **Edit/Review** (opens the editor) → it posts to the league's WhatsApp
> chat.

The human tap is the quality gate. No LLM critic / rubric (still deferred to the
later evaluation phase).

## Scope

**In:**
- The `hil` state-machine transitions: `rendered → awaiting_approval | awaiting_review → done | denied`.
- A **requires-review gate**: rounds the resolver would structurally hold
  (season-final, no submissions, no votes, no theme description) notify **without**
  a one-tap Approve — they force a human to open the editor first.
- An **ntfy module** (`publish()` + notification builders) for approval, review,
  and operational-failure alerts.
- **Public, token-authed approve/deny endpoints** on bot-ui (reachable via the
  existing `mlb37.mattmariani.com` tunnel).
- **Approve = finalize + immediate send**, by exposing the bot control server to
  the compose network so bot-ui can POST its `/trigger`.
- Three folded item-11 fixes: **resolver-gate on finalize**, **force fresh regen**,
  **retry/requeue for failed jobs** (+ a conservative **one-job-in-flight guard**).
- ntfy **failure alerts**, additive alongside the existing owner-DM.

**Out (unchanged from Phase 1's deferrals):**
- LLM critic + quality rubric + self-edit loop (the evaluation framework).
- Learned house-style profile (MVP still uses the flat default `GenParams` blob).
- Reliable round-windowed chat auto-capture.
- **Snooze** as a notification action.
- Cloudflare service-token as a second auth factor — noted as an optional
  fast-follow, not built here (single-use token is the MVP auth).
- Retiring the owner-DM failure channel (kept additive this phase).

## Architecture (unchanged three-process shape, hil branch now live)

```
 api process            bot-ui process                         bot process
 ───────────            ──────────────                         ───────────
 email poller           digest runner                          control server
  on voting_ended  ──▶   claim job                              /trigger  (now
  write digest_jobs      capture / generate / render             reachable from
  marker                 resolver structural check               bot-ui — bound
                         ├─ auto  + clean → finalize ─┐           0.0.0.0, no
                         ├─ auto  + hold  → review notify         published port)
                         ├─ hil   + clean → approval notify       /send (built)
                         └─ hil   + hold  → review notify              │
                                             │                         ▼
                        ntfy.mattmariani.com ◀┘  (push to phone)     posts to
                                             │                        WhatsApp
                          Approve / Deny  (single-use token)          ▲
                                             ▼                        │
                        bot-ui public approve/deny endpoints          │
                          approve → finalize → POST bot /trigger ─────┘
                          deny    → mark denied (draft left unfinalized)
                          edit/review → GET deep-link to mlb37 editor (no endpoint)
```

- **Shared state:** `bot`, `api`, `bot-ui` all mount `./data` → they share
  `data/league.db`. All three sit on the default compose network (no explicit
  `networks:` block), reachable by service name.
- **Send path is unchanged.** Approve terminates in the existing resolver → poller
  → `sendGuard` → `sendLog` idempotency chain. Phase 2 adds no new send code; it
  only makes that chain fire *immediately* on approval instead of on the next poll.

## Job state machine

Statuses (existing + new), keyed on `digest_jobs.round_id` (PK):

```
pending → capturing → generating → rendered
  rendered ─(auto, sendable)──→ finalizing → done        (poller/trigger sends)
  rendered ─(auto, needs-review)→ awaiting_review         [ntfy review]
  rendered ─(hil,  sendable)───→ awaiting_approval        [ntfy approve]
  rendered ─(hil,  needs-review)→ awaiting_review         [ntfy review]
     awaiting_approval ─approve→ finalizing → done         (immediate send)
     awaiting_approval ─deny───→ denied                    (draft unfinalized)
     awaiting_*        ─edit/review→ (no state change)     (human opens editor;
                                                            UI send reconciles → done)
  any step → failed  (records error; ntfy alert; retriable via §7)
```

- `decision` ∈ `approved | denied | null`; `approval_token`, `decided_at`,
  `review_url` fields already exist on `digest_jobs` per the Phase 1 spec's data model.
- **Edit/Review is a read-only deep-link** — tapping it opens the editor but sends no
  server signal, so the job stays parked at `awaiting_approval`/`awaiting_review`.
  When the human finalizes + sends through the existing UI, `sendLog` is the signal
  that reconciles the job to `done`; if they instead abandon it, `Deny` (or a later
  requeue) is the explicit exit. No `editing` status and no `edited` decision are
  introduced in the MVP.
- **auto + needs-review is the item-11 fix:** an auto-mode league whose latest round
  is a season-final (etc.) no longer auto-finalizes and posts — it escalates to a
  review notification. Fail-safe: nothing structurally-borderline auto-posts.

## The requires-review gate (structural checks)

Before choosing a notification shape, the runner evaluates the **same structural
conditions** the resolver holds on (`ui/src/lib/digest/schedule.ts`
`resolveScheduledDigest`), *excluding* the draft/finalized checks (those are the
approval mechanism, not review triggers):

1. Season-final — `getNextRound(db, roundId) === null` (empty next-round teaser).
2. No submissions — `COUNT(ml_submissions WHERE round_id) === 0`.
3. No votes — `COUNT(votes WHERE round_id) === 0`.
4. No theme description — `!round.description?.trim()`.

Any trip → **`awaiting_review`**: notification carries **Review** (deep-link to
editor) + **Deny**, and **no one-tap Approve**. None trip → **`awaiting_approval`**:
full **Approve / Edit / Deny**.

These checks are factored into a small pure helper (e.g.
`structuralReviewReason(db, roundId, nowIso): string | null`) so both the runner's
gate and the resolver can share the intent, and it's unit-testable in isolation.

## Approve = finalize + immediate send

1. `POST /api/digest/approve { token }` on bot-ui (public via mlb37 tunnel).
2. Verify the single-use `approval_token`; reject if unknown/consumed.
3. Finalize the draft (reuse `POST /api/digest/:id/finalize`).
4. Consume the token (clear it), set `decision='approved'`, `decided_at`.
5. POST the bot control `/trigger` (now reachable at `http://bot:3003/trigger` on
   the compose network). The resolver — round now finalized + structurally clean —
   returns `send`, and the poller's existing `sendGuard`/`sendLog` chain posts.
6. Runner/endpoint transitions the job to `done` once the send ledger confirms.

**Control-server change:** `src/control/server.ts` currently binds `127.0.0.1`
(container-local). Change it to bind `0.0.0.0`. Safety is preserved because the bot
publishes **no host port** (see `docker-compose.yml` — `bot` has no `ports:`), so
the control surface is reachable only by sibling containers on the internal compose
network, and `/send` still defaults to dry-run with `sendGuard` fail-closed. Add a
`BOT_CONTROL_URL` env (`http://bot:3003`) that bot-ui reads.

`Deny` (`POST /api/digest/deny { token }`) verifies + consumes the token, sets
`decision='denied'`, status `denied`, and leaves the draft **unfinalized** so the
normal manual flow can still pick it up later. `Edit`/`Review` are GET deep-links
to the `mlb37.mattmariani.com` editor — no server endpoint, no token; the human
edits and sends through the existing UI, and `sendLog` reconciles the job to `done`.

## ntfy integration

New module `ui/src/lib/digest/ntfy.ts`:

- `publish(notification)` — POST to `${NTFY_URL}/${NTFY_TOPIC}` with title, body,
  click URL, and action buttons; `Authorization: Bearer ${NTFY_TOKEN}` when set
  (ntfy supports no-auth / basic / token — token chosen for revocability).
- Notification builders:
  - **approval** — title = `<league> — Round <n>`; body = short summary; tap →
    review link (`digest.mattmariani.com/d/<slug>`); buttons **Approve** (http POST
    to the approve endpoint w/ token) · **Edit** (view → editor URL) · **Deny**
    (http POST to deny endpoint w/ token).
  - **review** — same title/tap; buttons **Review** (→ editor URL) · **Deny**. No
    Approve.
  - **failure alert** — title = `⚠ digest pipeline`; body = stage + reason (ML-auth
    expired, capture/generate/render/send failure).
- `publish()` never throws out of the caller: a notification failure is logged, not
  fatal to the runner tick.

## Infra

- **ntfy** — already stood up by the user on a Cloudflare tunnel (`ntfy.mattmariani.com`),
  reachable and publish-capable. Phase 2 consumes it via `NTFY_URL` / `NTFY_TOPIC`
  / `NTFY_TOKEN` env.
- **Approve/deny endpoints** — served by bot-ui over the existing public
  `mlb37.mattmariani.com` tunnel (no Cloudflare Access today). The single-use token
  is the auth. No new tunnel required.

## Failure handling (additive)

Every runner failure path ends in a `failed` job row **and** an ntfy alert, while
**keeping** the existing WhatsApp owner-DM (unification deferred). ML-auth expiry is
the designated human-ping. The runner remains a `setInterval` loop that never throws
out of a tick.

## Folded backlog item 11 fixes

- **Resolver-gate on finalize** — implemented by the requires-review gate (§ above):
  the runner consults the structural checks before finalizing, so auto-mode never
  finalizes/posts a round the resolver would hold.
- **Force fresh regeneration** — the generate step always produces a fresh draft.
  Phase 1's generate POSTs `/draft` with empty `GenParams`, which `parseGenParams`
  treats as "no params" → returns any cached draft without an LLM call. Phase 2's
  generate forces regeneration (a `force` flag or non-cache-hitting params) so a
  pre-existing draft (e.g. hand-started) is replaced with a fresh one. In normal
  operation no prior draft exists — this only matters on the rare re-run.
- **Retry/requeue** — a transient capture/LLM/render failure is retried with bounded
  backoff (small N) before the job parks at `failed`; parking emits an ntfy alert,
  and a `requeue` path (endpoint or control action) resets a `failed` row to
  `pending`. No more silent-terminal failures.
- **One-job-in-flight guard** — the runner processes at most one job at a time
  (a claimed-but-unfinished job blocks a new claim), so two rounds ending close
  together never run concurrent ML CLI exports. (The `export.zip` filenames match
  but are per-league and fetched separately; the guard is insurance against unknown
  ML-CLI/auth concurrency limits, which the user flagged as uncertain.)

## Testing

- **Unit (TDD, fakes):** the structural-review helper (each hold reason + the clean
  case); the runner's mode×review branch (auto/hil × sendable/needs-review → correct
  status + notification builder called); token verification (valid / unknown /
  already-consumed); approve → finalize + trigger call; deny → unfinalized + denied;
  the ntfy builders (button sets, URLs); retry/backoff → alert; the one-job guard.
  Same style as the ~80 send-path + 213 ui digest tests already green.
- **Live (staged):** drive a `hil` job end-to-end against the **staging group**
  (`120363426590199032@g.us`, Matt + bot) exactly as Phase 1 was smoked —
  copy-first/revert: real ntfy push → tap Approve → immediate post to staging;
  then a Deny; then a needs-review round (verify no Approve button). Only after that
  against a real-people league.

## Build order (within Phase 2)

1. **Structural-review helper + runner gate** — pure helper; runner chooses
   `awaiting_approval` / `awaiting_review` / auto-finalize accordingly. Item-11
   resolver-gate lands here. (Notifies nothing yet — logs the decision.)
2. **ntfy module** — `publish()` + the three builders, behind env; unit-tested with
   a fake fetch. Wire failure alerts (additive).
3. **Approve/deny endpoints + token lifecycle** — public bot-ui routes; single-use
   token verify/consume; deny path.
4. **Control-server exposure + approve→trigger send** — bind `0.0.0.0`,
   `BOT_CONTROL_URL`, approve finalizes then triggers immediate send.
5. **Force fresh regen + retry/requeue + one-job guard** — the remaining item-11
   folds.
6. **Live staged smoke** — the copy-first/revert end-to-end run above.

Steps 1–4 deliver the working approval gate; 5 hardens; 6 proves it live.
