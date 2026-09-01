# Guess the Submitter — design

Date: 2026-08-31 · Owner: Matt · Status: approved, ready for planning

Matt has started guessing who submitted each song in Boarz, by hand, in his vote
comments. This makes that a first-class workflow, extends it to Second Best, and
scores it over time.

The container turned out to be larger than the feature. What is being built is a
**voting-phase workspace** — a tab on the active-round screen where the whole
voting sitting happens — and guess-the-submitter is its first module. `VotingLab`
was the unfinished first draft of that workspace, which is why it went unused: it
had the container and none of the content. It is absorbed here.

| | project | depends on |
|---|---|---|
| **A** | Guess spine — schema, lock states, scoring | — |
| **B** | Music League voting-page scraper (CLI + headless browser) | — |
| **C** | Workspace tab: gut → refine → comment → vote → output; absorbs VotingLab | A |
| **D** | AI analysis + per-player distribution | A, B |
| **E** | Scorecard digest section | A, + metadata backfill (§9) |
| **F** | Stylistic mimicry — write comments in Matt's voice | — (improves C, blocks nothing) |

Build order **A → C → B → D → E → F**. C lands early so guessing is possible in
Second Best within a round or two; E lands last, because a scorecard needs
accumulated data before it is worth reading.

**Explicitly staged, not built here** (§11): tracking how everyone votes during
the voting phase; predicting everyone's votes and scoring those predictions;
post-round review that updates a mental model of each player and the league.

---

## 1. Purpose

Three things, in priority order:

1. **Make the guessing workflow real.** Today it is Matt typing a name into a
   Music League comment box from memory. It should be a structured process with
   research, candidate elimination, and a record of what was decided and why.
2. **Measure whether the process beats instinct.** A gut pick is captured and
   locked *before* any AI analysis runs, so "did the research help?" is a
   measurable question rather than a feeling.
3. **Score it over time** — per person, per genre, per decade, and against
   whether the submitter's comment was visible.

Non-goals: winning the league, changing how votes are cast, or automating the
guess. The AI advises; Matt decides and Matt types.

## 2. The public record is canonical

The guess that counts is **the one in the posted Music League comment**, because
that is what the league sees. Everything in this system is private working state
that must stay synchronized with that public record.

This produces a two-step reconciliation:

- **Attest** — after submitting in Music League, Matt presses *Confirm submitted*
  (§7.7). The stored slate is marked as claimed-sent.
- **Verify** — when the round's votes import back from Music League, the stored
  comment is compared to the imported one. A mismatch is a **sync error** on the
  round, surfaced for correction. It is never silently reconciled, and the
  imported text always wins.

The gut → refine chain has no public counterpart and is private analytics only.

## 3. Vocabulary

| term | meaning |
|---|---|
| **Gut pick** | First-instinct submitter for a song, committed before any AI runs |
| **Candidate** | A player Matt has pencilled in as possible for a song |
| **Possible** | Candidate state 1 — a pencil mark, no visual effect elsewhere |
| **Prime Suspect** | Candidate state 2 — advisory. Dims that player on all *other* songs. Freely reversible |
| **Locked** | Candidate state 3 — hard. Removes that player from every other song and opens comment work for this one. Unlocking is an explicit action |
| **Slate** | The full set of locked picks + comments for a round |
| **Sync error** | Stored comment disagrees with the comment imported from Music League |

Prime Suspect **dims**; Locked **removes**. The distinction is the whole point:
dimming supports reasoning, removal asserts a decision.

## 3b. The six projects (added 2026-08-31)

The letters are used throughout this document but were never listed in one place,
and **C was never labelled at all**. For the record:

| | Project | Covers | Status |
|---|---|---|---|
| **A** | Guess spine | §5 anonymity, §6 assignment, §7.1 gut, §8 data model, §14 storage half | **Shipped 2026-08-31** — 11 commits, 54 tests |
| **C** | The workspace | §4 placement, §7.4 refine grid, §7.5 comment shell, §7.6 vote, §7.7 output, and §14.3/14.5/14.6 (the rehearsal replay behaviour) | Next |
| **B** | Comment fetch | §7.2 — headless scrape of the ML voting page | Speced |
| **D** | AI analysis | §7.3 — writes `guess_ai_distribution` / `guess_ai_song` | Speced |
| **E** | Scorecard | §9, plus §12's no-data case | Speced |
| **F** | Voice drafting | §7.5's "Draft with AI" in Matt's voice | Speced |

Build order is **A → C → B → D → E → F**. C precedes B and D because both feed a
workspace that must exist to receive them, and because §7.4 — the grid — is the
part of this tool that carries the reasoning. Rehearsal mode (§14) is only half
built until C lands: A stores the mode, C enforces the horizon.

## 4. Placement

A tab on the active-round screen, beside ML playlist, chat songs, chat history,
research, and head-to-head. Not a separate route.

The tab is **disabled until the round's playlist exists**. The `voting_started`
round event already fires on the notification email — the same signal the YTM
drop consumes — so this is wiring, not new detection. On that event the round's
songs are loaded via `ingestPlaylist`, and the tab enables.

`VotingLab.svelte` and `VotingLabSongRow.svelte` are superseded. Their embeds on
the home page (`ui/src/routes/+page.svelte:215`) and the round page
(`.../round/[roundId]/+page.svelte:394`) are removed. **The tables are kept** —
`voting_lab_ballot` and `voting_lab_budget` become the workspace's ballot
storage, with all existing rows intact.

### 4a. Amendment (2026-08-31, Matt's call) — which embeds actually go

§4 above says both `VotingLab` embeds are removed. That is now **half right**, and the
difference matters enough to record rather than leave the plan to rediscover.

**The round-page embed goes.** It is currently mounted unconditionally above the tab strip on
every round page regardless of phase, and Matt does not want it always present. It moves into
the workspace tab as the vote phase (§7.6).

**The home-page embed stays.** It is not a duplicate of the round-page one: it is an
`{#each votingLeagues}` loop rendering one Voting Lab per currently-voting league, each in its
own collapsible panel — a cross-league "vote everywhere from one screen" surface. The
workspace tab is per-round on a round page and cannot replace it, and nothing else in the app
offers that view. Removing it would delete a real workflow with no substitute.

**`is_mine` is a hard blocker on the transplant.** `VotingLabSongRow`'s "mine / not mine"
toggle is the **only** code path in the entire repo that can set `voting_lab_ballot.is_mine = 1`
— verified by searching both `ui/` and the bot side. `startRehearsal` touches the same table
but structurally cannot set it (`INSERT OR IGNORE`, always 0, by §14.4's design).

Without a marked own-song, the gut slate is **unsatisfiable**: a round with no ballot rows
excludes nothing, so there are more songs than eligible players and each player may be used at
most once (§6). This is not theoretical — Boarz R148 has 10 songs and 9 eligible players today.

So the round-page embed must not be removed until the toggle exists inside the tab. Matt
confirmed: "yes we need is mine".

**Also not built, and needed if §7.6 is taken literally:** the vote-comment lock ("lock
separately from guess comments"). Nothing in the current component locks anything — that is
new construction, not a transplant.

## 5. Anonymity is structural, not enforced

During live voting there is nothing to leak: upcoming rounds have **zero**
`ml_submissions` rows. Songs arrive via `ingestPlaylist`, which inserts
**anonymous rows with `competitor_id NULL`**, keyed idempotently on
`(round_id, spotify_uri)`. Submitter identity only lands later, on completed-round
export.

So live, anonymity is a property of the architecture rather than of a filter
someone has to remember.

The exception is **backtesting** against historical rounds, where the answer *is*
present in the same table. There, the AI context builder (§8) selects against an
explicit column allowlist that excludes `player_id` and `competitor_id`, with a
test that fails if submitter identity is reachable from the context payload.

## 6. Assignment rules

Two rules, and the first is a correction to the original framing:

> **Every song must have exactly one guess. Each player may be used at most once.**

The natural phrasing — "each person assigned to exactly one song" — deadlocks
whenever someone skips a round, which happened in 2 of the last 10 rounds:

| league | round | songs | roster | gap |
|---|---|---|---|---|
| Boarz | I Heard It Through the Napster | 9 | 10 | 1 |
| Second Best | I Liked Them Before… | 12 | 13 | 1 |

Ten players cannot be placed one-each into nine songs. Songs are what must all be
filled; players are a constrained resource that may be left over.

> **Matt's own song and Matt himself are excluded from the pool.**

`voting_lab_ballot.is_mine` already models this. Marking his own song drops both
it and him from the grid, which is what makes the assignment balance at all — 10
songs / 10 players becomes 9 unknowns / 9 candidates. It also delivers "no credit
for identifying my own submission" for free: the song never enters scoring.

During editing, duplicate assignments are permitted and shown as a conflict. The
gate is evaluated at submit.

## 7. The seven phases

### 7.1 Gut

Songs in playlist order. Each row has vote +/− controls and one submitter select.

**The vote controls are rendered but inert in this phase** — present so the layout
is stable, deliberately non-functional. A gut *vote* may be added later; it is not
in scope.

Gate: every song has a pick, and §6 holds. Submitting **locks the gut slate**:
`gut_pick` becomes immutable and `gut_locked_at` is stamped.

The gate is a hard wall across the whole round, not per song. Per-song gating was
considered and rejected: by song five the AI's read on the roster has been
absorbed, contaminating later "gut" picks in a way the numbers cannot show. A
number that is quietly wrong is worse than friction.

Every song requires a gut pick — there is no skip. The submit control stays
disabled until the full slate is assigned. A partial gut pass was considered
(skipped songs excluded from the gut-vs-refined comparison rather than forced into
a coin flip) and is recorded as open question 5 rather than built.

### 7.2 Fetch submitter comments

Project **B**. Comments visible to voters are the single richest guessing signal,
and they are unreachable programmatically until votes land — the CLI's mapped
`/-/results` endpoint is post-voting only. There is no mapped endpoint for the
voting page itself.

So: a new CLI capability that logs into Music League with Matt's session, drives a
headless browser to the round's voting page, and parses the per-song submitter
comments. Runs **before** §7.3 and its output is an input to it. Failure is
non-fatal — the AI proceeds with a recorded note that comments were unavailable,
because a stale or failed scrape must not block the sitting.

Requires extending `musicleague/MUSICLEAGUE.md` with the voting-page route and its
parse recipe.

### 7.3 AI analysis

Project **D**. Per song, over every eligible player:

- a **percentage likelihood**, summing to 100 across the song
- **reasoning** for that player's number
- **factors** — the evidence considered

Plus a per-song headline AI pick and certainty.

Inputs: submitter comments (§7.2), submission history, musical taste,
voting/downvoting patterns, chat history. Never submitter identity (§5).

Volume is modest — 9–12 calls per round returning a 10–13 row distribution:

| league | roster | songs/round | cells/round |
|---|---|---|---|
| Boarz | 10 | 9 | ~90 |
| Second Best | 13 | 12 | ~156 |

Explaining why the eleventh-most-likely player sits at 2% produces filler. The top
few get real reasoning; the tail is bucketed.

### 7.4 Refine — the sudoku grid

The heart of the tool, and the piece that gets a Claude Design brief.

Per song, **not a select**. A typeahead pill input over the roster; each named
player becomes a **row** carrying:

- **factors** for that person
- a **certainty slider**
- **notes**, freeform
- a state control: Possible → Prime Suspect → Locked

Prime Suspect dims that player across every other song. Locked removes them
outright and opens comment work for that song.

The reasoning this supports is the point: with 2–3 plausible songs per player,
elimination across the grid resolves assignments that no single song resolves
alone. Candidate state therefore lives in `guess_candidates` and is queried, not
held client-side — the grid survives a refresh or a closed laptop mid-round.

### 7.4a Amendment (2026-09-01) — the settled design

§7.4 above describes the *intent*. A Claude Design pass settled the actual surface
with Matt on 2026-09-01. Handoff packet: `docs/design_handoff_refine_grid/`
(`README.md` is the build target, `DECISIONS.md` the D1–D6 log, `TOKEN-MAP.md`
the element→token map). Where this amendment and §7.4 differ, this wins.

**The six settled decisions:**

- **State control** — a mono chip that shows the **current** state and is itself the
  click target. Glyph + label + rail weight carry it without color (`○ possible`,
  `◐ prime`, `● locked`; locked thickens the rail to 3px). Cycles and **wraps**.
- **Candidate picker** — an **always-visible roster strip** of click-to-add pills,
  **overriding §7.4's "typeahead pill input"**. Nine local names don't warrant a
  keystroke and a context switch per add, and a typeahead hides availability until
  after you choose. The strip *is* the availability display. Above ~12 names, add a
  filter box; never remote search.
- **Availability** — `dimmed` and `taken` are separated by **three independent
  signals** (rail style, a typed tag naming *where* the player is committed, and
  strike-through), with opacity only reinforcing. Advisory and hard must never read
  the same.
- **Density** — summary at rest (one line), editor **expands in place** on click.
  No modal, no navigation, scroll kept.
- **Conflicts** — one mono roll-up line in the gut phase's register, plus a quiet
  inline marker on **both** sides of a duplicate. Informative, never blocking:
  duplicates stay legal while editing and are gated only at submit (§6).
- **Ledger** — a sticky 244px side rail listing every player's availability, which
  also makes the songs-vs-players supply count legible.

**The §13 unknowns, resolved:** the gut pick **is** shown, as a non-editable mono
marker (Matt weighed the anchoring risk and chose it); `factors` stays **free text**;
there is **no** distinct "skip" state (empty means not-yet); refine **replaces** the
gut slate in the tab rather than appearing below it; rows sort by status
(locked → prime → possible) then certainty descending.

**Project D reserves space now.** Each resting row carries an inert, hairline-
separated slot and the editor a labelled reserved box, so §7.3's likelihood lands
as a second mono value without a reflow. Matt asked for the space to be held.

**Corrections to the handoff packet, found against the code before planning:**

1. **`phase === 'refine'` is unreachable.** Nothing in the repo writes that phase —
   `lockGut` sets `'fetch'` and there is no other writer, exactly as with the vote
   layer. The refine board is therefore gated on
   **`gutLockedAt !== null || phase === 'refine'`**: locking the gut slate is a real,
   reachable event and is precisely when refining should begin, and the phase arm
   keeps working once the intermediate machine exists. Same shape as §7.6's gate.
2. **The packet misstates `Candidate`.** It documents `{ songId, playerId, … }`.
   There is no `songId`: the shipped type is
   `{ playerId, status, certainty, factors, notes }` and rows are keyed
   `(round_id, spotify_uri, player_id)`. Songs are identified by Spotify URI
   throughout this feature.
3. **`WorkspaceData` carries neither candidates nor availability.** The underlying
   functions are shipped and tested, but the payload the component receives does not
   expose them — extending it is real work the packet does not account for.
4. `--dur-fast` / `--dur-base` do **not** exist in `app.css`, despite TOKEN-MAP's
   "no new token is required". The ~700ms propagation flash is a bespoke keyframe
   and any duration constants are local to the component.
5. `--font-body` does not exist; the token is `--font-sans`.

### 7.5 Comment

Opens per song once that song has a locked pick.

- **comment** box — what will be posted
- **comment notes** box — steering, not published
- **Draft with AI** — weighted heavily toward the notes, informed by the AI's
  analysis, and written in Matt's voice (project **F**; until F lands, the
  existing `voiceSample.ts` / `votingTake.ts` path does a simpler job)

Backup pick, its explanation, factors, and confidence are also editable here.
**Everything is required except the backup pick and its explanation.**

All songs complete → the **slate locks**.

### 7.6 Vote

The transplanted VotingLab: points against `voting_lab_budget`, save and resume,
per-song up/down.

Vote comments are **optional**, live in their own box, are AI-draftable, and lock
**separately** from guess comments.

Voting is not a hard gate on §7.7, but attempting to proceed with incomplete
**votes** (not vote comments) raises a warning.

### 7.7 Output

A drawer or modal. Every song in **playlist order**, showing vote total and a
single assembled comment per song:

```
<vote comment>        (if present)
<guess comment>
```

Vote first, then guess, sequentially. A **copy button** per song. Points are shown
**read-only** — by this stage the decisions are made, and this screen exists to be
copied out of while Music League sits in the other half of a split screen.

Ends with **Confirm submitted**, which stamps the attestation of §2.

## 8. Data model

Approach: guess tables **alongside** the ballot, not merged into it. Voting is
universal across rounds; guessing is opt-in per league — the same split that
already exists between VotingLab and The Guesser.

```
voting_lab_ballot     (existing, unchanged)
                      round_id, spotify_uri, up_points, down_points, rating,
                      notes, draft_comment ← the VOTE comment, is_mine, updated_at

voting_lab_budget     (existing, unchanged)

guess_round_state     round_id PK
                      phase, gut_locked_at, slate_locked_at, votes_locked_at,
                      submitted_at, sync_state, comments_fetched_at

guess_picks           (round_id, spotify_uri) PK
                      gut_pick_player_id,
                      final_pick_player_id, confidence,
                      second_pick_player_id, explanation, second_explanation,
                      comment ← the GUESS comment, comment_notes,
                      locked_at

guess_candidates      (round_id, spotify_uri, player_id) PK
                      status ('possible'|'prime'|'locked'),
                      certainty, factors, notes, updated_at

guess_ai_distribution (round_id, spotify_uri, player_id) PK
                      pct, reasoning, generated_at
                      + per-song ai_pick / ai_certainty / ai_factors
```

`draft_comment` already exists on `voting_lab_ballot` and already held the vote
comment in VotingLab, so the two comment types separate cleanly with no new
column and no migration of meaning.

**Scoring is derived, never stored.** Accuracy is computed by joining to
`ml_submissions` once the round reveals — the same live-computed pattern The
Guesser uses. A re-import therefore cannot leave a stale scoreline behind, which
matters because zip re-imports are routine here.

## 9. Scorecard (project E)

Rides the deterministic-section pattern, **not** a `digest_sections` row:
`digest_sections.kind` is CHECK-constrained to seven kinds, and The Guesser
already sidesteps this with dedicated `digest_drafts.guesser_*` columns plus a
per-league opt-in setting. This follows that precedent exactly.

Four requested cuts. **Two have data; two do not:**

| cut | coverage | status |
|---|---|---|
| per person | full | ready |
| visible comments | `visible_to_voters` — 757 yes / 414 no; 585 have text | ready, and a better signal than expected |
| **genre** | **270 / 1171 (23%)** | **blocked** |
| **decade** | **38 / 1171 (3%)** | **blocked** |

Genre exists only as `song_popularity.tags`, free-text Last.fm slop mixing genre,
decade, artist name and noise in one array:
`["classic rock","70s","rock","steve miller band","oldies"]`. Decade is worse —
`ml_submissions` has **no year column at all**.

Both need a **metadata backfill** before E: Spotify album release date for decade,
and a normalization pass mapping tags onto a controlled genre vocabulary. That
backfill is a prerequisite of E, not of A–D. E should ship with per-person and
comment-visibility cuts and add the other two when the data exists, rather than
holding the whole section hostage.

Also reported: gut vs refined accuracy, calibration (do high-confidence guesses
land more often?), and top-1 accuracy over time.

Expect the section to be thin at first — guessing began two rounds ago in Boarz
and has not started in Second Best. It must read well with almost no data.

## 10. Reuse

Nothing below is rebuilt.

| component | reused for |
|---|---|
| `guessResolver.ts` — `buildGuessMatcher()`, despaced word-runs, edit-distance-1, alias-aware | Parsing posted comments back into player ids for §2 verification and scoring |
| `ingestPlaylist()` — anonymous rows, idempotent | Loading an in-flight round's songs (§4, §5) |
| `voting_lab_ballot` / `voting_lab_budget` | Points, budget, vote comment (§7.6) |
| `voiceSample.ts`, `votingTake.ts` | Comment drafting until F lands (§7.5) |
| The Guesser's `digest_drafts` column pattern + per-league opt-in | The scorecard section (§9) |
| `voting_started` round event | Enabling the tab (§4) |

## 11. Staged, not built

Named because the architecture should not preclude them, and **not** designed:

1. Track how everyone is voting during the voting phase.
2. Predict everyone's votes; confirm at close; score predictions.
3. Post-round review that updates the mental model of each player, the league, and
   standings, feeding future strategy.

Item 2 is structurally the same machine as this project — *predict → lock →
reveal → score*. That similarity is deliberately **not** abstracted now. A generic
predictions spine built for one consumer will be the wrong shape when the second
arrives. When it does, it gets its own tables beside these, and only then is there
enough evidence to factor out what is genuinely shared.

## 12. Testing

- **Assignment rules** (§6) — a round with a missing submitter must still reach a
  submittable state; duplicates blocked at the gate, permitted while editing;
  Matt's own song excluded from pool and from scoring.
- **Gut immutability** — `gut_pick` cannot change after `gut_locked_at`.
- **Anonymity** (§5) — a test asserting submitter identity is unreachable from the
  AI context payload on the backtest path. This is the one that must not rot.
- **Candidate state machine** — Prime Suspect dims without mutating other rows;
  Locked removes; unlock restores.
- **Sync verification** (§2) — imported comment differing from stored comment
  raises a sync error and does not overwrite silently.
- **Scoring** — derived accuracy against a seeded revealed round, including
  gut-vs-refined with skipped gut songs correctly excluded.
- **Scorecard with almost no data** — renders sensibly at one round.

## 14. Rehearsal mode (added 2026-08-31, after A was planned)

Run the whole workflow against an **already-completed round**, with the app behaving
as if it were live in that round's voting phase. Boarz 148 and 149 are the intended
first subjects: 10 submissions each, all revealed, and Matt's real hand-written
guesses already sit in `votes` where `guessResolver` can parse them.

### 14.1 Why it is nearly free

§5 already forbids every live-phase module from reading `ml_submissions.competitor_id`,
and Task 5's guard test fails the build if one does. The guessing layer is therefore
*structurally* incapable of seeing the answer, whether the round closed yesterday or
has not opened. Replaying a completed round needs no scrubbing in that layer. What is
not free is the evidence horizon (§14.3).

### 14.2 State

Two columns on `guess_round_state`:

- `mode TEXT NOT NULL DEFAULT 'live' CHECK (mode IN ('live','rehearsal'))`
- `as_of TEXT` — the effective "now" for a rehearsal; NULL when live.

### 14.3 The horizon, and the trap in it

Clamping evidence by `timestamp < as_of` alone is **wrong**, and the mistake is easy
to make. `as_of` is naturally the round's voting deadline, but every vote on that
round was cast *before* its deadline — so a naive timestamp clamp leaks the whole
round's votes and vote comments, which are the answer in all but name.

The correct rule is stated per source, not as one comparison:

- **The round being rehearsed:** submissions visible, filtered to
  `visible_to_voters = 1`. Votes, vote comments, results and submitter identity are
  hidden entirely, regardless of timestamp.
- **Other rounds:** visible only if strictly prior — same league, `voting_deadline <`
  the rehearsed round's `voting_deadline`. Fully visible, including identities.
- **Chat:** messages with `ts < as_of`.

The `visible_to_voters` filter is load-bearing, not a nicety. In both 148 and 149 only
**5 of 10** submission comments were visible during voting. Showing all ten makes the
rehearsal easier than the real thing was and inflates the score.

### 14.4 Marking your own song

Rehearsal does **not** pre-seed `voting_lab_ballot.is_mine` from the answer key.
Matt marks his own song exactly as he does live — same gesture, same code path, no
special case. Rehearsal start only creates the round's ballot rows with `is_mine = 0`
when they are absent (rounds 148 and 149 have no `voting_lab_ballot` rows at all), so
there is something to toggle. This also keeps the answer key out of setup entirely.

### 14.5 Fetch phase is skipped

§7.2's CLI comment fetch is unnecessary — submission comments are already in
`ml_submissions.comment`. Rehearsal goes straight from gut to AI, subject to §14.3's
visibility filter.

### 14.6 Sync is deferred to reveal

§2's sync check reads Matt's own posted comment, which names his prior conclusion.
That is not a leak of the answer, but it contaminates the experiment. `verifyRoundSync`
must not run while `mode = 'rehearsal'` and the round is unrevealed; it runs at reveal,
where it becomes the interesting output: what the tool made him guess versus what he
guessed by hand, on the same songs.

### 14.7 Archiving, and why the scorecard stays clean

A rehearsal run ends by being **archived**: every `guess_*` row for the round is
serialized to a JSON file under `data/rehearsals/`, then deleted, and the state row
with it. The round returns to having no guessing data at all.

This is deliberately structural rather than a filter. Matt half-remembers these
rounds — he lived them — so rehearsal scores must never pool with live scores in §9's
scorecard. Deleting the rows means no query anywhere has to remember to exclude them,
and re-running a rehearsal is just archiving and starting again.

It also answers open question 2: rehearsal supersedes backfilling the two existing
Boarz rounds, and produces a richer artifact than a backfill would.

## 13. Open questions

1. **Which leagues opt in?** Boarz and Second Best are stated. SSSC already runs
   The Guesser for Dogsweat — do the two coexist in one league?
2. **Backfill Matt's existing Boarz guesses?** Two rounds of hand-written guesses
   already exist in vote comments and `guessResolver` can parse them. They would
   have no gut pick and no candidate grid — countable for accuracy, not for
   gut-vs-refined.
3. **Scale for confidence** — named levels or a numeric slider, and does the
   per-song headline confidence share a scale with the per-candidate slider?
4. **Genre vocabulary** — what controlled list do Last.fm tags normalize onto,
   and who arbitrates disagreement.
5. **Partial gut pass?** Currently every song requires a gut pick (§7.1). Allowing
   skips would keep no-instinct songs out of the gut baseline instead of forcing a
   coin flip that understates it — at the cost of a smaller comparison set. Decide
   before A is planned; it is one nullable column either way.
6. **Round-over-round candidate memory.** A player used in round N is a fresh
   candidate in round N+1, but Matt's reasoning often carries across rounds
   ("Steiny never comments"). Nothing currently persists that between rounds.
