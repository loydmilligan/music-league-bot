# Changelog

All notable changes to the Music League Bot webapp are documented here.
Format loosely follows [Keep a Changelog](https://keepachangelog.com/);
versions track `ui/package.json` and render in the app footer (`mash co. · vX.Y.Z`).

> **Unreleased.** Everything from here down to v1.13.0 shipped after that release
> but has no version of its own — `ui/package.json` is still `1.13.0`, so these
> sections are grouped by date and work-stream rather than by release. Sprint
> numbering also stopped after sprint-46, so entries cite the work-stream, task
> or phase name the commits themselves use.

## 2026-08-27 → 2026-08-30 — The Boarz Tape and the YTM drop

**A season site of its own, and the playlist finally reaches YouTube Music.**
The b-side site got a compact redesign and four new sections; separately, the
long-standing "YTM listeners are left out of the weekly playlist" gap closed —
not in the digest, but as an automatic post into the group chat.

### Visible (UI)

- **The Boarz Tape, compact redesign** — tabs plus a bento home with overlay
  drill-in, replacing the single long scroll. Round-folded Track List, album art,
  a season masthead, sticky nav, and degenerate norm combos hidden rather than
  rendered empty. (`bside/`)
- **Four new sections:** **The Regulars** and **The Glossary**; **The Carrot
  Box** — a season-review section with a definition card and six documented
  boxes; **Who Submitted What** — the submitter-guessing ledger; and **Read The
  Room** — the voting-habits piece (four visuals) ported from the CD handoff,
  with real vote data and a contrarian score.
- **Deep links to any section**, plus per-card share / save-as-PNG export on Read
  The Room.
- **Recency pivot on the Mixing Board** — Season vs. Last 14 days.
- **The Reel** — a weekly chat slideshow/video digest section, framed as
  Register B / Newsroom per the design handoff.

### Under the hood

- **The YTM drop, live.** A `voting_started` email now triggers
  `scripts/ytm-drop/run.mjs`, which mirrors the round's Spotify playlist into a
  YouTube Music playlist (YouTube Data API), generates a cover, and posts both to
  the live Boarz group. Scheduled by `deploy/mlb-ytm-drop.timer` (every 15 min);
  the SQL scope is Boarz-only by design, and the target is `YTM_DROP_TARGET`.
- **Round cover generator** (`scripts/ytm-cover/generate.mjs`) — CD concepts
  1a/1b/1c from send-time round data, revised to grid-fill tiling with 1d
  Filmstrip and 1e Pulp Stamp added. **1d is the shipping variant.**
- **Spikes, recorded** (`.planning/spikes/`): 001a validated playlist creation
  via the Data API; 002a was **invalidated** — the Songlink API is dead — and
  002c validated Spotify→YTM resolution 10/10 via Data API search; 003 ran the
  end-to-end trigger and send.

### Fixes

- **Awards with dedicated sections no longer repeat** in the roll/trivia.
- **Chart bars animate via `scaleX`**, not `width` — on both the tape and the CD
  template. A width transition relayouts every frame.
- **PC wheel-scroll works on the tab and chip strips** without holding shift.
- **The Reel's sound was unreachable**, especially on mobile — now tap-to-unmute.

## 2026-08-26 → 2026-08-27 — The Rollout entity and the round prep panel

**Two pieces of round-end machinery: one shipped into the operator app, one
built but deliberately not switched on.**

### Visible (UI)

- **The round prep panel** — pre-generation material rendered on the prepare
  stage: the previous-round bridge row, chat, Regulars, Guesser and participation
  rows, a notes affordance, and an early-lede row. Editor notes written here are
  injected into the generation prompts, so the human's steer reaches the LLM
  before the draft exists rather than after.
- **Round notes** — a `round_notes` table, store and editorial envelope, a notes
  API route, and read-only modal chips.
- **Early ledes** — generated from the early sheet and editor notes, with a
  rating-preserving upsert so re-generating does not discard a human rating.
- **A Rollouts tab** with the definition editor, a runs view, and a run strip on
  the digest page.

### Under the hood

- **The Rollout — per-league round-end orchestration**, built end to end: types
  and a default definition with structural validation; `rollout_configs`,
  `rollout_runs` and `rollout_cut_runs`; an EP solver over the shared `epCore`
  primitives; a pure engine (claiming, EP advance, parking); a store with atomic
  claims and lease reaping; checks, remaster covers and forced hold; holds that
  park, notify once, and lift with a spent token; host and app executors; and
  config / runs / resume endpoints. Triggered by **email ingest**, not a
  scheduler.
- **NOT LIVE.** `rollout_configs` and `rollout_runs` are both empty and have
  never had a row; `mlb-hil-ledes.timer` still owns round-end on the host, and
  `mlb-rollout-host.timer` is not installed. Cutover is its own task — see
  [docs/how-to/rollouts.md](docs/how-to/rollouts.md).
- **Shared EP bucketing and cover placement extracted** from the digest pipeline
  so the Rollout's solver and the pipeline cannot drift.

### Fixes

- **I4** — the archive cut 404'd; wired to the real async content update.
- **I5** — running cuts now heartbeat, so the 600s lease cannot reap them
  mid-run.
- **I8** — `saveRun` no longer clobbers an unclassified concurrent host result.
- **I9** — agent cut models resolve through the `modelFor` cascade at snapshot
  time.
- **I6 regression test** — `requeueJob` after a completed rollout run must not
  throw.

## 2026-08-15 → 2026-08-24 — The digest quality program

**Stop shipping fabrications.** A round of hand-QA on R147/R148/R140 turned into
a Python verification suite and a participation metric, so the same classes of
error are caught before a human reads the draft.

### Visible (UI)

- **Size-adaptive style shelf** — hero quotes and long spotlights pick a layout
  from the content's size rather than the author's guess.
- **Body `**bold**` runs**, a single-open chat accordion with the first moment
  open, and a 1s shimmer on the chat-moment chevrons.
- **Phrase-of-round clip lightbox** (web only, focus-trapped) plus a `/_media`
  Caddy route and a word-list generator.
- **Round punch-ups shipped:** R148 boarz (Paletz villain fix, Regulars +
  Coinage), R140 More Cowbell (Regulars, farkas Coinage, full mention sweep) and
  its v2 rebuild, with coinage media carrying all four cat exhibits.

### Under the hood

- **`scripts/digest-qa/`** — `verify_facts.py` (deterministic F1–F4 pass plus
  verbatim quote checks), `dedupe_scan.py` and `mention_inventory.py` (F6/F7 and
  the mention ledger), `mention_matrix.py` (per-section mention breakdown) and
  `dupe_review_page.py` (marked-up duplicate review), with a pytest harness and
  fixture DB. Runtime is stdlib-only.
- **The chat participation metric** — a `player_participation` schema and vector
  store, ballot dimensions, burst / elicited / temporal-overlap dimensions, chat
  volume and kind dimensions, a composite score with an opportunity adjustment
  and percentile-among-active, a review page, and a backfill across both
  leagues. Baselines in [docs/metrics/](docs/metrics/).
- **Per-league rulecards** ([docs/league-rulecards/](docs/league-rulecards/)) —
  second-best and fam-jam verified, boarz and sssc derived from the ballots
  themselves (budgets, penalties, the no-downvote rule). The tiebreak cascade is
  league-universal.
- **HiL round-end automation (WS10)** — a round bridge, story-lede generators, a
  `/hil` review page, and a host-side round-end trigger. Runs on the host as
  `mlb-hil-ledes.timer`.
- **Chat timestamp normalisation** migration script and tests (dry-run verified,
  **not applied**).
- **Cover-gen pipeline** (`scripts/cover-gen/`) — player/cover ingest, face
  crops, prompt assembly and a generation CLI.
- **Documentation accuracy audit** ([docs/audits/doc-accuracy.md](docs/audits/doc-accuracy.md))
  and a top-level docs refresh: HLD rewrite, `docs/` index, digest-sections and
  regular-types references.

### Fixes

- **Four fabricated ballot readings in R140** caught by the facts pass, plus a
  budget override.
- **Edge-aware highlight boundaries in `markRuns`.**
- **Markdown that never rendered is stripped**, and date stamps dropped from
  chat.
- **ntfy sends survive the real world** — ASCII `Title` header (the header is
  latin-1), a Cloudflare-safe `User-Agent`, and a click URL pointing at bot-ui.
- **Shared round windows in `chat_participation`**, and relay noise rows dropped.

## 2026-08-13 — The style shelf

**One YAML field picks the layout.** The Regulars and The Coinage are now
hand-authored as YAML, and a single `style:` line per entry chooses how it
renders — so a round can feel bespoke without new code.

### Visible (UI)

- **Seven layouts for The Regulars**, behind one `style:` field: `quote-led`
  (the fallback), `spotlight`, `call-response`, `edit-history`, `roster-map`,
  `refrain` and `buzzer`. Each puts the tell itself first instead of burying it
  under a paragraph. A declared style whose payload is missing degrades to
  `quote-led`, so half-written YAML still renders. (style shelf)
- **The Coinage** — the phrase of the round as an Urban-Dictionary entry (term,
  pronunciation, part of speech, numbered definition, original + best usage with
  the term highlighted, origin and source link), read off
  `stats_content_json.phrase`. It deliberately gets **no** style registry: it has
  exactly one style, and one adapter is a hypothetical seam, so the existing
  phrase card was extended in place with `style:` kept forward-compatible.
- **The Usual Suspects** — the cast section, retitled and rebuilt around one
  idea per card after the shipped version read as too busy. A new optional
  `player` field lets `name` carry the *archetype* (The Editor, The Consul) with
  the person underneath; it defaults to `name`, so pre-existing rows render
  unchanged. The redline is now the hero of `edit-history`, `call-response` lets
  the reply read as the content and the prompt as context, and the layout name
  is no longer printed to the reader — it was implementation detail on a section
  criticised for noise.
- **YAML editing mode** in the section inline editor — a Fields ⇄ YAML toggle on
  the review screen. The DB column stays JSON: no migration, and no new
  `digest_sections.kind`.

### Under the hood

- **The Guesser's season arc** — `seasonHitRates[]`, `seasonRate` and
  `seasonRoundCount` on `GuesserData`. The arc is capped to the last 10 rounds so
  the strip stays readable at the 800px export width, while the average stays
  whole-season; the caption names both sets once they diverge, so it can never
  imply the average covers only the bars on screen.
- **Emphasis is never injected as HTML** — all marking goes through run arrays.

### Fixes

- **`each_key_duplicate` killed the PNG export.** A duplicated hand-authored
  label on the legacy Coinage metrics path took hydration down for the whole
  document, and the export with it. Every `{#each}` in the insights block and the
  shelf is now index-keyed. Several of these were pre-existing.
- **`phrase.source` went into `href` unguarded** — `javascript:` URLs rendered as
  live links on a publicly published page. Now http/https only, failing closed.
- **Pre-redesign storylines rows lost their paragraph** — `normalizeCast` read
  only `note`; it now falls back to `headline`.
- **Long unbroken tokens escaped the export frame** (839px inside a 798px frame),
  silently clipping the PNG. Shelf text now wraps at word boundaries.

## 2026-08-05 → 2026-08-06 — SSSC, The Guesser, The Regulars

**A third league and two deterministic people-sections.** SouthSide Secret Club
comes aboard with Discord as a first-class chat source, and the digest gains two
sections about the players rather than the songs.

### Visible (UI)

- **The Guesser** — a deterministic ledger of one player's habit of naming who
  submitted each song, drawn as a play-order "descent" down the playlist with a
  season hit-rate arc, an "eludes him" list and a "littermates" mix-up pair. No
  LLM: every number comes from vote comments resolved against the roster. Opt-in
  per league via `guesser_*` draft columns.
- **The Regulars / Storylines** — a cast section fed by deterministic evidence
  gathering over hand-authored seeds, with per-league opt-in and gen-time gating.
- **SouthSide Secret Club onboarded** (`sssc`, excluded from combined stats) via
  the hardcoded league SEED.

### Under the hood

- **Deterministic vote-comment guess resolver** — precomputes despaced candidate
  keys and matches them against whole-word 1–4 token concatenated runs of the
  comment, exactly or fuzzily (candidate key ≥5 chars, edit distance ≤1, length
  difference ≤1). Longest match wins on ambiguity. This catches both spaced
  guesses against concatenated roster labels ("Poetry in Noise" vs
  `PoetryinNoise`) and single-character typos (`a1merson` vs `a1mrson`), which
  the previous space-collapsed substring match missed.
- **Discord as a first-class chat platform** — a `discord` identity type (added
  by a guarded table rebuild, with a test proving existing `player_identities`
  rows survive), a Discord thread-log parser, and scripts to ingest the SSSC
  thread and materialize its roster identities.
- **`storylines` digest section kind** — added by a rebuild that preserves regen
  children.
- **Round intelligence** — artist callbacks across prior seasons, five additive
  `digest_drafts` columns, and top-section variants.

## 2026-07-23 → 2026-07-29 — Voting Phase Lab, Theme Strategy Brief, chat superlatives

**Three surfaces that help before and after the vote.** A scratchpad for
allocating your own votes, a strategy brief for picking a submission, and a
chat-analytics page for the group.

### Visible (UI)

- **Voting Phase Lab** — a collapsible lab on the active-round and round-detail
  pages: allocation steppers with an exhaustion-aware meter and per-song cap,
  notes with debounced autosave, a validated ballot summary you can copy out, a
  season vote-budget editor in settings and a per-round override in the header.
  Songs load from the round's Spotify playlist. (voting-phase-lab)
- **Track lens and comment drafting** — a personalized per-song lens (explicitly
  *not* a vote recommendation) plus draft vote comments in the owner's voice,
  built on an owner taste fingerprint and a cross-league voice sample, cached by
  inputs. (voting-phase-lab)
- **Theme Strategy Brief** — winner DNA, cellar traps, what-to-submit and
  language inference for a theme, on top of a deterministic data layer
  (standings, podium/cellar, familiarity, scoring) and an audience-aware exposure
  model of who in the target league already saw the owner's past picks. Cached in
  a `theme_briefs` table and exposed as the `get_theme_brief` MCP tool.
  (theme-strategy-brief)
- **Boarz Tape chat superlatives** — a shareable static page: an award roll, an
  interactive Mixing Board (9 metrics × 3 normalizations), a day/hour activity
  heatmap with a person filter, the biggest-word hero, and a track list of every
  music link shared in the chat. Also builds a public Spotify playlist from the
  round-1 podium plus every resolved track.
- **"The Off Switch"** — a thread-ender section leading the superlatives page:
  who ends conversations, and about what. Drop-off is the last message before a
  long silence, thresholded at 30 minutes (the chat's own 97th percentile — median
  gap is 24 seconds) and counted in **waking** minutes only, with the clock
  stopped 01:00–07:00 so being last before bed doesn't score.
- **Post-vote insight surface** — a deterministic round-intelligence block
  (`roundInsights.ts`, `DigestInsights.svelte`) with a word cloud, taking over
  from the old stat strip.

### Under the hood

- **Generic chat prompt engine** (`src/chat/prompts/`) — a question/answer engine
  that knows nothing about songs or Music League. A prompt is "a question posed
  to a chat whose answers resolve to a known option set"; guess-the-submitter is
  just the first caller. Sanitize → resolve (aliases, exact, concatenation,
  prefix, fuzzy) → template → engine, with the store as the only impure part.
  Answers arrive as a quote-reply, a `#hashtag`, or a private message.
- **Readability metrics reworked** — Flesch-Kincaid replaced with
  volume-adjusted word-difficulty rates, grade level restored as an adjusted
  Gunning Fog, plus a Mastery metric (long *and* rare words, used often);
  vocabulary now counts size as well as variety.
- **`/media` route on the bot control server** for sending images.

### Fixes

- **Round phase is derived from deadlines**, not the stale `rounds.phase` column.
- **Duplicate-key hydration crash** in the lab's song list — rows are keyed by
  submission id.
- **Chat identity resolved across phones** — relay `sender_handle` is captured,
  identities are league-scoped from `player_identities`, and the chat group
  itself is never counted as a participant.
- **Gmail IMAP connections are never leaked**; searches are date-bounded and
  time-bounded.

## 2026-07-16 → 2026-07-21 — Automated digest pipeline + notifications

**The digest can now produce and send itself, with a human gate.** A job queue,
a runner state machine, an approval step over ntfy, and a multi-channel
notification dispatch.

### Visible (UI)

- **Notifications settings panel** — config cards, a routing grid and a
  per-channel test send. (Phase 2)
- **Per-league digest mode and default generation params.**

### Under the hood

- **`digest_jobs` table and job queue** — enqueue/claim/transition/fail, with a
  job enqueued when email ingest records `voting_ended`. Retry with backoff and
  requeue for failures; alerts fire only on terminal failure. A one-job-in-flight
  guard serializes ML exports, excluding human waits.
- **Runner state machine** — capture → generate → render → auto-finalize, with
  fakes for testing and a claim guard so a throw can never reject the tick.
- **Approval gate** — single-use tokens, public approve/deny endpoints behind
  two-layer auth, and a `structuralReviewReason` resolver-parity review gate that
  holds a draft for a human when it looks off. (Phase 2)
- **ntfy module and multi-channel dispatch** — publish plus approval/review/
  failure builders, then generalized into a `Channel` interface with ntfy and
  WhatsApp adapters and a `notify()` fan-out over the routing grid. The bot's
  `/notify` route lets the bot DM the owner on behalf of a bot-ui dispatch.
- **Scheduled-send resolver** with a season-final hold, per-league send targets,
  claim-before-send idempotency, and a fail-closed send guard on proactive posts.
- **Bot control server** — trigger a poll or send any round to any group, bound
  to the compose network for cross-container `/trigger`.
- **Seasons carry their source** — `source` and `source_competition_id` columns,
  backfilled for all 11 seasons, with a shared DB-backed season→source resolver.
  The rebuild, reconcile and auth-trigger scripts now resolve the league id from
  the DB and keep the hardcoded pin only as a fallback. (SP1)

### Fixes

- **`ml-rebuild` guards deletes against data loss** and pins all targets.
- **Chat windows a new season's first round from `created_at`**, not a future
  deadline; live rounds stay visible and season counts are true.

## 2026-07-01 → 2026-07-08 — Sonic Signature, MCP server, research cascade

### Visible (UI)

- **Sonic Signature** — a league-relative taste fingerprint on the b-side and
  research surfaces, computed client-side from raw interactions and live
  settings. Archetypes are league-relative: a player is named by how they differ
  from their league rather than from an abstract center, so a mainstream family
  still reads as distinct. Ships with a 48-name tiered archetype table, downvote
  repulsion, lyrical damping and spread. (taste-waveform)
- **System-wide Taste Waveform config** in settings — palette, axis order, line
  and node style, amplitude and band knobs, with a live sample, a league→player
  picker with full-profile preview, a league separation score, and apply-to-live.
- **Card image share/download** for a signature, client-side.
- **Collapsible settings panels** — App Settings and Music League Setup collapse
  by default, with persisted collapse state.
- **History → League Research tab** (heatmap / drift / genre) and song metadata
  on Theme Research pick rows.
- **Digest section controls reach parity** — Stats, Standings and Tastemaker gain
  exclude/lock/regen; a per-section batch regen queue for prose sections; a
  queued section state; and a cosmetic lock on the next-round preview.
- **Missing-popularity panel** on the digest prepare screen, with a manual
  popularity override endpoint.

### Under the hood

- **MCP server** — package scaffolding and an HTTP client, then tools for
  `resolve_round`, song lists, H2H random matchups, digest generation,
  `list_leagues`, `list_rounds`, `get_active_rounds`, `search_spotify` and
  `import_round_data`, backed by new `GET /api/leagues`, `/api/rounds/list` and
  `/api/rounds/resolve` endpoints.
- **Research cascade and H2H random pairing** — soft-removal fields on
  `research_songs` with an `includeRemoved` filter, a cascade-add endpoint, an
  `h2h_pending_matchup` table and random-pairing mode across four new routes.
- **Popularity, honestly** — `fetchSpotifyPopularity` batched in the shared
  client, a `song_popularity.popularity_source` column, and
  `recomputePopularityProxies` (uniform percentile with calibrated Spotify
  ranking), recomputed at digest prepare and generate.
- **League chat auto-fetched** over the round window into generation.
- **Configurable Tastemaker archetype bucket boundaries.**

### Fixes

- **Robust JSON extraction from LLM output** (lenient fence + brace-slice),
  fixing intermittent ` ```json ` parse 500s.
- **Honest prep checks** — tastemaker coverage matches the `getDiscoverability`
  gate, a chat-availability row was added, and a Spotify token failure no longer
  500s the recompute.
- **`TasteSettingsSchema` moved to `schema.ts`** — SvelteKit rejects non-handler
  exports from `+server.ts`, which was 500ing both GET and POST.
- **Operator app subdomain migrated** `mlbot2` → `mlb37.mattmariani.com`.

## 2026-06-23 → 2026-06-30 — Metadata queue, universal song card, avatars

### Visible (UI)

- **Song metadata queue panel** in settings — a digest-readiness block, a
  coverage matrix, a failures list and an auto-enrich footer. Then redesigned
  around a status ladder: scope-aware aggregation and hierarchy, metric tiles
  with monotonic colors and filter state, per-job-type segmented rollups, a
  hierarchy navigator, a heatmap view, per-song cards with per-element run, and
  triage with grouped failures and bulk retry/dismiss. (metadata-queue)
- **Universal song card** — one `SongCard`/`SongList` with canonical types and
  adapters, migrated across shortlist, research, search, chat and history,
  including a mobile `SongSheet` and a `SongCompare` H2H surface.
  (unicard Phase 0–4)
- **Player avatars** — generated via OpenRouter image models or uploaded, with a
  settings editor (traits including race, hair style and color, gender-scoped
  styles, age shift), avatars in the read model and standings chart with
  rank+arrow badges, a regenerate-themed-avatars checkbox in the digest and
  b-side modals, and per-player generation cost in the roster. Image-gen cost is
  captured into `llm_cost_log`. (avatars Task 1–8)
- **Music League email ingestion** → a real round phase timeline, with an
  email-poller status panel in settings.
- **b-side UI polish** — scroll fade, semantic icons, a member-wins badge, OG
  meta and card-style history rows.

### Under the hood

- **Unified metadata queue** — a `song_metadata_queue` table and helpers,
  Last.fm and LRCLIB provider handlers, and a single worker replacing the YTM
  worker. Jobs are enqueued on zip import and shortlist add; audio analysis moved
  from synchronous to async enqueue; single-song enrich, status, fill-gaps and
  retry endpoints were added, and `ytmQueue.ts` retired. (queue Task 12)
- **Audio analysis wired in** (`sintel`), with uv and a sintel mount added to the
  bot-ui container.
- **Lyrics word/line counts** captured for the wordiness axis.
- **Prep checks extended** with five metadata coverage rows.

### Fixes

- **Avatar re-uploads show immediately** — R2 keys are versioned, and the base
  preview cache-busts on the R2 key rather than a resettable counter.
- **Audio jobs no longer wedge the metadata queue** in `processing`.
- **Last.fm API key read at call time**, not module load, with an 8s rate gate.
- **`effect_update_depth_exceeded` infinite loop** in the digest cover-data
  `$effect`.
- **Async job pattern for the b-side update** to beat a Cloudflare 524.
- **Adapter-node `BODY_SIZE_LIMIT` raised** so avatar uploads parse.
- **Chat is reachable on phones** — a mobile master-detail layout — and
  submission-phase chat is no longer orphaned, via contiguous round windows.

## 2026-06-19 → 2026-06-22 — Chat capture and history

### Visible (UI)

- **Chat Content History tab**, a per-round Chat History tab and a Settings Chat
  section, scoped to leagues with a season filter, a paginated thread viewer
  (last 100 messages with Load older) and an unmapped-league empty state.
  (chat-history)

### Under the hood

- **GroupRelay capture wired end to end** — `chatMessagesDb` and the relay
  handler speak the GroupRelay `CaptureBatch` format, with `RELAY_DEBUG` logging
  of the raw payload and per-message disposition, and a natural-key unique index
  on `chat_messages` for dedup.
- **`mlb-run` and `mlb-download` CLI scripts**, with WhatsApp zip auto-ingest
  from `~/Downloads/mlb-chat/`.

### Fixes

- **`each_key_duplicate` crash in `BubbleThread`.**
- **The `./data` volume is mounted** so the api service can read and write the
  sqlite db.
- **Digest kebab move-up/down** now swaps section positions.

## [1.13.0] — 2026-06-19

**sprint-46 — Archive pipeline.** The generation pipeline now drives **b-side
archive** generation too, not just the digest — configurable from the same Pipeline
tab via a digest/archive switcher.

### Added

- **`buildReadModel` runs an archive pipeline.** The b-side read-model is now produced
  through the pipeline (ordered tasks, skip = context handoff, covers, per-task model)
  instead of a fixed sequence. Guarded by a regression test: a no-skip/no-cover archive
  pipeline reproduces today's b-side generation exactly.
- **No merge for archive** (by design): the b-side tasks (narrative ×4, profile ×2,
  season-update) are heterogeneous calls that can't combine, so each track is always its
  own call. Skips and covers still apply; tasks in a phase still run in parallel.
- **Digest/archive switcher** on the Pipeline tab. The archive view drops the merge-rail
  (each track shows "1 call") but keeps skips, covers, and per-track model.
- **Per-kind config API** — `GET/PUT /api/settings/pipeline-config?kind=digest|archive`;
  the archive pipeline persists to its own `pipeline_config_archive` key.

## [1.12.0] — 2026-06-18

**sprint-45 — Pipeline config UI.** The generation pipeline is now editable without
touching code: a new **Pipeline** tab on the Models & AI screen.

### Added

- **Pipeline tab** (`/settings/models`, in-page) to view and edit `pipeline_config`:
  reorder sections, set a per-section model (or "use default"), insert `── skip ──`
  dividers (EP boundaries), and add/remove covers — Save writes the config, Reset
  restores the default.
- **Merge-rail** shows (display-only) which adjacent same-model sections collapse
  into one call — it reflects the resolver, never a control that could contradict it.
- **Run preview** — call count + relative cost band (sticky footer on mobile, an
  EP→skip→cover timeline on desktop), driven by a client EP solver that is
  **parity-tested against the real `resolvePipeline`** so it can't drift.
- **`GET`/`PUT /api/settings/pipeline-config`** to read/write the config.

### Changed

- **Per-section models are now set in the Pipeline tab.** The sprint-41 per-section
  overrides panel becomes a read-only mirror (shows the effective model, links to the
  Pipeline tab) — one place to set a section's model. No data migration: "use default"
  writes no override, so existing config keeps working.

## [1.11.0] — 2026-06-18

**sprint-44 — Covers + A/B review.** Completes generation-pipeline v1. A section
can be "covered" — re-run later on a better model with the rest of the draft as
context — and the digest review lets you pick between the two takes.

### Added

- **Covers**: the default pipeline now covers the **Flow** section on
  `claude-sonnet-4-5`, generated in a trailing phase that reads the rest of the
  draft. Both the original and the cover take are persisted.
  ⚠️ This means every digest now fires **one extra (Sonnet) call** for the Flow
  cover — intentional (premium where it matters), but a real per-digest cost.
  Null the default pipeline's `covers` to turn it off.
- **Cover A/B review** in the digest flow: any covered section shows Original vs
  Cover side-by-side (each with model · cost · latency), defaulting to the cover,
  with the original always one unpenalized click away. Hidden from exports.
- **`llm_preference` table**: each pick is logged as a clean head-to-head
  model-preference signal (original vs cover, which won) — the event-based quality
  data the cost campaign wanted, with no rating UI or judge.

## [1.10.0] — 2026-06-18

**sprint-43 — Generation pipeline (core).** Fixes the production gap where
per-section model pins did nothing on a fresh digest. The digest draft is now
produced by a configurable **pipeline** instead of one hard-coded call, so
per-section pins finally bind on the initial draft.

### Added / Changed

- **`generateDraft` now runs a pipeline**: sections are grouped into EPs split at
  **skips**; same-model sections in an EP **merge** into one call; later EPs receive
  earlier output as context (assistant-turn). Per-section pins (`modelForSection`)
  bind here — that's the gap closed.
- **One-skip default pipeline**: the factual/extractive sections (quotes, consensus,
  podium, chat) generate together first; then a skip; then the voice sections
  (villain, flow) generate reading the whole draft — coherence kept where it matters.
- **Regression-guarded**: a no-skip single-model pipeline reduces to *exactly* the
  prior single call (same cost/latency/output) — verified by an explicit test.
- **Merge prompt** generalized so a call can request any subset of sections.
- Groundwork for covers (sprint-44): a `cover_kind` column on `digest_regenerations`.

### Note

- A fresh digest now makes one call per model-group/EP instead of one call total.
  With no pins set it's still effectively one merged factual call + the voice EP;
  with pins it routes each pinned section to its model.

## [1.9.0] — 2026-06-18

**sprint-42 — Usability & delight capture.** Completes the openrouter-cost-management
campaign: the third KPI (usability) and its positive counterweight (delight) now
accrue from normal use — no rating UI, no AI judge. The columns shipped empty in
v1.6.0; this populates them from real actions.

### Added

- **Outcome capture on every digest section** (fire-and-forget — a failed write
  never interrupts the action): inline-edit → `salvaged` + `edit_distance`;
  regenerate → prior output `rejected`; finalize untouched → `passed`. b-side
  refresh/steer → `rejected` on the prediction row.
- **Delight ▲ control** on each digest section (pre-finalize): mark a standout
  line; writes an `llm_delight` row linked to the generating call. Hidden from
  exported PNG/PDF.
- **Health events** — provider/availability/capability failures log to
  `llm_health_event`, kept quarantined out of the usability score.
- Prediction runs now return their ledger `rowId` so outcomes attach cleanly.

### Notes

- Digest reaches the full ladder (passed → salvaged → rejected → unusable);
  prediction & b-side reach passed/rejected/unusable only (no salvage rung —
  those outputs aren't human-edited).
- `regen_changed` discrimination (params vs model on a reject) is stubbed `none`
  in v1; the evaluator / quality score itself remains a future stage.

## [1.8.0] — 2026-06-18

**sprint-40 — Debug mode + cost dashboard.** The cost ledger from v1.6.0 now has
a face: a debug-mode toggle reveals a "Cost & routing" dashboard built from the CD
handoff prototype. No charting library — all CSS/token visuals.

### Added

- **Debug-mode toggle** (App Settings) wired to a `debug_mode` DB key, plus a new
  **Debug** tab → `/settings/debug` (shows a placeholder when debug mode is off).
- **Cost dashboard widgets** (translated from the CD prototype, reading the live
  `/api/cost/*` endpoints):
  - **Today's spend summary** — digest / archive / predict split + total.
  - **Call drilldown** — every call with time, category, label, model, tokens, cost,
    latency; newest-first; mobile collapses the model/latency columns.
  - **2-week stacked bar chart** — one bar per day, category base colors with
    per-call opacity shading and hover tooltips (CSS bars, like StandingsChart).
  - **Cost × latency scatter** — one point per model, for "which model where".
  - **Weighted value-score dock** — live cost/latency sliders re-rank models
    (lower-is-better normalization); a third quality axis is stubbed for the future.
- Predict category uses the `--sky` token (not `--ember`, which carries an
  error/blocking semantic) to avoid implying prediction spend is "bad".

## [1.7.0] — 2026-06-18

**sprint-41 — Per-section model selection.** Each content section can now be
pinned to its own model, so cheap models run boilerplate and a premium model runs
only where it matters. Independent of the cost ledger; builds on the sprint-38
resolver. (Shipped ahead of the cost dashboard, which is gated on design — so this
took v1.7.0 and the dashboard will take v1.8.0.)

### Added

- **`modelForSection(section, db)` resolver** layered over the two-bucket
  `modelFor` — fallback chain `digest_model_<section>` setting → bucket default →
  env → hardcoded. 16 pinnable sections (6 digest kinds + 10 dashboard/predict tasks).
- **Per-section overrides card** on the Models & AI screen: two accordion groups
  (Digest sections / Dashboard & predict tasks), each row a qualifying-models select
  with a "(use default)" sentinel and an "N overridden" badge; 412px-friendly.
- **`GET`/`PUT /api/model-vars/sections`** mirroring the existing model-vars pattern
  (PUT with null clears a pin; 400 on unknown section).

### Changed

- **The 3 prediction tasks (submission-predict, vote-probe, taste-fingerprint) now
  honor the DB model setting.** They previously read a static `OPENROUTER_PREDICT_MODEL`
  env var at module load and ignored the in-app Predict selection; they now resolve
  through `modelForSection`/`modelFor` like every other task.

### Known limitation

- Per-section pins take effect on **per-section regeneration** and on the
  b-side/prediction tasks (each is its own model call). The **initial full digest
  draft** is a single multi-section call and still uses the Digest bucket default;
  honoring per-section models on first generation would require splitting that call
  (out of scope for v1).

## [1.6.0] — 2026-06-18

**sprint-39 — OpenRouter cost ledger + passive usability capture.** The data
foundation for the openrouter-cost-management campaign: every LLM call is now
recorded per-call with cost, latency, tokens, and the impossible-to-backfill
attribution/usability fields. No user-facing UI yet (the dashboard is sprint-40);
this is the write-only spine plus one bundled display fix.

### Added

- **Per-call cost ledger (`llm_cost_log`).** New table recording model, prompt/
  completion/total tokens, USD cost, wall-clock latency, category (digest/archive/
  predict), and a fine-grained label for every digest-path OpenRouter call.
- **Federated with the existing `prediction_runs` ledger.** Predict and b-side
  calls already logged cost+latency there; sprint-39 extends that table with the
  cost-attribution + passive-capture columns rather than double-logging. A
  `llm_calls` UNION view presents both as one stream.
- **Passive usability/quality capture (can't-backfill).** `run_id`, artifact
  linkage, `prompt_version`, `output_hash` (sha256, not the text), `retry_count`,
  the `params` blob, and a technical `outcome` default (truncation / schema-fail →
  `unusable`) are captured at generation time. Side tables `llm_health_event` and
  `llm_delight` created (populated in the follow-on usability sprint).
- **`callOpenRouter` now surfaces tokens + latency** (previously discarded) and
  accepts a `meta` object that drives the ledger write (`logLlmCall`, fire-and-forget).
- **Cost read API** — `GET /api/cost/summary`, `/api/cost/daily`, `/api/cost/calls`
  over the `llm_calls` view, for the sprint-40 dashboard.

### Fixed

- **Cost-tier badges now reflect real pricing.** `tierFromPricing` compares
  per-million-token thresholds, but `ai_models` stores per-token prices — every
  model wrongly showed `$`. Corrected at all three call sites (Opus → `$$$`,
  Sonnet → `$$`, Haiku → `$`); the roster draft bar price label now shows per-million rates.
- **`proposeRelContextUpdate`** no longer drops the call's cost or ignores the
  DB-selected model; it resolves via `modelFor('digest')` and logs to the ledger.

## [1.5.1] — 2026-06-17

**sprint-38 follow-up — Models & AI UAT fixes.** Three fixes from the post-deploy
UAT pass, all in the new Models & AI surface.

### Fixes

- **Removing a model now clears its bucket override.** Deleting a saved model that was
  the active Predict or Digest selection used to leave a dangling DB override — the
  resolver kept returning a model no longer in the roster, and the "DB override active"
  banner showed on an empty roster. Delete now nulls any bucket setting pointing at the
  removed model, so resolution falls back to env → hardcoded.
- **Model lookup retries on cold-start.** The first (uncached) fetch of OpenRouter's
  model catalog occasionally returned a transient `408`; the lookup now retries
  (bounded, with backoff) and bounds each attempt with a timeout, so the first lookup
  after a deploy no longer fails.
- **`/setup` redirects to `/settings/setup`.** Added a redirect shim so old bookmarks
  to the pre-sprint-38 Setup path land on Music League Setup instead of a 404.

## [1.5.0] — 2026-06-17

**sprint-38 — AI Model Management.** Settings is now tabbed, and a new **Models &
AI** tab puts model choice in the operator's hands instead of in env vars. Bring
your own OpenRouter key, build a roster of saved models by pasting an id, and pick
which model drives predictions vs. digests — all from the UI, DB-backed, with the
existing env/hardcoded values kept as visible fallbacks.

### Models & AI (new Settings tab)

- **OpenRouter connection** — paste your OpenRouter key (stored server-side, masked,
  never echoed back) with a live status pill.
- **Saved-model roster** — paste a model id → server looks it up against OpenRouter's
  catalog → editable record with capability glyphs (reason / stream / vision / tools /
  JSON), context length, cost tier (auto-derived, override-able), a **FREE** badge, and
  favorites. Dedupes on model id; estimates when the catalog has no price.
- **Model Variables** — two selects, **Predict** and **Digest**, populated from the
  roster filtered to models that *qualify* (e.g. JSON-mode capable). Each shows the
  resolved value plus three read-only fallback fields (predict env / digest env /
  hardcoded default), with a warning if you pick an unqualified model.

### Settings restructure

- Settings is now a tabbed surface: **App Settings**, **Music League Setup**, and
  **Models & AI**.
- **Setup moved under Settings** — the old `/setup` page is now **Music League Setup**,
  and the **Auto-fill deadlines** + **Round deadlines** tools moved there from App
  Settings. All inbound links repointed to `/settings/setup` (the bare `/setup`
  route is removed — no redirect shim).

### Under the hood

- New `ai_models` table + `openrouter_key` / `predict_model` / `digest_model` settings.
- `/api/models` CRUD + `/api/models/lookup` (server proxy → OpenRouter `/models`, ~1h
  cache), `/api/settings/openrouter-key`, `/api/model-vars`.
- **DB-first model resolver** — `modelFor(bucket, db) = dbSetting ?? env ?? hardcoded`,
  wired at the 4 generation sites (narrative ×4, digest, dashboard). Generator functions
  and task→bucket mapping unchanged; only the model source moved.
- Qualify enforcement is UI-side for v1; server-side validation and per-task model
  routing are deferred.

## [1.4.0] — 2026-06-16

**sprint-37 — "The Living Season": the b-side gets a season recap.** The public
b-side home now opens (right under the by-the-numbers ribbon) with a narrated
**Season Update** — a snark-tunable recap of where the season stands: who's
running away with it, where the real midfield drama is, who's trading places. It
reads from real season signals, not vibes.

### The b-side

- **Season Update section ("The Pulse")** — a `{title, body}` recap rendered after
  the KPI ribbon on the public home, guarded so leagues without a generated update
  simply don't show it. Sky accent, pulse-body paragraphs.
- Backed by real, season-wide signals — including a new **spot-trading rivalry**
  detector (who keeps swapping standings places with whom) and a **punching-bag
  guard** so the same person isn't ribbed every single round.

### Operator app

- **Snark dial (Gentle / Medium / Spicy)** in the Update modal — sets the voice of
  the generated Season Update per league, defaulting to the league's current level.

### Under the hood

- `snark_level` column (additive migration) + `getSnarkLevel()` +
  `PATCH /api/content/:leagueId/snark`.
- `seasonUpdateTask` + `buildSeasonUpdateMessages` with the voice mandate and
  guardrails baked into the prompt; `SeasonUpdateOutputSchema` for `{title, body}`.
- `ReadModelSchema.seasonUpdate` wired into both `buildReadModel` and
  `buildUpdatedReadModel` (punching-bag guard fed in as recent subjects).
- 570/570 tests green (new snark-route, carry-over-signals, seasonUpdateTask, and
  read-model-wiring suites).

## [1.3.0] — 2026-06-16

**sprint-35 — digest stops citing future rounds (the "ghost" fix).** Regenerating
an old round's digest no longer miscites later-round songs/people as "last round."
An R3 digest used to cite R5's "Cottonfield Blues" and "Johnny Lang"; it doesn't
anymore.

### Digest accuracy

- **Deterministic cross-round bundle** — generation now builds a per-round factual
  record (top-3 / bottom-1 / winner per round), scoped to `round_number <= current`
  and correctly ordered, and the prompt is instructed to cite cross-round facts
  **only** from that bundle — never invented, never forward.
- **Round-scoped relationship context** — regenerating a round reuses that round's
  saved context snapshot instead of the live, forward-accumulated league blob, so
  later-round narrative can't leak backward.
- Cross-round "ghost" callbacks are kept (they're fun when right) but are now
  bundle-cited only.

### Under the hood

- `RoundData.bundle` + the cross-round-record prompt block in `llm.ts`;
  `gatherRoundData()` accepts a `relContextOverride` so regen passes the draft's
  snapshot. 18 new tests incl. the R3-ghost regression (533 total green).

## [1.2.0] — 2026-06-16

**sprint-34 — round phase becomes operator-controlled.** Round phase
(`not-started / submission / voting / complete`) is now an explicit **stored
field advanced by buttons**, instead of being derived from deadlines vs. the
clock. This fixes rounds silently dropping out of the "active" slot the moment a
voting deadline passed — exactly when their digest needs generating.

### Operator app

- **Phase controls on the active-round surface** — an **End Submission Phase**
  button (modal: editable end-timestamp + **Accelerated** vs **Speedy**, default
  +3 days) and an **End Voting Phase** button (completes the round, pre-fills the
  next round's submission deadline). Deadlines now render as **informational**,
  not gating.

### Under the hood

- **Stored `rounds.phase` column** + migration with a full backfill from the
  previous deadline-derived phase (no row left null).
- **Phase-transition endpoints** — `POST /api/rounds/:id/end-submission`
  (accelerated|speedy) and `POST /api/rounds/:id/end-voting` (completes +
  next-deadline prefill), with illegal-transition guards.
- **Stored phase is authoritative** — active-round resolution and the lifecycle
  derivation now read `rounds.phase`; deadline derivation survives only as a
  fallback when phase is null. Prep-checks no longer hard-block on missing or
  auto-filled deadlines.
- De-scopes the active-round-truth piece from `active-league-management`.

_The operator Action Center (notification/todo center) is the on-deck sprint-35;
Web Push is v2._

## [1.1.1] — 2026-06-15

Campaign **the b-side**, sprint 3 of 3 (final) — the **operator Content screen**.
The b-side that sprint-32 made public can now be published and updated entirely
from the operator app, replacing the orc-curl path. This **closes the campaign**.

### Operator app

- **Content screen** — the sidebar's **Digest** item becomes **Content** (`/content`,
  with a `/digest` redirect) and a pending-update count badge, split into two tabs:
  - **Digest** — the existing generate → refine → finalize pipeline, unchanged
    (just wrapped in the new tab chrome).
  - **Archive** — manage each league's b-side. A league list with three states —
    update-ready, up-to-date, not-published — each row showing emblem, name,
    season, the b-side URL, and meta (members · rounds archived · last updated).
- **First publish** — "Publish b-side →" mints the slug and shows the published /
  reshare state (the reshare card with Send to WhatsApp / Copy share card / Copy
  link, honoring the Announce config).
- **Archive-update modal** — refresh / hold / lock per section (superlatives,
  stats·KPIs, fingerprints, moments, overlap) plus a required new-archive-entry
  row, steerable rewrites (quick-steer chips + free text), an Announce strip, and
  a cost estimate. Updates always rewrite the read-model **in place on the same
  slug** — locked sections are never regenerated.

### Under the hood

- New `/api/content/*` routes: `leagues` (per-league b-side state + pending-update
  flag = a finalized round not yet in `archived_rounds`), `:leagueId/update-plan`,
  `:leagueId/update` (section-wise `buildReadModel` recompute, persists per-section
  decisions in `dashboard_section_state`, appends the round to `archived_rounds`),
  and `:leagueId/reshare`. 16 new route tests.
- `publishSite` now tracks `archived_rounds` by round ID and exports
  `writePublicArtifacts` for the update path to reuse.

## [1.1.0] — 2026-06-15

Campaign **the b-side**, sprint 2 of 3 — the **public league site is live**. The
read-model sprint-31 generates now has a face: a public, no-auth, read-only
micro-site per league at `digest.mattmariani.com/{slug}`.

### New surface (public, separate from the operator app)

- **the b-side** — a standalone static site, one per league, served by the same
  dumb caddy host as the digests (no app, no DB, no login, `noindex`; nothing on
  it reaches the operator app). Three routes:
  - **League Home** — hero, celebratory KPI ribbon, the superlative reel, the
    member grid, season moments, latest-round teaser.
  - **Player Profile** (the heart) — signature superlative, the Taste Fingerprint
    (artist/genre/era chips + spectrum sliders + rewards/punishes), more
    superlatives, Biggest Fan / Friendly Hater, "Your People" (overlap v2 — Vote
    Together + Taste Twins), and a discovery playlist. Lite-tier members degrade
    gracefully.
  - **Digest Archive** — past rounds by season, each deep-linking to the existing
    full digest artifact.
- Every award has a **share card** — a screenshot-ready overlay with just the
  award + league name, no URL, safe to drop in any chat.

### Under the hood

- Standalone `bside/` Svelte SPA (built once at deploy → `DIGESTS_DIR/_bside/`);
  `publishSite` writes per-slug `index.html` + `read_model.json`; `Caddyfile.digest`
  routes `/{slug}/*` with SPA fallback + `noindex`, bad slug → 404 (no enumeration).
- Operator publish path unchanged: `POST /api/content/:leagueId/publish`.

## [1.0.9] — 2026-06-14

Campaign **the b-side**, sprint 1 of 3 — the read-model generator. No user-facing
UI yet (the public site is sprint 2, the operator screen sprint 3); this builds the
offline engine that produces each league's shareable-dashboard content.

### Under the hood

- **`dashboard_sites` + `dashboard_section_state` tables** — one published site per
  league (unguessable ≥80-bit slug, JSON read-model snapshot, archived-rounds list)
  and the per-section refresh/hold/lock state.
- **Read-model generator** (`$lib/dashboard`) — assembles a league's full read-model
  on the sprint-28 prediction harness: **overlap v2** (Vote Together within shared
  rounds + Taste Twins across leagues, replacing the misleading global-Jaccard
  overlap), deterministic stats/tiers/KPI-facts/season-moments/fan-hater
  relationships, LLM superlatives + celebratory phrasing + friendly fan/hater
  blurbs (no-strife contract — never a leaderboard), and per-player spectrum +
  discovery playlist derived from the taste fingerprint.
- **`POST /api/content/:leagueId/publish`** — mints the slug, builds + persists the
  read-model in place on the same slug.
- Tests: 459 green (was 336).

## [1.0.8] — 2026-06-14

Polish pass on the Player Research tab — making the tools the last two sprints
added pleasant and cheap to use.

### Visible (UI)

- **Collapsible sections, collapsed by default** — the per-player panel no longer
  unfurls into a wall; each section (Taste Overlap, Dossier, Taste Fingerprint,
  Vote Probe, Submission Predictor, Songs Submitted) opens on click.
- **Songs Submitted moved to the bottom** — the longest section no longer buries
  the prediction tools.
- **League-scoped theme picker** — the Vote Probe and Submission Predictor theme
  dropdowns now show only the relevant league's themes (was: every theme from
  every league), and pass the theme's real description to the model so predictions
  account for the full theme wording.
- **Cached predictions with provenance** — re-opening a player+theme you've already
  run shows the cached result instantly (no new LLM call / no new cost), stamped
  with when it was generated, the model, and the cost. A **Regenerate** button
  forces a fresh run when you want one.

### Under the hood

- `vote-probe` and `submission-predict` now check `prediction_runs` for a matching
  prior result before calling the model, keyed on player + song/theme; `forceRegen`
  bypasses the cache. Mirrors the Taste Fingerprint persist+provenance+regenerate
  pattern.
- Theme picker reuses the existing `AssignPopover` league-scoping pattern.
- Tests: 344 green (was 336).

## [1.0.7] — 2026-06-13

Producer Sprint 2 — the **Submission Predictor**, the mirror of Sprint 1's Vote
Probe. Pick a player + a theme and the app predicts what they'd submit.

### Visible (UI)

- **Submission Predictor** — a new panel on the Player Research tab (under Vote
  Probe). Pick a player, pick a theme (real past themes or freeform), hit Predict,
  and get a three-part read:
  1. **Property profile** — the *kind* of song they'd likely bring (genres,
     artists/types, era, mood/energy, obscurity lean, whether a comment's likely),
     with a rationale grounded in their history.
  2. **Ranked candidates** — several concrete song guesses, each with a short "why
     it's here."
  3. **Final pick** — the single most-likely song, with detail on why it beat the
     others and explicit links to *similar songs they've actually submitted before*,
     plus a confidence level.
  Candidate songs are validated against Spotify, so picks are real (and carry a
  Spotify link where resolved).

### Under the hood

- New `submission-predict` task on the Sprint-1 prediction harness (no new
  plumbing — a new template + schemas), logged to `prediction_runs` like every
  other prediction.
- `validateTracks` helper reuses the existing Spotify client-credentials flow to
  resolve candidate songs (no new auth path).
- Endpoint `POST /api/players/:id/submission-predict`.
- Tests: 336 green (was 291).

## [1.0.6] — 2026-06-13

Producer Sprint 1 — the first slice of the "Music League Producer". The Player
Research tab gains a per-player dossier and two AI tools, all built on a reusable
prediction harness so later predictors (submissions, whole-round) plug in without
new plumbing.

### Visible (UI)

- **Player dossier** — on the Player Research tab, each player now has an editable
  **Dossier**: free-text notes + taste tags you control. Your manual context is
  kept strictly separate from anything the AI generates, so it's never clobbered.
- **Taste fingerprint** — a Generate/Regenerate button drafts an AI taste profile
  for the selected player (signature artists, genres, eras, what they reward vs.
  punish, a one-line summary), with a model + cost + date stamp. Regenerating never
  touches your dossier notes.
- **Vote probe (Standalone Affinity Score)** — paste a song + pick a theme (real
  past themes or freeform) and get an estimate of how much that player would like
  it: a likelihood gauge, expected points, history-grounded reasoning, and signal
  bullets. It scores one song's standalone affinity — the future whole-round
  predictor will build on this.

### Under the hood

- **Prediction harness** — a reusable `PredictionTask` engine (`$lib/predict`) over
  the existing OpenRouter client: structured zod input → templated prompt → JSON-mode
  model call → validated structured output, with swappable model/params (the tuning
  knob) and per-call cost capture.
- **Two new tables** — `player_profiles` (manual dossier + AI fingerprint, separated)
  and `prediction_runs` (logs every prediction with model/cost from day one, seeding
  the future accuracy backtest).
- **Endpoints** — `GET`/`PATCH /api/players/:id/profile`, `POST /api/players/:id/fingerprint`,
  `POST /api/players/:id/vote-probe`.
- Tests: 291 green (was 202).

## [1.0.5] — 2026-06-13

The collision-fix sprint (sprint-27). Sprint-26 inventoried every write path and
confirmed four live collisions; this release lands the fixes (FB-1..FB-5), each
re-verified by re-running the sprint-26 collision repros against the fix.

### Visible (UI)

- **Manual round edits survive a ZIP re-import** (FB-1, was data-loss) — renaming
  a round (or editing its description / playlist URL) and then re-importing the
  league ZIP no longer clobbers your edit. A per-field `edited_fields` marker
  records which fields you've touched; the importer refreshes everything else
  from the ZIP but leaves your edits alone. Re-verified: round 118 rename
  survived a `/settings` rescan (C2 → FIXED).
- **Digest next-round deadlines stop going stale** (FB-2, was wrong-display) —
  updating a round's deadlines now clears any digest draft's next-round deadline
  override that was silently shadowing it, so the digest shows the real deadline.
  The explicit "↺ Reset to computed" flow is preserved. Re-verified C3 → FIXED.
- **The home page agrees with itself about the active round** (FB-3, was
  wrong-display) — the home rail and the Active Rounds modal now derive "which
  round is active" from one shared module, so they can't disagree on the same
  page. A pinned round that has reached the archive phase falls through to the
  derived active round instead of sticking. Re-verified across all four leagues
  at desktop and mobile (C4 → FIXED).

### Under the hood

- **Importer links new competitors to players on insert** (FB-4) —
  `upsertCompetitor` now auto-links `player_id` via the deterministic
  `ml_competitor_id` rule, and `upsertSubmission`/`upsertVote` write `player_id`
  at insert time. Newly imported competitors no longer reopen the null-gap;
  non-matching competitors stay NULL and surface in the `/setup` unlinked banner.
  Clears precondition PC-4 for the future FK hard-repoint sprint.
- **Digest regeneration skips excluded sections** (FB-5) — both the whole-draft
  and single-section regenerate paths now skip `state = 'excluded'` sections
  instead of burning LLM tokens on content nobody sees.
- **Known caveat (pre-existing, not a sprint-27 regression):** the digest page
  throws a client-side 500 in dev because `llm.ts` imports `node:crypto`
  (present since sprint-21); tracked separately.

## [1.0.4] — 2026-06-12

### Visible (UI)

- **Competitors section on `/setup`** — new roster section listing every ML
  competitor with name, truncated `ml_competitor_id`, leagues, and a player
  picker to link/unlink the competitor to a player. Unlinked competitors
  surface in an amber banner at the top — they're the action item (e.g. a new
  account joining a league mid-season). Linking re-syncs the competitor's
  gameplay rows immediately; the player's unified history absorbs them without
  a reboot.

### Under the hood

- **Durable manual season status** — `seasons.status_source`
  (`derived`/`manual`): flipping a season's status from `/setup` now sticks.
  The importer, CLI live-round import, and `ml-rebuild.mjs` all skip
  re-deriving status for manually-flipped seasons in both directions. Fixes
  the "Nostalgia Pit re-activated itself after a manual flip" bug.
- **Competitor→player linking API** — `PATCH /api/competitors/:competitorId`
  sets/clears `competitors.player_id` and immediately re-runs the gameplay
  backfill (`ml_submissions`/`votes`/`season_standings.player_id`) for that
  competitor in one transaction — the boot-time backfill is no longer the only
  sync path.
- **Feature inventory + collision audit (sprint-26 artifacts)** — full
  write-path inventory (19 writers), active-round derivation audit (10 sites +
  divergence matrix), hands-on screen inventory (10 routes), and 6 collision
  reproductions (4 confirmed) under `docs/coordination/inventory/`; prioritized
  fix backlog FB-1..FB-5 in the sprint doc; FK hard-repoint planning doc at
  `docs/coordination/planning-fk-repoint.md`.

## [1.0.3] — 2026-06-12

### Under the hood

- **Stable player-ID history joins** — `/api/history/players` and
  `/api/history/players/:name` now key history on stable identity tokens
  (`'p:N'` for linked competitors, `'c:N'` fallback for unlinked) instead of
  `competitors.name` string matching. Renaming a player via the setup screen
  leaves their full submission history intact; a player active in multiple
  leagues shows one unified history record. Response shapes are unchanged —
  the 27-entry roster and all stats are identical on current prod data.
- **Additive `player_id` FK columns** — `ml_submissions`, `votes`,
  `season_standings`, and `rounds` each gain a nullable `player_id` column
  alongside the existing `competitor_id`/`voter_id` columns. All NULL on prod
  until competitors are manually linked to players via the setup screen. No
  read-query changes — all digest, standings, and history reads continue to
  use the existing `competitor_id` join path. Structural groundwork for the
  future write-path migration.
- **`competitors.player_id` link column** — `competitors` gains a
  `player_id INTEGER REFERENCES players(id)` column wired for the
  `ml_competitor_id` backfill path. Backfill on current prod data is a no-op
  (manually-created players have `ml_competitor_id = NULL`); future imports
  that populate `ml_competitor_id` will auto-link on first boot.

## [1.0.2] — 2026-06-12

### Visible (UI)

- **Shortlist sticky strip** — `/shortlist` now shows a sticky header with one
  row per active league, displaying league name, current round theme, and
  submission/voting deadlines. When a song row is open, each league row shows a
  quick-assign button that lands the song on that league's active round
  immediately. Otherwise shows an "open a song to assign" hint.
- **H2H league selector** — the head-to-head ranking panel now carries league
  context. Each strip row has an H2H button; clicking it opens
  `ShortlistH2HPanel` labelled with the target league. Completing the
  king-of-the-hill tournament assigns the champion to that league's active round
  only, never to the wrong league.
- **Digest "Next Round Up" — persist, exclude, and inline edit** — the Next
  Round Up section in the digest now has standard kebab controls (edit/exclude).
  Excluding the section or editing the theme text and deadline survive a page
  reload via a stored override. The computed value returns when the override is
  cleared. The GenerateModal exclude toggle is also persisted.

### Under the hood

- **`/api/rounds/open` derived-active leagues** — the shortlist assign popover's
  data source now returns rounds for every league with a derived-active round
  (season `status='active'`, live round, or manual `is_active` flag), not just
  leagues with the manual active flag. All three active leagues (Hip Jammers,
  Fam-Jam, Second Best) appear as separate filter groups in the assign popover.
- **Next-round override storage** — `PATCH /api/digest/:roundId/next-round`
  persists theme text, deadline, and exclude flag to a `next_round_overrides`
  table; `GET` returns the stored values, which win over the computed result on
  load.

## [1.0.1] — 2026-06-11

### Visible (UI)

- **League active controls** — home league cards and the Active rounds panel can
  toggle a league's manual active flag through the existing league API.
- **Next Round Up deadlines** — digest next-round previews now render submission
  and voting deadlines separately instead of one ambiguous deadline.

### Under the hood

- **Season import status is conservative** — re-imports preserve active seasons,
  and a season is inferred complete only when every imported round has votes.
- **Active-round derivation is season-aware** — leagues with active seasons
  surface even without the manual active flag, and all-archived active seasons
  report a next-round-needed state instead of pretending the latest archive is
  active.
- **Next-round lookup crosses seasons** — digest next-round data now walks the
  whole league in season order and prefers round descriptions as the theme text.

## [1.0.0] — 2026-06-09

**MVP complete.** The History research tool's final two tabs land, closing the
History milestone and the MVP campaign. Every committed MVP sprint is shipped;
post-MVP roadmap work now unlocks.

### Visible (UI)

- **History → Theme research tab** — browse every past round/theme across all
  seasons; expand a theme to see who submitted what and how it scored (picks
  ranked by points, with submitter). Cross-season patterns are called out — your
  own past picks and recurring artists via the me-vs-others coloring. (sprint-24)
- **History → Player research tab** — pick any player to see their submission
  history, win rate, and taste overlap with everyone else, drawn as ranked
  overlap bars. (sprint-24)

### Under the hood

- **History data services** — `GET /api/history/themes` and
  `/api/history/players[/:name]` (`$lib/db/themeHistory.ts`, `playerHistory.ts`),
  built on the existing corpus joins. (sprint-24)
- **Viz as a client-hook layer** — theme-pattern coloring + taste-overlap bars
  mount via `hooks.client.ts` off the tabs' data-attribute seams, with zero edits
  to the tab components. (sprint-24)

### Fixes

- **App-wide hydration crash (caught at the wave gate)** — `theme-patterns.ts`
  read `$env/dynamic/public` at client-hook init, before SvelteKit's env global
  exists, throwing `undefined.env` and killing client JS on every page in the
  prod build (invisible to Vite dev / `svelte-check`). Switched to an inlined
  constant; `$env/static/public` documented as the only client-hook-safe option.

## [0.3.0] — 2026-06-08

The long catch-up since v0.2.0 — covers the digest, standings, season-recap, and
History-research waves (sprints 12–23). This is the last cut before the MVP
sign-off; the History research tool's final tabs (sprint-24) land in v1.0.

### Visible (UI)

- **Digest, rebuilt** — the weekly digest became accurate, controllable, and
  worth looking at: data-driven section controls, a wired **season-standings
  chart**, **album-art podium** thumbnails, a restructured **chat-moments**
  section (expandable on web, anchor-linked in PDF), and per-digest **LLM cost**
  shown in-app only. (sprint-14, sprint-15, sprint-17)
- **Standings for everyone** — standings show every player, with an editable
  table + reconciliation flow so figures can be corrected and adopted as gospel.
  (sprint-16)
- **Tastemaker leaderboard** — the real tastemaker view: spread scores and
  tappable per-user song lists. (sprint-18)
- **Season recap** — a cumulative season view (podium, villain, consensus,
  quotes, round-by-round flow, season stat-strip). (sprint-21)
- **HTML share** — a self-contained, still-interactive digest that can be served
  from a static host, with a mobile-responsive layout. (sprint-20)
- **History research tool** — "Round history" became **History**, a tabbed screen
  (Song search · Theme research · Player research). Song search shipped with
  me-vs-others color encoding and song/artist **badges** (medal / poop /
  discussion). (sprint-22, sprint-23)

### Under the hood

- **ML login + ingest recovery** — restored Music League login and fresh
  round-data pull after the auth/scraping breakage. (sprint-12)
- **Season-aggregation layer** — `gatherSeasonData` + per-section season slice
  builders (cumulative through a given round), the pure-data foundation for recap
  mode. (sprint-21)
- **Song-history status service** — batch API returning per-song provenance
  (submitted-by-me / by-others, artist-already-submitted, chat mentions) powering
  the History me-vs-others encoding. (sprint-23)
- **Album art from Spotify** — podium covers resolved + cached on
  `ml_submissions.album_art_url` (ML export carries none), with read-time
  backfill of older drafts. (sprint-15)
- **LLM cost capture** — OpenRouter per-generation cost accumulated on
  `digest_drafts.llm_cost_usd`. (sprint-15)

### Build / tooling / infra

- **Two-loop deploy workflow** — split a fast per-change inner loop (HMR +
  `npm run check`, no Docker) from a single orc-gated per-wave prod deploy;
  replaces the old "deploy to prod for every change" rule. (sprint-22, ratified
  2026-06-06; see `docs/dev-loop-playbook.md`)
- **Chromium base image + Docker refactor** — a shared `music-league-bot-base:chromium`
  base image so app images stop reinstalling chromium on `--no-cache` rebuilds;
  `Dockerfile.base` / `Dockerfile.ui` / `docker-compose.yml` updated. (sprint-19)

> _Deferred (not in this release):_ sprint-13 YouTube-Music play button — paused
> on the Odesli cross-link dead-end; the real fix (`ytm-resolution`) is on the
> post-MVP roadmap.

## [0.2.0] — 2026-06-01

The first cut since the digest preview landed (v0.1.x, sprint-9). Covers the
sprint-10 ingest/extension wave and the sprint-11 data-pipeline + UI polish wave.

### Visible (UI)

- **Import from CLI** — the digest *prepare* stage gains an "Import from CLI"
  button plus an ml-auth status badge, so a fresh round's submissions / votes /
  comments can be pulled without leaving the webapp. (sprint-11 Task B)
- **Unified rating bars** — the rating bar component is now shared across the
  Shortlist and Research views with one consistent look, and rating changes
  update live instead of requiring a reload. (sprint-11 Task C)
- **Research tab: manual sort + auto-advance** — the research tab supports manual
  reordering and an "auto-after-all-4" toggle that advances automatically once
  all four research passes complete. (sprint-11 Task D)
- **Settings → API tokens** — a `/settings/api-tokens` sub-route to generate,
  list, and revoke bearer tokens for the Chrome extension, with a one-time
  plaintext reveal. (sprint-10 Task 4)
- **Chrome extension wordmark icons** — the extension ships proper M/L wordmark
  icons sized to fill the canvas. (sprint-10 + sprint-11)

### Under the hood

- **Host-side CLI export.zip ingest** — a host-side bridge drives
  `cli-web-musicleague leagues export <id>`, then parses and imports the
  resulting `export.zip` (submissions, votes, vote comments) into the DB.
  (sprint-11 Task A)
- **API tokens + bearer auth** — new `api_tokens` table with generate / list /
  revoke endpoints and bearer-token middleware protecting the ingest API.
  (sprint-10 Wave 1)
- **Spotify URL ingest endpoint** — accepts track / album / playlist URLs from
  the extension and adds them to the shortlist. (sprint-10 Wave 1)
- **YTM ingest via Songlink fallback** — YouTube Music URLs resolve to Spotify
  tracks through a Songlink lookup so they flow through the same ingest path.
  (sprint-10 Task 9 / 10)

### Build / tooling

- **`npm run check` clean baseline** — fixed the long-standing `vite.config.ts`
  `test`-overload error by importing `defineConfig` from `vitest/config` instead
  of `vite`. Check now exits 0 errors (28 pre-existing a11y / `state_referenced_locally`
  warnings remain, untouched this sprint). (sprint-12)
- **App version surfaced** — `ui/package.json` bumped to `0.2.0` and rendered in
  the sidebar footer, imported directly from `package.json` so the displayed
  version can never drift. (sprint-12)
