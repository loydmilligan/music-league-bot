# Changelog

All notable changes to the Music League Bot webapp are documented here.
Format loosely follows [Keep a Changelog](https://keepachangelog.com/);
versions track `ui/package.json` and render in the app footer (`mash co. · vX.Y.Z`).

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
