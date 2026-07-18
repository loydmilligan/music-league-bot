# Digest Auto-Pipeline MVP — Design Spec

**Date:** 2026-07-17
**Status:** approved (design)
**Source of truth for scope:** `docs/workflows/digest-automation-brainstorm.md` (Matt's per-block verdicts/priorities in its frontmatter)

## Goal

Turn the digest process from *mostly manual* into: **round ends → digest auto-captured + auto-generated → you approve via ntfy (or it auto-sends) → it posts to the league's WhatsApp chat.** Deliberately *without* the LLM evaluation/critic framework — the human ntfy approval is the quality control until that's built later.

## Scope

**In:**
- The **job spine** — a `digest_jobs` queue + a runner, triggered when a round's voting ends (block `1.1.1`).
- **Auto-capture** — the runner drives the existing `import-export-zip` flow (`1.3.2`, p0).
- **Auto-generation** — the runner drives the existing `llm.js` draft generation with a stored per-league default `GenParams` (`1.4.1` + `2.3.1`).
- **Per-league mode** — `auto` vs `hil` (`4.3.1` gate / auto-publish toggle).
- **The ntfy approval gate** — push notification with Approve / Edit / Deny, token-authed.

**Out (deferred, still real — later phases):**
- LLM critic + quality rubric + self-edit loop (`4.1.1`/`4.2.1`, step 7) — the "evaluation framework."
- Learned house-style profile (`2.1.1`) — MVP uses a flat default-`GenParams` blob instead.
- Reliable chat auto-capture (`2.2.1`) — MVP relies on whatever chat is already captured; the ntfy **Edit** path is the manual-paste fallback.
- Reconcile automation (`3.5.2`), finalize/publish polish (`5.x`).
- **Snooze** as a notification action.

## Where this sits in the 10-step pipeline

Covers blocks `1.1.1` (trigger), `1.3.2` (capture), `1.4.1`+`2.3.1` (generate), `4.3.1` (mode gate), and reuses `6.1.1` (send — already built & proven live). Introduces the doc's nominated new block **"digest job queue + runner"** (the spine).

## Already built — reused, not rebuilt

The outbound send half is done and tested live (proven end to end on the staging group, exactly-once idempotency verified):
- `src/whatsapp/sendGuard.ts` — fail-closed guard, per-league `@g.us` targets.
- `src/digest/manualSend.ts` + `src/control/` — the control plane (`/send`, `/trigger`).
- `ui/src/lib/digest/sendLog.ts` + `digest_sends` table — exactly-once send ledger.
- Group→chat map (`DIGEST_SEND_TARGETS`, discovered empirically).

The runner's **auto-send** branch and the ntfy **approve** action both terminate in the bot's existing control `/send`. Nothing about the send path changes.

The strict `finalized_at`-required gate I built is superseded by the mode/approval logic here (approval *is* the human gate).

## Verified headless (both checks passed 2026-07-17)

- **Generation:** `/draft` is a thin wrapper; the work is lib functions (`gatherRoundData`, `generateDraft`, `writeDraft` in `ui/src/lib/digest/llm.js`) taking `db` + `roundId` + `GenParams`. Runner-callable directly.
- **Capture:** `import-export-zip` takes no upload — it `probeMlAuth()`s, hits the host trigger daemon (`ML_AUTH_TRIGGER_URL/export-zip`) to run the ML CLI, then imports. Runner-callable.
- **ML auth:** `probeMlAuth()` (`ui/src/lib/mlAuth.ts:53`) detects validity; the host probe keeps it fresh; expiry is the one thing that alerts a human.

## Architecture — three processes

```
 api process                bot-ui process                 bot process
 ───────────                ──────────────                 ───────────
 email poller               digest runner (NEW)            control /send (built)
   emailIngest                poll digest_jobs               posts to WhatsApp
   on voting_ended  ──jobs──▶  probeMlAuth
   write digest_jobs           capture (import-export-zip)
   marker                      generate (llm.js + params)
                               render (renderDigestHtml)
                               ├─ auto  → call bot /send ──────────▶ post
                               └─ hil   → post ntfy ─┐
                                                     ▼
                                       ntfy server (self-hosted, public)
                                                     │  Approve/Edit/Deny
                                                     ▼
                               bot-ui token-authed approval endpoints
                                 approve → finalize → call bot /send ─▶ post
```

- **`api`** already runs the email poller and shares `data/league.db` with `bot-ui`. It writes the job marker; it does no processing.
- **`bot-ui`** hosts the runner (modeled on the existing `queueWorker`), the DB, the LLM/render capabilities, and the ntfy notification + approval endpoints.
- **`bot`** owns the WhatsApp client; only it can send. Reached via the existing container-local control server.

## Trigger (block 1.1.1) — corrected from the doc

The doc says "when `votes_are_in` flips the round to `complete`." The source is narrower: `emailIngest` maps `votes_are_in` → a `voting_ended` event that sets `rounds.voting_ended_at` and logs a `round_events` row (`src/email/emailIngest.ts:14,213`). It does **not** set `phase='complete'` (and `rounds.phase` is unreliable). So the marker is written **at the `voting_ended` handling**, keyed off that event — consistent with the resolver already using timestamps, not `phase`.

## Data model

- **`digest_jobs`** (new): `round_id` PK, `league_id`, `status`, `created_at`, `updated_at`, `error`, and approval fields folded in: `approval_token`, `decision` (`approved|denied|edited|null`), `decided_at`, `review_url`. Status is the state-machine value below.
- **Per-league digest config** (new): `mode` (`auto|hil`) and a default `GenParams` blob, stored per league (extends the existing settings/config surface). `DIGEST_SEND_TARGETS` already carries the target group id.
- **`digest_sends`** (existing): reused unchanged for send idempotency.

## Job state machine

```
pending → capturing → generating → rendered
  rendered ─(auto)→ sending → sent
  rendered ─(hil)→ awaiting_approval
     awaiting_approval ─approve→ sending → sent
     awaiting_approval ─deny────→ denied      (draft unfinalized)
     awaiting_approval ─edit────→ editing     (draft unfinalized; human opens editor)
  any step → failed  (records error, alerts via ntfy; retriable)
```

- **Idempotent claim:** the runner claims a job (`pending → capturing`) atomically, same pattern as `song_metadata_queue`.
- **`sending`** delegates to the bot control `/send`; the `digest_sends` ledger prevents a double-post exactly as tested.
- **`deny`/`edit`** unfinalize the draft (per Matt's spec) and leave it for the normal manual flow; a later re-finalize re-enters the pipeline.

## Step detail

1. **Capture** — `probeMlAuth()`; if invalid → `failed` + ntfy alert ("ML auth expired"), don't proceed. Else run the `import-export-zip` flow for the round. Run `runPrepChecks`; blocking-check failures → `failed` + alert.
2. **Generate** — call `generateDraft` with the league's default `GenParams`; `writeDraft`. (No modal, no human decisions — that's `2.1.1`, deferred.)
3. **Render** — `renderDigestHtml(roundId)` → the stable public `digest.mattmariani.com/d/<slug>` URL. Works on a draft; finalizing is deferred to approve.
4. **Branch on mode:**
   - **auto** — finalize + `bot /send`.
   - **hil** — post ntfy; job → `awaiting_approval`.
5. **Approve** (bot-ui, token-authed) — finalize the draft, then `bot /send`.
6. **Deny / Edit** — unfinalize; Edit's notification button also deep-links the `mlb37.mattmariani.com` editor.

## ntfy integration

- **Notification:** title = league + round; body = short summary; **tap/click → the review link** (`digest.mattmariani.com/d/<slug>`).
- **Action buttons (ntfy's 3-button max):** **Approve** (http POST, token) · **Edit** (view → `mlb37` editor URL) · **Deny** (http POST, token).
- **Token auth:** each job gets an unguessable single-use `approval_token`; approve/deny endpoints verify it. This is the auth (not Cloudflare Access — a notification tap can't do interactive login).
- **Channel unification:** ntfy also carries **operational failure alerts** (ML-auth expired, capture/generate/send failure), replacing the WhatsApp owner-DM failure notification.

## Infra

- Self-hosted **ntfy** exposed publicly (e.g. `ntfy.mattmariani.com`) via a Cloudflare tunnel, mirroring the `digest-static` pattern (its own tunnel, no Cloudflare Access).
- The **approve/deny endpoints** must be publicly reachable + token-authed (a route on bot-ui exposed via tunnel bypassing Access, token as auth), so the phone can POST from anywhere.

## Failure handling

Every failure path ends in a `failed` job row **and** an ntfy alert — no silent `console.error`-only failures for a pipeline running less-attended than before. The runner is a `setInterval` loop (matching `queueWorker`/email poller) that never throws out of a tick; a failed job is retriable with backoff. ML-auth expiry is the designated human-ping.

## Testing

- **Unit (TDD, fakes):** the trigger hook (voting_ended → marker), the runner state machine (each transition, the auto/hil branch, failure→alert), token verification, the mode branch. Same style as the ~80 send-path tests already written.
- **Live (staged):** drive a job through the control plane against the **staging group** (you + bot), exactly as the send was validated — dry-run the notification, then a real ntfy → approve → post to staging, before any real-people league.

## Build order (within this MVP)

1. **Spine:** `digest_jobs` table + runner skeleton + the `voting_ended` marker. Runner logs decisions, sends nothing.
2. **Capture wiring:** runner drives `import-export-zip`; ML-auth-expired alert.
3. **Generate wiring:** default `GenParams` per league; runner drives `generateDraft` + render.
4. **Auto-mode end-to-end:** mode branch → reuse `bot /send`; validate against the staging group.
5. **ntfy gate:** notification + token-authed approve/deny/edit endpoints; the hil path.
6. **Infra:** self-hosted ntfy + tunnel + public token endpoint.

Steps 1–4 deliver a working unattended auto-send to the staging group with zero new external infra; 5–6 add the human gate and the push channel.

## Deferred to later phases (post-MVP)

- **Phase C:** reliable round-windowed chat auto-capture (`2.2.1`) — first step is *measuring* auto-capture coverage vs pasted text.
- **Phase D (the evaluation framework):** LLM critic + quality rubric + self-edit loop (`4.1.1`/`4.2.1`), and the learned per-league house-style profile (`2.1.1`). First step: write the quality rubric.
- **Phase E:** headless finalize/publish (`5.2.1`/`5.2.2`), reconcile automation (`3.5.2`), the `5.x` cuts, snooze.
