# The round prep panel — design

Date: 2026-08-26 · Owner: Matt · Status: approved, ready for planning

Make the material a digest will be built from **visible before it is built**,
and give the editor a durable place to add colour that reaches generation.

Independent of the Rollout entity
(`2026-08-26-rollout-entity-design.md`). The two meet later: "draft early
ledes" can become a rollout cut, and notes flow into unattended generation
without change because of a decision made in §3.

---

## 1. Purpose

The digest page already answers "is the **data** ready?" It does not answer
"what **material** do we hold, and what do I want to add to it?"

That gap is not theoretical. On 2026-08-26 the R148 bridge row was found
missing — `generate_bridge.py 148` had never run — and nothing anywhere would
have shown it. `digest_bridges` is rendered by no surface at all. The gap would
have surfaced as `bridge=no` in a lede run at 06:30 on the day R149 closed, by
which time the fix is not available. The same silence applies to the
league-opt-in artifacts: R148 shipped without a Regulars section because
`boarz-ii-men` is not in `storylines_section_leagues`, and that was discovered
during punch-up, by hand.

Second purpose: notes. Today the only place to add editorial colour is the
per-section `context` textarea in `GenerateModal`, filled at the instant of
generation, from memory. A thing noticed in the chat on Tuesday has to survive
in the editor's head until Saturday.

### Success criteria

- Opening a round before it closes shows what material exists and what is
  missing, including the previous round's bridge.
- A missing conditional artifact (bridge, Regulars evidence, Guesser opt-in) is
  visible as missing rather than silently absent from the output.
- A note written mid-round reaches generation without the editor remembering
  anything at generation time.
- Notes reach generation when no human is present.

### Non-goals

- No change to the existing prep checks. They already work and stay above the
  new block.
- No replacement of the per-section `context` textarea. It serves a different
  job — see §3.
- No notes that carry across rounds. Cross-round continuity is the bridge's
  job and it already does it.
- No automatic early-lede generation. On demand only.

---

## 2. What already exists

Established by reading the code on 2026-08-26, and it is more than expected:

- **Readiness is built.** `ui/src/routes/digest/[roundId]/+page.svelte` has a
  `stage: 'prepare' | 'draft' | 'refine' | 'finalize'` union. With no draft, it
  renders `dg-prepare`: the `runPrepChecks` list (round metadata, submissions,
  votes, vote comments, chat-window mentions, chat, album art, YTM links,
  Tastemaker coverage, genre/mood, lyrics, audio insights), each with
  `{ name, ok, src, count?, optional? }`, headed by "✓ all checks passed ·
  ready to draft" or "! checks pending", plus a Re-run button hitting
  `POST /api/digest/:roundId/prepare`.
- **Per-section generation context is built.** `GenerateModal` collects
  `{ sections: [{ id, enabled, style, variant, context }], pastedChat }` and
  the draft endpoint injects it.
- **`callOpenRouter`** (`ui/src/lib/digest/llm.ts`) makes metered LLM calls
  from inside bot-ui with `jsonMode` and a model override. This is what makes
  §4 cheap.
- **Bridges are consumed backwards.** `generate_ledes.py` reads the
  **previous** round's bridge — round *N* reads *N−1*.

What does not exist: any rendering of `digest_bridges`, any inventory of
pre-generation material, any durable note, any early lede pass.

---

## 3. The prep panel

A second block on `stage === 'prepare'`, below the existing checks, in the same
visual language (name · status · source · count). Each row expands to a preview
and carries a notes affordance.

| Row | Status shows | Preview |
| --- | --- | --- |
| **Previous round's bridge** | present/absent for round *N−1*, with its `generated_at` | headline stories, running bits, planted callbacks, notable quotes |
| **Early lede sheet** | absent until drafted; "Draft early ledes" button | the angles with their evidence, and the editor's ratings |
| **Chat window** | message count in the round window, and which group it mapped to | recent messages, so a wrong window is visible |
| **The Regulars evidence** | league opted in or not; regulars with evidence | the evidence rows that would feed the `storylines` track |
| **The Guesser** | league opted in or not; guesses matched so far | the matched guesses |
| **Participation** | vectors present for the round | the targeting block — who is low or falling, and the raw material held |

The panel answers exactly one question: *what material exists to build this
round's digest from, and what do I want to add to it?* The prep checks above it
answer a different one and are not merged into it.

Rows conditional on league opt-in (Regulars, Guesser) must render an explicit
**"not enabled for this league"** state, distinct from "enabled but empty".
Conflating those two is the R148 failure.

---

## 4. Notes

### Storage

```
round_notes(
  id         TEXT PRIMARY KEY,
  round_id   INTEGER NOT NULL REFERENCES rounds(id),
  target     TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)
```

`target` is one of: `general`; a section kind (`podium`, `villain`, `flow`,
`consensus`, `quotes`, `chat`, `storylines`); or `ledes`.

Notes are per-round. They do not expire and do not carry forward.

### Writing them

Every panel row carries a notes affordance, and the row decides the note's
default target — so jotting is one action and routing is a second, optional
one (a dropdown on the note itself).

| Row written from | Default target | Why |
| --- | --- | --- |
| Previous round's bridge | `general` | Continuity colour belongs everywhere. |
| Early lede sheet | `ledes` | Steering for the angles. |
| Chat window | `chat` | A thing noticed in the chat belongs to the chat section. |
| The Regulars evidence | `storylines` | That row *is* the storylines track's input. |
| The Guesser | `general` | The Guesser is not a section kind; it is computed live and has no prompt of its own. |
| Participation | `general` | Targeting steers who gets named, which is a whole-digest concern. |

A note is never silently confined: `general` is the permissive default
wherever a row has no obvious single home.

### Reaching generation

**Injected server-side at generation, not prefilled into `GenerateModal`.**

This is the load-bearing decision. Once a league runs unattended under a
rollout, nobody opens the modal — so anything flowing only through the modal
would silently stop working the moment automation lands.

- `general` → appended to every section prompt **and** the lede prompt.
- section-targeted → that section's prompt only.
- `ledes` → the lede prompt only.

`GenerateModal` still displays them, as **read-only chips per section**
("3 notes will be included"), so the editor sees what is going before pressing
generate. Editing happens in the prep panel.

The existing per-section `context` textarea is unchanged and is **not**
replaced. Two different jobs: `context` is one-off steering typed in the
moment; a note is something observed days earlier. Conflating them loses one.

### The editorial envelope

A note is the editor's words going verbatim into a prompt, and a model will
treat them as source material — which means a note can come back phrased as
though it were said in the chat, and then `verify_facts` flags it as a
fabricated quote. **This feature manufactures the exact failure the QA gates
exist to catch unless the envelope is present.**

Every note is wrapped, in the prompt, as:

> Editorial direction from the human editor. Treat it as true, but it is not a
> quotable source: do not attribute it to anyone, and do not present it as
> something said in the chat or in a comment.

This wrapping is asserted by test on the built prompt string (§6).

---

## 5. The early lede sheet

### Engine

bot-ui has no `claude` CLI, so a naive port of the lede path would need a queue
and a host round-trip to serve a button press. It does not: `callOpenRouter`
already makes metered LLM calls in-container, and the early sheet uses it
synchronously, with its model resolved through the existing `modelFor('digest')`
cascade.

The two lede paths therefore use different engines — OpenRouter in-container
for the early sheet, `claude -p` on the host for the real run. That is
acceptable and arguably correct: the early sheet is explicitly the provisional,
low-authority artifact.

Rejected: enqueueing a request for the host poller (asynchronous button, new
queue, new failure mode, for a lower-stakes artifact than the one already
served synchronously by OpenRouter).

### Storage

```
digest_early_ledes(
  round_id     INTEGER PRIMARY KEY REFERENCES rounds(id),
  content_json TEXT NOT NULL,
  ratings_json TEXT,
  generated_at TEXT NOT NULL
)
```

Separate from `digest_ledes` on purpose: no collision with
`generate_ledes.py`'s "already has a row, use `--force`" guard, and the real
run can never clobber mid-round ratings.

### Trigger

**On demand only** — the "Draft early ledes" button, with a regenerate. No
schedule, no automatic firing. Each run costs one LLM call and the artifact is
only worth having when there is time to look at it.

Once the Rollout ships, a league that wants this automated can add a
"draft early ledes" cut to its rollout definition. That is configuration, not
new code, and is not part of this project.

### Inputs

Submissions, submission comments, the chat window so far, the previous round's
bridge, and any `ledes`- or `general`-targeted notes. **Not** votes or results —
they do not exist yet, and the prompt says so explicitly.

### Consumption at round close

`generate_ledes.py` gains one context block: the early sheet plus its ratings,
wrapped in a caveat stated plainly in the prompt:

> These angles were drafted mid-round, without votes, results, or the closing
> chat. They show what looked live early and which the editor liked. Treat them
> as steering, not as candidates to reproduce. The real evidence supersedes
> them.

The caveat is not merely UI copy; it is in the prompt, because the risk being
managed is the model over-weighting a provisional artifact.

---

## 6. Testing

The load-bearing tests are about **inputs reaching prompts correctly**, because
that is where this can silently do nothing or silently do harm.

- A `general` note appears in every section prompt and in the lede prompt.
- A `chat`-targeted note appears in the chat prompt and in no other.
- A `ledes` note never reaches any section prompt.
- The editorial envelope wraps every note — asserted against the built prompt
  string.
- Notes reach generation with `GenerateModal` never opened.
- Prep panel rows render correctly with no round data at all; specifically, a
  **missing previous-round bridge renders as absent, not as an empty preview**.
- A league not opted into Regulars/Guesser renders "not enabled", distinct from
  "enabled but empty".
- Early-lede generation writes `digest_early_ledes` and never touches
  `digest_ledes`.
- `generate_ledes.py` behaves unchanged when no early sheet exists (pytest).

---

## 7. Delivery

Smallest useful thing first:

1. **Prep panel with the bridge row.** Worth shipping alone: it renders
   `digest_bridges` for the first time and would have caught R148.
2. **The remaining panel rows** (chat window, Regulars, Guesser,
   participation).
3. **Notes** — table, panel affordance, server-side injection, envelope,
   modal chips.
4. **Early ledes** — the only piece needing new LLM plumbing, and the only one
   that touches `generate_ledes.py`.

Each step is independently useful and independently shippable.

---

## 8. Open questions

- **Preview rendering of the bridge.** `digest_bridges.content_json` holds
  `round`, `headline_stories`, `sections`, `running_bits`, `callbacks_planted`,
  `notable_quotes` (verified against R148). Whether the preview renders all six
  or collapses `sections` behind a toggle is a UI call to make while building.
- **Note ordering in a prompt.** With several notes on one section, whether
  they are concatenated newest-first or oldest-first is unresolved; oldest-first
  is the conservative default since it matches the order they were observed in.
- **Markdown in notes.** `boldRuns()` is applied only to a section's `body`, so
  markdown in a note would render literally anywhere it is echoed. Notes go to
  prompts rather than to the page, so this is probably moot — but the preview
  of a note in the panel should render as plain text to avoid implying
  otherwise.
