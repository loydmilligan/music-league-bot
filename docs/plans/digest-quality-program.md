# Digest Quality Program

Tracking doc for formalizing digest generation so a round's digest arrives
needing editorial *taste* decisions, not factual rework. Archive work is
deliberately parked until the digest track is stable.

Owner: Matt · Started: 2026-08-16 · Status: **planning → digest track active**

---

## Why this exists (the evidence)

Today the pipeline auto-generates a digest at round close, then Matt opens a
Claude session and — from memory, every time — re-explains the league's voting
rules, asks for an error sweep, supplies the week's inside jokes, and directs a
punch-up. That session-by-session improvisation works, but it means every
digest ships only after hours of rework, and the same categories of error recur
because nothing learned in one session is encoded anywhere.

Failure taxonomy from the last three digests (R147 Boarz, R127 Fam Jam, R139
Second Best) — every one of these was caught by hand in a session:

| # | Failure class | Examples | Mechanically checkable? |
|---|---------------|----------|--------------------------|
| F1 | **Fabricated ballot facts** | invented voter lists ("all 11 voters"), submitters voting on own songs, wrong point values | YES — votes table |
| F2 | **League rules not encoded** | comments-without-points treated as downvotes; "voting happens all week" (it's one ballot, filed at once); vote budgets wrong | YES — per-league rulecard |
| F3 | **Structural rules not encoded** | no-vote penalty (Joe Quinto: upvotes voided, downvotes stand); tiebreaker cascade (true tie R139; voter-count sort R127) | YES — deterministic |
| F4 | **Wrong villain / wrong last place** | Halsey called last when Low Sun scored lower (then voided to 0) | YES |
| F5 | **Missed gold in the data** | "Like me Timmy!" submission comment; Michael Black's self-ballot; TJ's tie-creating downvote | PARTIALLY — surfaceable, taste picks |
| F6 | **Cross-section repetition** | same quote verbatim in podium + consensus + quotes; cat-lobby complaint duplicated in chat + regulars | YES — n-gram scan (built 2026-08-16, ad hoc) |
| F7 | **Mention imbalance** | BP/Philip at 1 mention while the Blacks got 25+ | YES — inventory scan (built ad hoc) |
| F8 | **Identity resolution gaps** | `~ Sarah` (narrow no-break space) unlinked → wrong-Sarah risk; monicac1217 = Michael Black | YES — linter |
| F9 | **Stale/missing sections** | new section kinds (chat, storylines) absent from pre-existing drafts; require manual row inserts or destructive full regen | YES — schema check |
| F10 | **Render regressions** | tied ranks → each_key_duplicate hydration crash; long spotlight quotes at 40px; mid-word wraps | YES — headless smoke |
| F11 | **Chat window coverage** | moments clustered in final 2 days of an 8-day window | YES — timestamp spread |

Key insight: **F1–F4, F6–F11 are all verifiable by code.** Only F5 (what's
funny) and the punch-up voice genuinely need a human/LLM editorial pass. The
program's core move is splitting the current monolithic "generate then argue
with it" flow into: deterministic facts → grounded draft → automated verify →
editorial punch-up with a formal protocol.

---

## Workstreams

Ordering: digest first (Matt: "the digest is probably the most important part
of our app"). Archive (WS4/5/7) parked until WS2/3/6 are in decent shape.
WS1 (repo sanitization) can run in parallel at low intensity.

### WS1 — Repo sanitization
The repo has accumulated design docs, one-off exports, scratch DBs, and
sub-project debris. Target end state: current code + a minimum doc set
(README, CHANGELOG, versioning, PSI_INDEX, active plans).

- [x] Inventory the root: classify every top-level file/dir (code / active doc
      / stale design / data / export / scratch). Note: `design/`, `exports/`,
      loose `*.db` files at root (app.db, bot.db, db.sqlite, league.db…),
      `.wwebjs_cache.bak-*`, `.env.bak-*`, zips. *(2026-08-17: classified and
      resolved — 0-byte root DBs + cache backup deleted, the rest committed or
      gitignored; both stale stashes verified superseded and dropped.)*
- [ ] Decide archive strategy: `git rm` + tag, or move to `attic/` (out of the
      default working set), or a separate archive repo. Nothing deleted without
      Matt's sign-off — some "stale" design docs are decision records.
- [ ] Prune stale design docs; keep decision records that still govern behavior
      (promote those into `docs/`).
- [ ] Consolidate DB files: one canonical prod DB (`data/league.db`), backups
      under a single `data/backups/` convention with a retention note.
      *(2026-08-17: root strays deleted + ignored; `data/league.db.bak-*`
      backup convention still ad hoc, retention note pending.)*
- [x] `.gitignore` pass so scratch artifacts stop landing in status.
      *(2026-08-17: root `*.db`/`*.sqlite`, `.env.bak*`, cache backups,
      `examples/`, cover-gen output, ML export dumps, design zips.)*
- [x] Uncommitted-changes triage: 10+ modified tracked files are sitting in the
      working tree from prior sessions (BACKLOG, CHANGELOG, CLAUDE.md, docs…).
      Commit, revert, or archive each deliberately. *(2026-08-17: all committed
      in 7 grouped commits, pushed at `a538ea5`; tree clean.)*

### WS2 — Digest inventory review
Know exactly what the digest IS before improving it.

- [ ] Catalog every section kind (podium, villain, flow, consensus, quotes,
      chat, storylines) + draft-level slots (stats/phrase card, guesser, next
      round): content schema, renderer component, which leagues use it, textual
      vs visual variants.
- [ ] Catalog per-league divergence: naming conventions (Mashew/Jorbo/missmara
      vs real names), section sets, tone, Guesser (SSSC-only), Regulars
      (Boarz + Fam Jam + 2B now), Coinage/phrase card.
- [ ] Map content_json schemas per kind (they drift: R127 podium had `rank`,
      R139 originally didn't).
- [ ] Inventory the hand-authoring affordances: YAML style shelf, `**bold**`
      body runs (added 2026-08-16), media slots, review-UI editing.

### WS3 — Digest process/workflow/pipeline documentation
Document the as-is pipeline end to end, including the human part.

- [ ] Trace: round close → auto-generation (LLM prompts, what data it's given)
      → draft rows → review UI → Claude punch-up session → approval (ntfy) →
      send. Name the code paths.
- [ ] Document the *informal* session protocol as practiced (this is the thing
      Matt re-invents weekly — see WS6.1 for its formalization).
- [ ] Document known operational gotchas already in memory: force-regen wipes
      edits; new section kinds need full regen or manual inserts; hydration
      crash vectors; production-build-only verification; per-league chat
      group mapping; identity narrow-space traps.

### WS4 — Archive inventory review *(parked)*
- [ ] What the archive contains per league, how it's keyed, what `buildArchive`
      filters on (known bug: filters `rounds.phase='complete'`, NULL for
      imported rounds — publishing would wipe archives).
- [ ] Inventory divergence between digest content and archived content.

### WS5 — Archive process/workflow/pipeline *(parked)*
- [ ] Document as-is archive update flow, including the manual steps.
- [ ] Identify what "automated archive updates" should mean: publish-on-approve?
      nightly? What must be fixed first (phase backfill) to make it safe.

### WS6 — Digest improvement *(top priority)*

**6.1 Formalize the Punch-Up Protocol.** Turn the improvised weekly session
into a versioned, per-league checklist the session (or eventually the pipeline)
executes. Draft shape:

1. **Rulecard load** — per-league voting rules stored as data, not re-typed
   weekly: vote budget, per-song cap, downvotes (existence + mandatory?),
   ballot-files-all-at-once, no-vote penalty, tiebreaker cascade, theme
   mechanics for the round. Lives in DB or `docs/league-rulecards/`.
2. **Facts pass (deterministic)** — recompute standings from `votes` with
   penalties + tiebreakers applied; diff every number/name/claim in the draft
   against ground truth; verify every quote verbatim against votes/submissions/
   chat; identity-resolution lint (unlinked senders, ambiguous names).
3. **Gold surfacing** — machine-surface candidates for the editorial pass:
   submission comments, 0-point-with-comment ballots, self-ballots, tiebreak
   dramas, chat-vs-ballot ironies, biggest word, coinage candidates, regulars
   triggers. Human picks; nothing auto-ships.
4. **Punch-up pass** — voice/tone per league; Matt's weekly notes (the "I
   noticed X" input) captured in a structured slot instead of chat prose.
5. **Balance + dedupe pass** — mention inventory (flag <2 mentions for active
   players), cross-section n-gram scan (one home per quote/fact, cross-
   references allowed).
6. **Render verification** — production-build headless pass: hydration errors,
   export mode, media loads, tied-rank safety.
7. **Chad-moment audit** — flag every evil-AI aside to Matt explicitly.

- [ ] Write the protocol doc + per-league rulecards (start: Fam Jam, Second
      Best, Boarz, SSSC).
- [ ] Package the deterministic parts as scripts (see WS8) so the session runs
      them instead of re-deriving SQL each week.
- [ ] Decide the delivery form: Claude Code skill (`/digest-punchup <round>`)
      vs. checklist doc the session follows. Recommendation: skill, with the
      rulecards as data it loads.

**6.2 Move fixes upstream into generation.**
- [ ] Feed the generator the rulecard + computed standings (with penalties/
      tiebreaks) so F1–F4 can't happen, instead of hoping the LLM infers them.
- [ ] Give the generator the verbatim-quote constraint + the gold-surfacing
      output as candidate material.
- [ ] Per-league voice notes (what "funny" means in each league) as prompt
      context, updated after each round's punch-up (what survived Matt's edits
      is signal).
- [ ] Regulars: seed files per league (bench pattern started:
      `design/sb-regulars-bench.md`), so regulars aren't re-mined from scratch.

**6.3 Tooling debt from this session**
- [ ] Single-section add/regen without nuking edits (F9).
- [ ] Identity linter surfaced in review UI (narrow-space normalization at
      ingest, not manual byte-fixing).
- [ ] The dedupe/mention/verify scripts from 2026-08-16 exist only as session
      one-offs — promote to `scripts/digest-qa/`.

### WS7 — Archive improvement *(parked until WS6 lands)*

### WS9 — Metrics & behavioral goals *(active — crude v1 shipped 2026-08-16)*

The digest isn't just entertainment: it nudges league behavior. First tracked
metric: **chat participation per round window**, plus the adjacent surfaces
(vote comments, submission comments).

- [x] `scripts/digest-qa/chat_participation.py` — per-round: messages, active
      chatters / roster, participation rate, vote-comment and sub-comment
      counts; per-player season table. Round window = previous voting_deadline
      → this voting_deadline; relay truncation dupes removed; senders resolved
      via player_identities.
- [x] Baselines captured: `docs/metrics/chat-participation-baseline-boarz.md`,
      `…-second-best.md` (2026-08-16). Boarz S10 runs 90–100% active; Second
      Best S11 climbed 67% → 67% → 83% → 85% across four rounds, with message
      volume 200 → 1,169 (Michael Black's arrival week).
- [ ] **Mention ledger**: extract per-player digest mentions per round (the
      inventory pass from R139, automated) and store them, so mentions become
      a time series alongside participation.
- [ ] **Nudge evaluation**: per player, join mention counts (round N digest)
      against chat msgs / vote comments / sub comments (round N+1 window) —
      the "we mentioned Philip more each week; did any of his three
      participation surfaces move?" question. Small-n, so treat as directional
      evidence, not stats.
- [ ] Fold the balance rule into generation guidance: minimum-mention floor
      for active players, rotating features for quiet ones (this week: BP,
      Philip, TJ features are the first deliberate nudge — watch their next
      two windows).
- [ ] Later candidates: submission-comment rate (2B's is already strong),
      voting timeliness (Jac/Ari class), new-member retention.

### WS10 — HiL loop via ntfy *(design agreed, trial next round)*

Formalize the human-in-the-loop step as a notification-driven review instead
of an open-ended chat session.

Flow per round:
1. Round-end email trigger fires (existing) → draft digest generated (existing).
2. **Story-ledes script** (new): non-interactive Claude (`claude -p`) reads the
   round's chat window, vote + submission comments, results (with rulecard
   applied), and **last round's bridge** → emits 5–8 candidate ledes/angles
   with one-line evidence each.
3. **Round bridge** (new artifact, generated at each digest's finalization):
   the final draft's main story elements + a concise per-section summary.
   Feeds the next round's lede generation and the season's continuity
   (callbacks, running bits, regulars triggers).
4. ntfy → Matt: "HiL review ready" → link to
   `digest.mattmariani.com/d/<digest>/hil` — a page that lists the ledes with
   a rating control each, plus one free-text box for unrelated
   direction ("Johanna keeps calling me Timmy").
5. Ratings + notes flow into the punch-up pass (WS6.1 steps 4–5), which runs
   with that structured input instead of live chat prose.

- [x] Bridge generator + storage — `scripts/digest-qa/generate_bridge.py`,
      `digest_bridges` table; R127/R139/R147 backfilled (2026-08-16).
- [x] Lede-generation script — `scripts/digest-qa/generate_ledes.py`,
      `digest_ledes` table; verbatim-evidence gate; ≥2 chat-sourced ledes;
      R139 trial run stored (2026-08-16).
- [x] HiL page — `/digest/<roundId>/hil` on bot-ui (love/keep/kill per lede +
      free-text box → `digest_ledes.ratings_json`); end-to-end smoke-tested
      (2026-08-16). Note: lives on the review app, not the static digest host.
- [ ] ntfy wiring: `generate_ledes.py --notify` implemented (default off);
      remaining: trigger the script from round-end automation and confirm the
      notification link. Trial: run manually when the next round closes.
- [ ] v1 scope note: one notification per round with all ledes on one page
      (chosen over one-topic-at-a-time to keep the loop to a single visit).

### WS8 — Pipeline/workflow improvements
- [ ] `scripts/digest-qa/` package: `verify_facts.py`, `dedupe_scan.py`,
      `mention_inventory.py`, `render_smoke.mjs`, `identity_lint.py` — each
      runnable standalone and from the punch-up skill.
- [ ] Wire facts-pass + render-smoke into generation itself (post-generate
      gate: a draft that fails verification is flagged in the review UI).
- [ ] **Model-vars pipeline integration**: the existing per-section pipeline
      (OpenRouter model + context selection per section kind, auto section
      refresh — `api/model-vars/sections`) predates the new features (style
      shelf, storylines, phrase card, chat superlatives, bold runs). Update it
      to cover the new section kinds, then make the punch-up protocol's
      deterministic stages (rulecard, computed standings, gold surfacing,
      verify) part of the context each section's model receives — so the
      pipeline is the repeatable home for what the sessions currently do by
      hand. End state: sessions handle taste, the pipeline handles truth.
- [ ] Structured "Matt's weekly notes" input (review UI field or a simple file)
      consumed by the punch-up pass.
- [ ] Punch-up session output → feedback loop: diff final vs. generated,
      append learnings to per-league voice notes.

---

## Sequencing

1. **Now:** WS6.1 protocol doc + rulecards (small, immediately useful next
   round) · WS8 promote existing QA scripts · WS9 mention ledger + nudge watch
   (baselines done) · WS10 HiL trial pieces (bridge, ledes, /hil page) ·
   WS2 inventory (feeds everything).
2. **Next:** WS3 as-is pipeline doc · WS6.2 generator grounding · WS6.3 tooling
   debt · WS1 sanitization in parallel slices.
3. **Later:** WS4/5/7 archive track, starting with the phase-backfill fix that
   makes archive publishing safe at all.

## Decision log

- 2026-08-16 · Archive track parked until digest track stable (Matt).
- 2026-08-16 · Digest is the app's top priority; quality work leads (Matt).
- 2026-08-16 · Weekly improvised session to be formalized into a refinable
  protocol rather than remaining ad hoc (Matt + Claude, this doc).
- 2026-08-16 · Deterministic stages eventually live in the model-vars
  pipeline; scripts + HiL protocol are the interim (Matt).
- 2026-08-16 · Primary behavioral metric: chat participation per round window;
  digest content deliberately nudges it (mention floors, quiet-player
  features). Baselines captured for Boarz S10 + Second Best S11 (Matt).
- 2026-08-16 · HiL trial: ntfy → /d/<digest>/hil lede-rating page + free-text
  box; round bridge artifact generated at finalization (Matt).

## Session-learnings inbox

Drop raw observations here after each punch-up session; fold into workstreams.

- 2026-08-16 (R139): true-tie cascade needed manual derivation; `~ Sarah`
  narrow-space identity trap; phrase-card media path works well for one-off
  photos; single-open accordion + shimmer improved section discoverability;
  benching a regulars card (Litigator) is a useful pressure valve.
