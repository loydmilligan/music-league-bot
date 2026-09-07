# Digest content inventory (2026-09-03)

Purpose: enumerate every content item that can appear in a digest, say how each one is
produced today, and propose a single YAML entity shape so all of them can be described
the same way. Inventory only — no code changes made.

Verified against: `ui/src/lib/digest/*`, `ui/src/routes/digest/[roundId]/+page.svelte`,
`scripts/digest-qa/*`, and the live `data/league.db` (`digest_sections`, `digest_drafts`,
`llm_calls`).

---

## 1. Two generation engines, not one

This is the single most important fact for the plan, and it is invisible from the UI.

| | **A — In-app (OpenRouter)** | **B — Headless Claude CLI** |
|---|---|---|
| Entry | `POST /api/digest/:id/draft` → `llm.ts:generateDraft` → `callOpenRouter` | `scripts/digest-qa/*.py` → `subprocess("claude -p")` |
| Runs where | `bot-ui` container | host (timer `mlb-hil-ledes`, `hil_autorun.py`) |
| Model | resolved: `settings[digest_model_<section>]` → `settings[digest_model]` → env → `anthropic/claude-sonnet-4-5` | **not pinned** — whatever `claude -p` defaults to |
| Params captured | temperature, top_p, max_tokens, seed, response_format → `llm_cost_log.params` | **none** |
| Cost captured | yes (`llm_cost_log`, rolled into `digest_drafts.llm_cost_usd`) | **no** |
| Prompt versioned | `DIGEST_PROMPT_VERSION = 'digest-v1'` | inline `PROMPT` string per script |

Evidence: the last `digest:*` row in `llm_calls` is **2026-08-06**. Every digest since
then was produced through engine B or by hand in a Claude Code session, so recent
content has no model, no params, and no cost on record. A homogenized YAML would have
to be filled in by the generator, whichever engine ran.

---

## 2. Inventory

`gen` legend: **LLM** = model writes the prose · **DET** = deterministic code from DB ·
**HUM** = hand-authored (usually in the YAML/inline editor, often with me in the loop) ·
**HYB** = deterministic data + written topline.

### 2a. The seven LLM sections (`digest_sections.kind`, CHECK-constrained)

| # | id | UI label | gen | storage | output shape |
|---|---|---|---|---|---|
| 1 | `podium` | A-side · final ranking | LLM | `digest_sections.content_json` | `{title, items[], body}` |
| 2 | `villain` | B-side · the downvote | LLM | ” | `{title, body}` |
| 3 | `flow` | Credits · notable votes | LLM | ” | `{title, body}` |
| 4 | `consensus` | Consensus & controversy | LLM | ” | `{title, items[]}` |
| 5 | `quotes` | Liner quotes | LLM | ” | `{title, items[{voter,quote}]}` |
| 6 | `chat` | Back cover · chat notes | LLM | ” | `{title, summary, moments[{label,detail}]}` |
| 7 | `storylines` | The Regulars | LLM | ” | `{title, cast[{name,headline,evidence[]}]}` |

All seven share **one prompt** (`buildSystemPrompt` + `buildUserPrompt` in `llm.ts`) and
are requested in a single JSON object; `pipeline.ts` decides how they are batched:

- `DEFAULT_PIPELINE.order` = quotes, consensus, podium, storylines, chat → **skip** →
  villain, flow. EP0 is factual/extractive; EP1 reads EP0's output as context.
- Adjacent same-model tracks merge into one `callOpenRouter` call.
- One **cover**: `flow` re-run on `anthropic/claude-sonnet-4-5` in a trailing EP for A/B.
- Per-section model pins: `settings[digest_model_<section>]`.

Shared inputs to that prompt (every section sees all of it — no per-section input scoping
exists today):

- round name/description, league name, round N-of-M
- **Cross-round record** (`data.bundle`) — the only sanctioned source of cross-round facts
- **Relationship context** (`rel_context`, LLM-generated, `archive:rel-context`, ~$0.19/call)
- all submissions w/ points + submitter comments; all votes w/ comments
- chat: `chatMentions`, or operator-pasted transcript, or auto-fetched window (`chatHistory`)
- storyline evidence seeds (only when `storylines` is active)
- editor notes (`round_notes`), general + per-section, wrapped as "true but NOT quotable"
- steer chips / free-text instructions on single-section regen

Observed models & cost (Aug 2026, per call): chat `opus-4.8` $0.234 (37.5k prompt tokens) ·
villain `gemini-3.5-flash` $0.087 · flow `deepseek-v4-pro` $0.014 · quotes `deepseek-v4-pro`
$0.020 · consensus/podium `minimax-m3` $0.010 each.

### 2b. Data sections (no LLM)

| # | id | UI label | gen | storage | source |
|---|---|---|---|---|---|
| 8 | `stats` | By the numbers | DET | computed + `digest_drafts.stats_content_json` | `roundInsights.ts` (audio profile, submission timing, artist landscape, word cloud) |
| 9 | `stats.phrase` | **The Coinage** | HUM | `stats_content_json.phrase` | hand-authored dictionary entry (term, pronunciation, definition, quotes, media) |
| 10 | `standings` | Season standings | DET | none (live query) | `StandingsChart.svelte` + season standings |
| 11 | `discoverability` | Tastemaker | DET | none (live query) | popularity proxy; **known to vanish silently** (see memory: popularity_proxy decay) |
| 12 | `nextRound` | Next round preview | DET | `digest_drafts.next_round_*` overrides | theme + deadlines |
| 13 | `guesser` | The Guesser | DET | `guesser_content_json` | `guesserInsights.ts` matcher; per-league opt-in (`guesser_section_leagues`), SSSC/Boarz only |
| 14 | `guesser.difficulty` | gimme marks / why | HUM | `guesser_content_json.difficulty` | hand-marked per track |
| 15 | `reel` | The Reel | HUM | `reel_content_json` | media-first weekly slideshow; currently `{}` everywhere |
| 16 | `wordCloud` | (inside stats) | DET | — | `wordCloud.ts` + `common-words.txt`/`long-words.txt` |
| 17 | `chatSuperlatives` | (inside chat) | DET | — | pure compute over the chat window |

### 2c. Cross-round memory artifacts (not rendered, but they steer generation)

| # | id | gen | engine | storage | note |
|---|---|---|---|---|---|
| 18 | `early-ledes` | LLM | A (in-container) | `digest_early_ledes` | provisional mid-round angles, pre-vote |
| 19 | `ledes` | LLM | **B** (`generate_ledes.py`) | `digest_ledes` | authoritative post-close: 5–8 candidate angles w/ verbatim evidence; rated on the HiL page |
| 20 | `bridge` | LLM | **B** (`generate_bridge.py`) | `digest_bridges` | the round's compact memory: headline stories, per-section summary, running bits, callbacks planted, verified quotes → consumed by the NEXT round's ledes |
| 21 | `archive_context` | DET | A | `digest_drafts.archive_context` | `{operatorSteer, roundDynamics}` — roundDynamics is literally the **first sentence of the flow body** |
| 22 | `rel_context` | LLM | A | `relationship_contexts` | league personality doc; most expensive single call in the system (~$0.19) |

**This is where the "summary for next gen" the YAML wants already half-exists** — as
`digest_bridges.content_json` (rich, per-section, verified) and `archive_context`
(one sentence, crude). They are not unified and only the bridge is actually good.

### 2d. Adjacent surface — the b-side archive (`ARCHIVE_TASK_KINDS`)

Not part of a round digest, but same machinery (`pipeline.ts` releaseKind `archive`,
no merge, one call per task) and the thing we edited by hand this week:

`narrative-player-superlatives` · `narrative-fan-hater-blurbs` · `narrative-league-reel` ·
`narrative-moment-lines` · `profile-spectrum` · `profile-playlist` · `season-update`

Observed: superlatives `sonnet-4.6` $0.009/call, playlist `opus-4.8` $0.020, spectrum
`gemini-3.5-flash` $0.014, fan/hater `minimax-m3` $0.0002.

---

## 3. Where the "text blocks" actually are

Ranked by how much undifferentiated prose they emit, i.e. the phase-out targets:

1. **`flow`** — 1–2 free paragraphs, no structure, most hallucination-prone, and its
   first sentence is silently reused as the archive's round summary.
2. **`villain`** — one paragraph of roast; nothing in the shape forces it to cite a number.
3. **`podium.body`** — a body blob alongside already-structured `items[]`.
4. **`chat.moments[].detail`** — 1–2 sentences per moment; better than the above because
   `label` + `detail` is already an entity split.
5. **`storylines.cast[].headline`** — already evidence-bound (`evidence[]` must come from
   the seeded quotes). This is the model to copy, not to phase out.

The structural pattern worth generalizing: **`storylines` is the only section whose prompt
is constrained to a curated evidence set, and it is the only one that has never fabricated
a quote.** (R153's fabricated Clements quote came from `quotes`/podium, which read the
whole ballot dump.)

---

## 4. Proposed uniform YAML entity

One file per content item, one top-level entity per item, same keys everywhere. Sketch
below is filled with real R153 values where they exist and `null` where we currently
capture nothing — the nulls are the point.

```yaml
chat:                                   # top-level entity == item id
  label: "Back cover · chat notes"
  surface: digest                       # digest | archive | memory
  status: active                        # active | opt-in | dormant
  generation: llm                       # llm | deterministic | human | hybrid
  engine: openrouter                    # openrouter | claude-cli | none

  input:
    sources:
      - id: chat_window
        kind: db
        query: chat_messages within (prev voting_deadline, this voting_deadline]
        scope: league
      - id: round_bundle
        kind: db
        note: cross-round record — only sanctioned source of cross-round facts
      - id: rel_context
        kind: artifact
        from: relationship_contexts
      - id: editor_notes
        kind: artifact
        from: round_notes
        contract: true-but-not-quotable
      - id: prior_bridge
        kind: artifact
        from: digest_bridges[round-1]    # NOT wired for the in-app path today
    evidence_bound: false                # true only for `storylines` today
    player_scope: all

  llm:
    prompt:
      system: llm.ts#buildSystemPrompt
      user: llm.ts#buildUserPrompt
      section_intent: SECTION_DESCRIPTIONS.chat
      version: digest-v1
    model: anthropic/claude-opus-4.8
    params:
      temperature: null                 # not set today
      max_tokens: null
      response_format: json_object
      seed: null
    batching:
      ep: 0
      merged_with: [quotes, consensus, podium, storylines]
      cover: null

  output:
    schema: '{title, summary, moments[{label, detail}]}'
    storage: digest_sections.content_json
    summary_for_next_gen: null          # today only `flow` feeds archive_context
    players: []                         # NOT captured anywhere — must be derived
    cost_usd: 0.234
    tokens: { prompt: 37513, completion: 1866 }
    regen_count: 0
    edited_by_human: true
```

Notes on the four fields you asked for that we do **not** have today:

- **`output.summary`** — only `flow` produces one, and only as a naive first-sentence
  slice. The bridge already does this properly for the whole draft; the per-item version
  should be a bridge fragment, not a new artifact.
- **`output.cost_usd`** — exists for engine A only. Engine B (every digest since Aug 6)
  logs nothing. Fixing this is a precondition for the YAML being honest.
- **`output.players`** — nothing anywhere records which players a section names. It is
  derivable (roster match over the rendered text, same matcher family as the Guesser) but
  it is not stored, so we cannot currently answer "who got mentioned this week" without
  re-scanning. `digest_mentions` exists and is the obvious home.
- **`input.evidence_bound`** — the storylines-style contract. Making this a first-class
  YAML field is what turns "phase out text blocks" from a copy exercise into a
  verifiable one: an item with `evidence_bound: true` can be checked by
  `verify_facts.py` mechanically.

---

## 5. Counts

- 7 LLM digest sections · 10 data/human digest items · 5 memory artifacts · 7 archive tasks = **29 content items**
- LLM-written: 12 · deterministic: 10 · hand-authored: 4 · hybrid: 3
- Items with a captured model + cost: **12 of 12 LLM items in engine A**, **0 in engine B**
- Items with an evidence contract: **1** (`storylines`)

---

## 6. Suggested next step (not started)

Capture-first, no refactor: write the 29 YAML files as *descriptions of what happens
today* (this doc is the raw material), then diff them. The three columns that come back
mostly `null` — `params`, `cost`, `players` — are the instrumentation backlog, and
`evidence_bound` is the content backlog.
