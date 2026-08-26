# The Rollout — design

Date: 2026-08-26 · Owner: Matt · Status: approved, ready for planning

Project **A** of the four-part digest-improvement pass, revised. The original
framing was "wire the QA gates into the HiL flow." Brainstorming replaced it
with something larger and better-shaped: a new configuration entity that sits
above pipelines and answers, per league, *what happens when a round ends*.

| | project | depends on |
|---|---|---|
| **A** | **The Rollout (this doc)** | B for targeting content |
| B | Participation metric | — (shipped 2026-08-23) |
| C | Visual upgrade of text-heavy sections + coherence pass | — |
| D | Impact loop: did digest choices move participation? | B |

A companion spec, **not written yet**, extends the digest Pipeline so Coinage,
the Guesser, the deterministic insight block, media generation, and the
evidence feeds become first-class Tracks with declared order. It is referenced
here as *the pipeline extension spec* and is independent: the Rollout treats
digest generation as one opaque cut, so neither spec blocks the other.

---

## 1. Purpose

Every week the same thing happens by hand. A round closes, Matt opens Claude
Code, and asks it to go check on things: run `verify_facts`, run `dedupe_scan`,
build a mention matrix, look at who is under-engaged, draft ledes, pick the
good ones, write a punch-up script, verify it again, then post. Some of it is
automated — draft generation, the approval gate, lede generation via
`hil_autorun` — but the middle is a conversation held together by memory.

The goal is not to replace that collaboration. It is to **put it on rails**, so
the same work happens in a structured, resumable, per-league-configurable way,
with Matt doing his parts and the agent doing its parts, and nothing depending
on either of them remembering the order.

### Success criteria

- A round closes and the process runs without anyone starting it.
- It stops exactly where a human judgement is genuinely needed, and nowhere
  else.
- A problem the agent can fix gets fixed and the run continues.
- A problem it cannot fix lands in front of Matt with the evidence attached,
  rather than silently killing the week's digest.
- A step cannot be forgotten, because forgetting is not a state the model has.

### Non-goals

- No replacement of the digest generation pipeline. It stays as it is and is
  invoked as a single cut.
- No porting of Python QA scripts into the container, and no adding Python or
  the `claude` CLI to any image.
- No new notification channel. The existing `notify()` dispatch and its
  settings routing grid are reused as-is.
- No general-purpose workflow engine. This models one process shape, driven by
  the one we actually run.

---

## 2. Vocabulary

The codebase already commits to a music-release metaphor in
`ui/src/lib/digest/pipeline.ts`: a **Release** (digest or archive) is made of
**Tracks**, grouped into **EPs** by **Skips**, with **Merge** collapsing
adjacent same-model tracks and **Cover** replaying a track later with
accumulated context.

The Rollout sits one level above and **reuses EP, Skip and Cover unchanged**.
Identical semantics get identical words; inventing parallel vocabulary for the
same three concepts would mean two mental models instead of one.

| Term | Meaning |
| --- | --- |
| **Rollout** | The per-league entity: what happens when a round ends. One rollout definition per league. |
| **Cut** | One block of a rollout. Three kinds: `script`, `agent`, `human`. |
| **Hold** | A `human` cut. It parks the run, notifies, and lifts on a UI action or ntfy tap. |
| **Check** | A pass condition on a cut. |
| **Cover** | Replay a cut in a later EP with accumulated context. Unchanged from the pipeline level, plus one new field. |
| **Remaster** | A cover flagged to fire **only on check failure**. This is how repair is expressed. |
| **EP** | One parallel phase: the cuts between two skips. Unchanged. |
| **Skip** | A serialization barrier. Everything after it reads everything before it. Unchanged. |

**Merge does not exist at the rollout level.** Collapsing two adjacent agent
cuts into one call would destroy the context isolation that makes parallel
cuts meaningful.

**A Rollout never contains Tracks.** It contains Cuts, one of which runs a
Release. That boundary is what keeps the two layers from bleeding into each
other.

---

## 3. The context rule

Context visibility is **declared by position, not wired by hand** — the rule
the digest pipeline already uses, applied one level up:

- Cuts in the same EP run in parallel and **cannot see each other's results**.
- Cuts after a skip read the output of **everything upstream**.

There is no separate "dossier" object. The dossier *is* the accumulated
`output_json` of every cut run in an earlier EP. A cut's context is therefore
derived from where it sits, and adding a cut to the definition wires its inputs
automatically.

This fits the real work. `verify_facts`, `dedupe_scan`, `mention_matrix` and
`participation` are mutually independent — they belong in one EP and run at
once. Then a barrier. Then the punch-up cut reads all four together, which is
exactly the moment a human currently sits and reads four terminal outputs side
by side.

---

## 4. Architecture

### 4.1 This generalizes a runner that already exists

`digest_jobs` is already a persisted, resumable run object: one row per round
with `status`, `attempts`, `error`, `approval_token`, `review_url`,
`decided_at`. `runnerLoop.ts` polls it, claims one job (`hasActiveJob` guard),
transitions it, retries on failure, and parks it at `awaiting_approval` until
an ntfy tap resumes it.

That is a Rollout with one hold and a hardcoded five-step path — capture →
generate → render → finalize → send. The Rollout is the same machine with the
path lifted out of code and into config.

### 4.2 Two executors, one run

No container has `python3` or the `claude` CLI — verified 2026-08-26 against
`bot-ui`, `bot`, and `api`. Every QA script is Python and `generate_ledes`
shells out to `claude -p`. This is why `hil_autorun` exists as a host-side
systemd poller. The Rollout formalizes that split rather than fighting it.

Every cut declares a **runtime**:

- **`app`** — runs in bot-ui, where the existing runner lives: capture,
  generate, render, finalize, send, archive refresh. These reuse the live HTTP
  endpoints exactly as `runnerLoop` does today. No production path is ported.
- **`host`** — runs on the host, where `python3`, `claude`, and
  `scripts/digest-qa/*` already are: every check, every agent cut, ledes,
  punch-up, bridge, cover art.

Run state lives in the DB where both executors see it. Each polls for cuts that
are ready *and* match its runtime, claims one, runs it, writes the result, and
advances. Neither needs to know how the other works.

Rejected: adding Python and `claude` to the bot-ui image (large image, secrets
in a container, and `claude` auth in a container is its own project);
reimplementing generation on the host (duplicates live production paths).

### 4.3 The executor as agent, not step-runner

A `script` cut runs a command. An `agent` cut hands headless Claude a job:
prompt, tools, its dossier slice, and success criteria. The distinction is
deliberate and is the reason for two kinds rather than one:

- `verify_facts` already grades every check `ok`/`warn`/`fail` with a named
  check id and exits non-zero. Wrapping that in a model call to ask "did it
  pass?" adds latency, cost, and a fresh chance to misread output that was
  already unambiguous. The script *is* the check.
- Punch-up is judgement. `punchup_r148.py` is hand-authored every week against
  freshly verified facts. That is an agent's job, and it is the largest manual
  block in the current process.

Rejected: one long-lived Claude session owning the whole run as a checklist.
It has the best continuity of judgement, but the two-stop requirement means a
run can be parked for eight hours between EPs, and a session cannot be parked
and resumed. Checkpointing at cut boundaries is what buys resumability, and
when something breaks at 3am the failing cut and its captured output are a far
better debugging surface than a transcript. Continuity of judgement is
recovered by the context rule in §3 instead.

---

## 5. Data model

Three additive tables. Nothing existing changes.

```
rollout_configs(
  league_id     INTEGER PRIMARY KEY REFERENCES leagues(id),
  definition_json TEXT NOT NULL,
  enabled       INTEGER NOT NULL DEFAULT 0,
  updated_at    TEXT NOT NULL
)

rollout_runs(
  id              TEXT PRIMARY KEY,
  league_id       INTEGER NOT NULL REFERENCES leagues(id),
  round_id        INTEGER NOT NULL REFERENCES rounds(id),
  definition_json TEXT NOT NULL,   -- snapshot at start; see below
  state           TEXT NOT NULL,   -- running | parked | done | failed
  current_ep      INTEGER NOT NULL,
  resume_token    TEXT,
  review_url      TEXT,
  error           TEXT,
  started_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  finished_at     TEXT
)

rollout_cut_runs(
  run_id      TEXT NOT NULL REFERENCES rollout_runs(id) ON DELETE CASCADE,
  cut_id      TEXT NOT NULL,
  ep          INTEGER NOT NULL,
  runtime     TEXT NOT NULL,       -- app | host
  state       TEXT NOT NULL,       -- pending | running | done | failed | skipped
  attempts    INTEGER NOT NULL DEFAULT 0,
  remasters   INTEGER NOT NULL DEFAULT 0,
  claimed_at  TEXT,
  heartbeat_at TEXT,
  output_json TEXT,
  error       TEXT,
  started_at  TEXT,
  finished_at TEXT,
  PRIMARY KEY (run_id, cut_id)
)
```

`rollout_runs.definition_json` is a **snapshot of the config taken at run
start**, so editing a league's rollout never mutates a run already in flight —
the same reason the pipeline copies its config into a generation.

`enabled` defaults to 0. A league with no row, or a row with `enabled = 0`,
uses the existing `digest_jobs` path unchanged.

### Definition shape

```ts
type Rollout = {
  leagueId: number;
  order: string[];                          // cut ids, in order
  cuts: Record<string, CutDef>;
  skipAfter: Partial<Record<string, true>>;  // a skip sits AFTER this cut
  covers: Cover[];
  disabled?: string[];                       // cut ids excluded from this rollout
};


type CutDef =
  | { kind: 'script'; runtime: 'app' | 'host'; command: string[]; check?: Check }
  | { kind: 'agent';  runtime: 'host'; job: string; model?: string; check?: Check }
  | { kind: 'human';  title: string; reviewPath: string; alertType: AlertType };

type Check = {
  /** How to read pass/fail from the cut's output. */
  rule: 'exit-zero' | 'no-fail-checks';
};

type Cover = {
  of: string;
  model: string;
  /** Fire ONLY when the original's check failed. */
  remaster?: true;
  /** Max remaster firings. Default 1. */
  budget?: number;
};
```

`AlertType` is the existing union from
`ui/src/lib/notifications/channels/types.ts`; a hold reuses one of the alert
types already wired into the settings routing grid rather than defining new
ones.

Cut ids are unique within a rollout. A cut that runs the same script twice —
`verify_facts` in EP2 and again in EP6 — is **two cuts with distinct ids**
(`verify` and `verify-post-punchup`), not one cut appearing twice. The solver's
`order` is a list of ids, so a repeated id would be ambiguous.

The solver takes an **active** list, derived as `order` minus `disabled`,
mirroring `activeSections` at the pipeline level.

`Cover` is the **shared** type with the pipeline level, extended by
`remaster` and `budget`. The digest pipeline never sets them, and its track
editor hides the remaster checkbox until the pipeline extension spec gives
tracks checks to trigger on.

---

## 6. The solver

Rollout EP resolution is `resolvePipeline` minus merge and minus model
resolution — the same algorithm over the same shape.

There are **already two implementations** of that algorithm (`resolvePipeline`
server-side, `solveClientEPs` client-side) kept honest by
`pipeline-parity.test.ts`. Adding a third and fourth would be a genuine
regression. So:

**Extract the shared core into primitives both levels call:**

- `bucketBySkip(order, skipAfter, active) → string[][]` — including the OQ-2
  rule that an inactive skip anchor still fires its boundary.
- `placeCovers(buckets, covers) → Map<epIndex, Cover[]>` — including
  fire-in-the-next-EP placement, trailing-EP append, and skipping covers whose
  original is inactive.
- Empty-EP elision.

Merge and model-grouping stay in the pipeline's own solver. The rollout solver
adds only remaster filtering: a cover with `remaster` is placed exactly as any
other cover but is not *fired* unless its original's check failed.

Model resolution for `agent` cuts reuses the `modelFor` cascade and
`SECTION_BUCKET_MAP` — cuts become additional pinnable keys. No parallel
resolver.

---

## 7. Execution

### Trigger

**Corrected 2026-08-26 during planning.** The trigger is not a scheduler. A
`digest_jobs` row is created by the **email poller in the `api` container** —
`enqueueDigestJob` in `src/email/emailIngest.ts`, fired when Music League's
round-complete email is parsed. `buildSchedule` / `/api/digest/schedule` is a
read-only advisory for the bot's auto-poster and enqueues nothing.

This matters because `src/` (bot, api) and `ui/` are separate TypeScript
projects with **no shared imports** — `digest_jobs` DDL is mirrored verbatim in
both with a keep-in-sync comment.

So the Rollout does **not** touch the trigger. The api container keeps
enqueueing `digest_jobs` exactly as it does today. The **app executor in
bot-ui** promotes a `pending` digest job into a rollout run when that league
has an enabled rollout config, and otherwise leaves it for `runOneJob`. All
rollout code stays in `ui/`, no DDL is mirrored into `src/`, and the trigger
path — which lives in a process that has crash-looped before — is not modified
at all.

### Claiming

Each executor polls for cuts in the run's `current_ep` that are `pending` and
match its runtime, then claims one atomically
(`UPDATE … SET state='running', claimed_at=? WHERE state='pending'`, checking
`changes === 1`). An EP advances when every cut in it is terminal.

### Leases and crash recovery

`digest_jobs` guards with `hasActiveJob`, which is sufficient only because one
process owns the whole path. A host executor can be killed mid-cut, leaving a
row in `running` forever. So claims carry a lease: `claimed_at` plus a
`heartbeat_at` the executor refreshes while working, and a reaper that returns
stale `running` cuts to `pending` and spends an attempt. Without this the first
host crash silently wedges a round.

### Two budgets, never conflated

- **`attempts`** — transient failure: timeout, network, `claude -p` non-zero
  exit. Reuses the existing `failOrRetry` policy.
- **`remasters`** — a check failed and a remaster cover fired. Budget from the
  cover's `budget`, default 1.

### What failure does

A check fails → its remaster cover fires with the failing check ids and the
draft as context → the check re-runs → it passes → the run continues, and the
failure is visible only in run history.

If the remaster budget is exhausted, **the run does not die.** It parks at the
next hold *early*, carrying the unresolved failures, so the review screen shows
the problems and offers fix-and-resume or override. A fixable problem never
stops the run; an unfixable one never gets past a human.

### Holds

A hold sets the run to `parked`, mints a `resume_token` and `review_url` — the
`approvals.ts` token pattern verbatim — and fires the existing `notify()`
dispatch, which already routes to ntfy and WhatsApp via the settings grid.
Resume comes from a UI action or an ntfy tap; the cut goes terminal and the
executor picks up the next EP on its next poll.

This is the approval gate generalized from one hold to N.

### Concurrency

`hasActiveJob` currently permits one job globally, which is wrong here: a run
parked overnight would block another league's round. The guard becomes **one
active run per league**, plus **one running cut per runtime on the host**, so
two `claude -p` sessions never race over the same DB.

---

## 8. The default rollout

The process we run today, written down. `✓` marks a cut with a check and a
remaster cover.

```
EP0   capture                                                    app
 ── skip ──
EP1   generate draft                                             app
 ── skip ──
EP2   verify_facts✓   dedupe_scan✓   mention_matrix   participation   host
 ── skip ──
EP3   ledes                                                      host · agent
 ── skip ──
EP4   HOLD — /hil lede review (rate + direction)
 ── skip ──
EP5   punch-up                                                   host · agent
 ── skip ──
EP6   re-verify✓   dedupe re-scan✓   semantic-dupe findings       host
 ── skip ──
EP7   dupe review page      cover art                             host
 ── skip ──
EP8   HOLD — approve & send
 ── skip ──
EP9   finalize + send                                            app
 ── skip ──
EP10  bridge                archive refresh                       host / app
```

Three things this encodes that the current process does not guarantee:

1. **Checks re-run after punch-up** (EP6). Punch-up is when fabricated quotes
   are actually introduced; verifying only before edits verifies the wrong
   artifact.
2. **Bridge is a cut** (EP10). It cannot be forgotten because forgetting is not
   a state. This structurally fixes the class of bug currently live on R148,
   whose bridge row was never generated.
3. **Archive refresh is a trailing optional cut**, which is the right weight
   for it — the archive pipeline is deliberately the simplest thing that works
   and needs no further configurability now.

The default is **two-stop** (EP4 and EP8), per the agreed starting point. Holds
are a property of cuts, not of the engine, so per-league variation — one-stop
for a quiet league, fully manual for a new one — is configuration, not new
code. That was the stated goal; two-stop is only the seeded default.

---

## 9. The screen

`/settings/models` has two tabs today, `models` and `pipeline`, with the
pipeline tab toggling digest|archive. It becomes three: **Models · Pipelines ·
Rollouts**. Pipelines stops being the top of the hierarchy and becomes the
layer a Rollout composes.

**Rollouts · Definition** — a league picker, then the Edit/Preview pattern the
pipeline editor already uses: ordered cut list, reorder, skip toggles,
enable/disable a cut, per-cut model, add cover with the **remaster** checkbox
(tooltip: *fires only when this cut's check fails*). Preview renders resolved
EPs, reusing the existing preview components and the `callCount` / `costBand`
derivations rather than new ones.

**Rollouts · Runs** — live and historical: which EP a run is in, what each cut
produced, which checks failed and whether a remaster fixed them, and a resume
button for a parked hold. This is the surface that replaces reading four
terminal outputs.

Plus a compact run-state strip on the round's digest page, so opening a digest
shows that its run is parked at the lede hold without a trip to settings.

---

## 10. Testing

**The critical property first:** a league with no rollout config, or with
`enabled = 0`, behaves *exactly* as it does today — same `digest_jobs` path,
same states, same notifications. This is the direct analogue of the degenerate
guarantee the pipeline solver already documents and tests, and it is what makes
the work safe to merge while live rounds are closing.

- Shared solver primitives, with the `pipeline-parity.test.ts` pattern extended
  so server and client stay honest at both levels.
- Cover with `remaster`: does not fire on success; fires on check failure;
  respects `budget`.
- Budget exhaustion parks at the next hold carrying failures — never dies,
  never advances past a hold.
- Lease reaping: a cut abandoned in `running` returns to `pending` and spends
  an attempt.
- Two executors never double-claim a cut.
- A parked run in one league does not block another league's run.
- Resume from park after an arbitrary delay and across an executor restart.
- Context rule: a cut in EP*n* receives output from EP*<n* only, and never from
  a sibling in its own EP.

---

## 11. Delivery

Every rollout is behind the per-league `enabled` flag, default off, so the code
merges while both live leagues stay on the current path.

**Boarz R149 closes 2026-08-27T06:30Z and will be run manually** with the
existing tooling. Nothing runs on new machinery the day it is written. The
first live rollout is a league chosen after that, on the two-stop default.

`hil_autorun`'s hardcoded "find rounds, run `generate_ledes`, notify" becomes a
rollout definition, and `mlb-hil-ledes.timer` becomes the generic host
executor's poll. It is retired only once a league has completed a rollout run
end to end.

---

## 12. Open questions

- **Agent cut invocation.** Whether host agent cuts shell out to `claude -p`
  (as `generate_ledes` and `generate_bridge` already do) or use the Claude
  Agent SDK for better tool control and structured results. Both satisfy this
  design; the choice affects only the host executor's internals and should be
  settled during planning, with `claude -p` as the conservative default since
  two scripts already prove that path.
- **Cover art cut (EP7).** `scripts/cover-gen/` exists but its integration
  point in the digest flow is not documented here and needs a read during
  planning.
- **Semantic-dupe findings format.** `dupe_review_page.py` currently takes
  hardcoded `FINDINGS`. The agent cut that produces them needs an agreed JSON
  shape, and the script needs to read findings from a file rather than its
  source.
