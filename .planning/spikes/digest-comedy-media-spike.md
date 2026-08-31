# Spike: Historical Digest Comedy / Media Lab

## Purpose

Before adding audio, video, bot commands, or interactive comedy features to the live Music League product, build a small historical-content spike to answer a simpler question:

> **When the system has access to real league history, votes, songs, chat, player behavior, and callback jokes, which generated formats are actually funny enough to deserve becoming product features?**

This is an experiment, not a production feature.

The spike should use existing historical Music League data wherever practical and produce sample artifacts from completed rounds. It should help us evaluate comedy quality, repeatability, specificity, feasibility, and AI-slop risk before we invest in integrations or automation.

---

## Product idea behind the spike

The long-term opportunity is not merely "put AI audio/video into a digest."

The stronger idea is to let each Music League develop a small recurring media universe built from its own history:

- player personalities
- musical habits
- recurring arguments
- old predictions
- voting behavior
- running insults
- repeated excuses
- disputed theme interpretations
- callbacks
- memorable incidents
- league-specific terminology
- strange chat rabbit holes

AI should mostly provide **format, transformation, retrieval, performance, and production value**.

The **league itself should provide the joke**.

Generic jokes about "Dave choosing a bad song" are weak.

A joke that recalls a specific Dave argument from six rounds earlier, then contrasts it with something Dave did this round, is potentially valuable because no generic comedy product could make it.

---

# Primary questions this spike should answer

1. Which content formats are genuinely funny with real historical league material?
2. Which formats remain funny after repeated use instead of working only as a novelty?
3. Does access to historical chat and old rounds materially improve the humor?
4. Can we identify good comic "incidents" before generating content?
5. Can the system recognize when there is **not** enough material to justify a bit?
6. Which ideas are cheap enough to generate routinely?
7. Which ideas feel like AI slop even when technically impressive?
8. Which concepts make meaningful use of the fact that this is a **music** league?
9. What source data is already available in this repository, and what is missing?
10. What minimal data/model abstractions would make future experiments easier without prematurely building a large framework?

---

# Non-goals

Do **not** turn this spike into a production implementation.

Unless needed solely for an isolated demo, do not:

- modify live WhatsApp behavior
- add production bot commands
- auto-post generated content
- change digest delivery
- create background jobs
- create a large generalized content-generation platform
- redesign the digest
- build a permanent voice-cloning system
- add a large new database schema
- require a new paid service just to run the text-only portion of the experiment
- refactor unrelated digest/chat code
- deploy anything

Prefer a disposable or easily removable spike with clear output.

---

# Repository context

At the time this brief was written, likely-relevant areas include:

- `src/digest/`
- `src/chat/`
- `src/bot/`
- `src/whatsapp/`
- `src/music/`
- `src/storage/`
- `design/`
- `docs/digest-sections.md`
- `design/digest-flavor.md`
- `design/digest-insights-sprint.md`
- `design/league-research-brief.md`
- `design/league-research-sample-data/`
- `design/second-best-player-dossier.md`
- `design/second-best-regulars-candidates.md`
- `design/sssc-regulars-candidates.md`
- `docs/league-research-handoff/`
- existing import scripts and test fixtures

These are hints, not assumptions.

**Inspect the repository first.**

Reuse existing round/chat/player/digest data paths where sensible rather than inventing parallel representations.

---

# Experimental strategy

## Phase 1 — inspect available historical material

Determine what historical information is already easy to access for completed rounds:

### Round data
- theme
- league/group
- season
- round number
- submission and voting dates
- songs
- submitters
- votes
- totals
- placements
- comments if available

### Chat data
- messages
- sender
- timestamp
- reply relationships if available
- quoted messages if available
- reactions if available
- links/media references if available

### Historical/player context
- prior submissions
- prior voting
- player tendencies
- prior digest observations
- recurring phrases
- existing dossiers / "regulars"
- previous jokes or named incidents
- known aliases/nicknames

Document what is actually available.

Do not pretend unavailable data exists.

---

# Phase 2 — select historical source material

Prefer **one especially rich historical incident first**.

The ideal first incident contains one or more of:

- a player contradicting something they said previously
- an argument about whether a song fits the theme
- a surprising or humiliating vote result
- a confident prediction proven wrong
- an absurd chat rabbit hole
- unusually strategic-looking voting
- a repeated artist / repeated behavior
- an obvious submission
- a very long or divisive song
- someone criticizing a behavior and later doing it
- a memorable old callback that can be revived
- a result whose comedy depends on Music League data rather than generic banter

If the repository makes it easy, select up to three distinct rounds:

1. controversy-heavy
2. personality/chat-heavy
3. music/data-heavy

But do not spend excessive effort finding a perfect dataset. One good incident is enough for the first pass.

---

# Phase 3 — create an Incident Sheet

Before writing comedy, extract candidate incidents.

Produce a Markdown or JSON artifact with entries roughly like:

```yaml
- id: incident-01
  title: "Example concise name"
  summary: "What actually happened"
  comedy_potential: high
  why_it_might_be_funny:
    - "specific reason"
  current_round_evidence:
    - "source references"
  historical_callback:
    - "older source reference"
  relevant_players:
    - "Player A"
  music_specific: true
  candidate_formats:
    - breaking_news
    - court
    - receipts
  risks:
    - "requires too much explanation"
```

The rating should be qualitative. Do not create fake precision.

The important thing is **evidence**.

---

# Phase 4 — format bake-off

Take the best single historical incident and express it in multiple short forms.

Generate text/script prototypes for approximately 8–10 of these:

## Strong initial candidates

### 1. Breaking News
A 10–20 second fake urgent news bulletin.

### 2. Court of Musical Appeals
A 20–35 second legal proceeding about theme compliance, voting misconduct, pandering, etc.

Possible offenses include:

- Theme Fraud
- First-Degree Pandering
- Strategic Voting
- Genre Evasion
- Obvious Pick
- Nostalgia Laundering
- Aggravated Runtime
- Failure to Read the Prompt

### 3. Previously On...
A 10–20 second callback that juxtaposes an old statement/event with the current outcome.

This is especially valuable when the punchline depends on archival retrieval.

### 4. Receipts
Find an older statement by the same player that makes the current statement/action funny.

Prefer real contradictions over invented ones.

### 5. Dramatic Reading
Turn an actual player message into an exaggerated performance script.

For the spike, text direction is enough; actual synthesized speech is optional.

### 6. Attack Ad
Treat a player's Music League behavior like a hostile political campaign ad.

### 7. Prestige Podcast / True Crime
Treat a microscopic league controversy with absurd seriousness.

### 8. Corporate Earnings Call
Treat player performance like a publicly traded company.

### 9. Official Correction / Public Statement
Institutional voice correcting or sanitizing something ridiculous.

### 10. Educational Film / Documentary
Explain some recurring league behavior as though teaching future generations.

---

# Phase 5 — music-specific experiments

At least one experiment must derive its premise from music, voting, submissions, or theme behavior rather than only chat personalities.

Candidates:

## Song Autopsy
Explain why a submission "died" using real attributes such as:

- length
- voting
- placement
- genre
- popularity
- theme fit
- submission timing
- player history

## Theme Violation Sting
A very short game-show-style script/jingle announcing a dubious theme fit.

## Player Scouting Report
Sports-analysis treatment of a player's musical tendencies.

Example source features:

- favorite decades
- repeated artists
- average song length
- obscurity/popularity
- genre concentration
- voting tendencies
- recent performance

## Who Submitted It?
Prototype an interactive guessing artifact using song metadata and player history.

## Who Voted For It?
Show a historical track and ask the reader to identify the player who awarded a notable vote.

## Theme Court
Present an old submission and allow a hypothetical `ON THEME` / `JAIL` judgment.

Do not build all of these. Create enough examples to learn which direction has promise.

---

# Phase 6 — memory experiment

This is a key test.

For at least one strong incident, generate two versions:

## Version A — local context only
Use only the current round / nearby chat.

## Version B — historical context
Allow relevant earlier rounds/chat/player history.

Compare whether Version B creates a materially better joke.

The hypothesis is:

> League-specific historical memory and callbacks create more durable humor than generic generation.

Do not assume this hypothesis is true. Test it.

---

# Phase 7 — specificity check

For each generated bit, classify its specificity:

### Level 0 — generic
Could apply to almost anybody.

Example:
> Dave submitted a bad song.

### Level 1 — league-specific
Uses a real Music League event.

Example:
> Dave submitted another seven-minute song.

### Level 2 — player-specific
Depends on a recognizable repeated behavior.

Example:
> Dave once again insists runtime should not count when interpreting the theme.

### Level 3 — deep lore
Depends on an older incident/callback.

Example:
> The six-minute ceiling established during the Round 2 Tool litigation has apparently been overturned.

Prefer Levels 2–3.

A technically impressive artifact that is only Level 0 is a weak result.

---

# Phase 8 — evaluate scripts before media generation

Do **not** begin by spending time generating polished video/audio.

First produce scripts.

A sample candidate record:

```yaml
format: breaking_news
incident: incident-01
source_facts:
  - "..."
callback:
  - "..."
script: |
  ...
estimated_duration_seconds: 16
specificity: 3
why_this_format_fits: "..."
```

Kill weak concepts at the script stage.

Only produce media for scripts that already work as jokes.

---

# Optional media prototype

After identifying the best scripts, optionally produce a very small number of actual media artifacts if credentials/tools already available locally make this easy.

Do not make external paid API setup a prerequisite for completing the spike.

## Audio

Good candidates:

- announcer read
- faux podcast
- player caricature dramatic reading
- court proceeding
- tiny jingle/sting
- fake radio call-in

Keep pieces roughly **5–30 seconds**.

If voice synthesis is attempted:

- prefer clearly comedic/caricature character voices
- avoid depending on a perfect impersonation
- preserve source attribution
- do not auto-publish
- keep the spike easy to run without voice APIs

## Video

Prefer lightweight edited compositions over elaborate generative video:

- still image + slow zoom
- player photo
- album art
- chat screenshot
- fake lower-third
- captions
- chart/stat
- sound effect
- narration
- fake news graphics
- courtroom sketch
- documentary title card

A deliberately simple 10-second fake-news clip is more useful to this experiment than a technically ambitious but cheesy AI movie.

---

# Player voice/persona experiment

If there is enough player information, create **comic performance directions** separately from actual voice cloning.

Example structure:

```yaml
player: Example Player
performance_direction:
  pace: "slow"
  tone: "wounded pedant"
  comic_trait: "sounds mildly offended that everyone else missed the distinction"
  avoid:
    - "generic cartoon voice"
    - "excessive screaming"
```

This allows the humor to come from a recognizable character treatment without requiring an exact vocal replica.

Keep the caricature playful rather than cruel.

---

# Comedy memory concept

Do not necessarily build a production database, but prototype a representation for durable callbacks.

Possible structure:

```yaml
players:
  - name: "Player"
    recurring_traits:
      - "..."
    musical_tendencies:
      - "..."

lore:
  - id: lore-001
    label: "The Spoon Incident"
    first_seen: "Season 2 Round 4"
    description: "..."
    players:
      - "..."
    evidence:
      - "..."
    strength: strong
    last_used_in_generated_bit: null
```

Useful properties might include:

- canonical label
- people involved
- source evidence
- first occurrence
- most recent recurrence
- whether it is still funny
- how recently it was used
- relevant themes/categories
- whether it is safe to reuse

The long-term generator should be able to revive **deep cuts**, not merely repeat the newest joke every week.

---

# Possible future bot transformations

These are **not** required implementations for this spike, but the historical examples should help evaluate them.

Possible reply commands:

```text
#dramaticreading
#receipts
#court
#eulogy
#attackad
#pressconference
#statement
#documentary
#meetingminutes
```

Possible context transforms:

```text
#headline <topic>
#breitbart <topic>
#dailykos <topic>
#highschoolpaper <topic>
#tmz <topic>
#nextdoor <topic>
#corporatepr <topic>
#secfiling <topic>
#cultpamphlet <topic>
#scripture <topic>
#academicpaper <topic>
#boardgamerules <topic>
#obituary <topic>
#conspiracy <topic>
#yelp <topic>
#linkedin <topic>
```

Potential special commands:

### `#canon`
Marks a league joke/incident as durable lore.

### `#receipts`
Searches history for something said/done by the same player that makes the current message funny.

### `#meetingminutes`
Summarizes a ridiculous chat rabbit hole as formal meeting minutes.

### `#translate`
Translates a recognizable player's rhetorical style into blunt/plain English.

These should remain ideas until the spike demonstrates that the underlying transformations are actually funny.

---

# Suggested spike outputs

Prefer a directory such as:

```text
.planning/spikes/digest-comedy-media/
├── README.md
├── source-audit.md
├── incidents.yaml
├── candidates/
│   ├── incident-01-breaking-news.md
│   ├── incident-01-court.md
│   ├── incident-01-receipts.md
│   ├── incident-01-attack-ad.md
│   └── ...
├── memory-comparison.md
├── music-specific.md
├── evaluation.html
└── findings.md
```

Adjust to the repository conventions if a better existing spike structure exists.

The output should be easy for a human to inspect.

---

# Lightweight evaluation page

If practical, create a static local HTML page presenting generated samples.

It does not need a backend.

For each candidate, show:

- format
- historical incident
- source facts
- script
- optional audio/video if generated
- estimated duration
- specificity level

Useful human evaluation controls:

- 😂 Actually funny
- 🙂 Amusing
- 😐 AI bullshit
- 💀 Never do this again

Also ask:

> Would this still be funny the fifth time?

- Yes
- Maybe
- No

And optionally:

> What made it work?

- callback
- player specificity
- real receipt
- musical data
- format
- performance
- surprise
- other

Persisting ratings is optional. A simple export/download or even in-memory page is acceptable for a spike.

---

# Quality rules

Generated comedy should generally:

1. Be short.
2. Start from something that actually happened.
3. Use concrete names/facts when appropriate.
4. Prefer callbacks and receipts over invented jokes.
5. Avoid explaining the joke.
6. Avoid generic "roast" language.
7. Avoid writing like a stand-up comedian.
8. Avoid excessive setup.
9. Avoid generic AI whimsy.
10. Stop before the bit wears out its welcome.
11. Preserve uncertainty when historical evidence is ambiguous.
12. Never fabricate a quote and present it as authentic.
13. Clearly distinguish exact historical text from invented parody dialogue.
14. Prefer one excellent premise over five mediocre jokes.
15. Be willing to output **NO BIT** when the material is weak.

---

# AI-slop warning signs

Treat these as negative signals:

- "In a shocking turn of events..."
- endless fake broadcaster filler
- random absurd adjectives
- generic insults detached from league history
- too many sound effects
- scripts longer than the joke
- fake quotes that could be mistaken for real quotes
- elaborate video whose only joke is that it exists
- every player speaking in the same sarcastic AI voice
- generic "chaos," "legendary," "savage," or "unhinged" language
- repeated reliance on the same format every round
- content that would work equally well if every player's name were replaced

---

# Success criteria

The spike succeeds if it gives us credible answers to:

- Which 2–4 formats deserve another experiment?
- Which formats should be abandoned?
- Did historical retrieval materially improve jokes?
- Did music/voting data yield comedy unavailable from chat alone?
- Can an incident-selection step filter out weak source material?
- Can output stay concise?
- What source data is missing?
- What would a minimally invasive next implementation look like?

The spike does **not** need to prove that every round can generate content.

A strong result may be:

> Only 20–40% of rounds contain material worthy of a generated media bit, but those bits are significantly better when selected rather than mandatory.

---

# Desired final findings document

End with a concise `findings.md` covering:

## What we tested

## Historical material used

## Best examples

## Weak examples

## What made the best ones funny

## What felt like AI slop

## Effect of historical memory

## Music-specific findings

## Formats worth continuing

## Formats not worth continuing

## Data/architecture discoveries

## Recommended next spike

Do not recommend production integration until the evidence warrants it.

---

# Claude Code execution prompt

Copy the prompt below into Claude Code from the repository root.

---

## PROMPT START

You are working in the `music-league-bot` repository.

Read this spike brief first:

`.planning/spikes/digest-comedy-media-spike.md`

Then inspect the repository before changing anything. In particular, examine existing digest, chat, storage, music, research, and historical-data paths and relevant design/docs. Pay attention to existing conventions in `.planning/spikes`, `design/`, `docs/`, `src/digest`, `src/chat`, `src/storage`, and historical fixtures/imports.

### Goal

Build an **isolated historical-content spike** that tests whether real Music League history can support short, genuinely funny recurring media/content formats for round digests.

This is NOT a production feature.

Do not wire anything into live WhatsApp behavior, automatic digest posting, deployment, schedules, or production jobs.

### Core approach

1. Audit what historical round/chat/player/voting data is already available.
2. Select one strong historical incident or round. If easy, use up to three contrasting rounds.
3. Extract an evidence-backed Incident Sheet before generating comedy.
4. Take the strongest incident and perform a format bake-off using roughly 8–10 short treatments.
5. Include at least:
   - Breaking News
   - Court of Musical Appeals
   - Previously On...
   - Receipts
   - Dramatic Reading
   - Attack Ad
   - one prestige/documentary/institutional format
   - at least one music-specific treatment
6. Keep scripts concise, generally targeting 5–35 seconds.
7. For at least one incident, compare:
   - current-round context only
   - historical context/callback-enabled version
8. Record specificity (generic / league-specific / player-specific / deep lore).
9. Prefer evidence and real callbacks over invented jokes.
10. Allow the system to conclude `NO BIT` when source material is weak.
11. Produce human-readable artifacts under an isolated spike directory.
12. If practical, make a simple static evaluation page for reviewing the samples.
13. Actual audio/video generation is OPTIONAL. Do it only if existing local tooling/config makes it straightforward. The text/script experiment must work without external paid APIs.
14. Do not over-engineer this. Favor scripts, small utilities, JSON/YAML/Markdown, and static HTML over a generalized framework.

### Important comedy principle

AI supplies format and production value.

**The league history supplies the joke.**

The most interesting examples should be impossible to produce without knowing these specific players, songs, votes, prior statements, and old incidents.

A clever generic roast is a failure compared with a concise, evidence-backed callback.

### Important safety/data-integrity rule

Do not fabricate historical quotes.

If reproducing a real message, preserve its source/reference.

If creating parody dialogue, label it clearly as generated parody rather than representing it as something the player actually said.

### First action

Before implementation, summarize:

- relevant existing architecture/data sources you found
- candidate historical rounds/incidents available
- your proposed minimal spike structure
- anything in the brief that should be adjusted because of the actual repository

Then proceed with the spike without waiting for approval unless you uncover a truly blocking issue.

### Desired outputs

Aim for something close to:

`.planning/spikes/digest-comedy-media/`

containing:

- `README.md`
- `source-audit.md`
- `incidents.yaml` or equivalent
- candidate scripts
- a historical-memory comparison
- at least one music-specific experiment
- optional `evaluation.html`
- `findings.md`

Use the repository's existing conventions where they are better.

### Scope discipline

Do not:

- build production bot commands
- change live posting behavior
- introduce broad refactors
- build a generalized agent framework
- spend most of the spike on UI polish
- generate large amounts of mediocre content
- force every candidate format to succeed

The best possible outcome is a **small, inspectable experiment that tells us what is actually funny and why**.

Read the full spike brief now and begin.

## PROMPT END

---

# Suggested way to run the experiment

After Claude completes the first spike, do **not** immediately ask it to implement the winners.

Review the examples manually first.

A useful second prompt would be:

> Read the generated spike artifacts and my evaluation/rating results. Identify the strongest comedy mechanisms rather than merely the highest-rated named formats. For example, determine whether the actual source of success was historical contradiction, player specificity, musical statistics, institutional framing, unexpected callback, or voice/performance. Propose the smallest second spike that tests those mechanisms across different historical rounds. Do not implement production features yet.

This prevents prematurely concluding that, for example, "courtroom bits are good" when the actual reason the example worked was that it contained a devastating old receipt.

---

# Likely next experiment if the first spike works

A second spike should test the winning mechanisms across multiple rounds and answer:

- Does the joke mechanism generalize?
- How often does suitable source material occur?
- Can incidents be ranked reliably before generation?
- How much historical context is enough?
- How should callbacks be stored/retrieved?
- Which media formats justify actual audio generation?
- Which transformations would make worthwhile interactive WhatsApp commands?

Only after that should we consider production architecture.
