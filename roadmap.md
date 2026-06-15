---
id: digest-auto-schedule
title: Digest Auto-Schedule
stage: planned
effort: small
summary: Auto-post the weekly digest to the WhatsApp group on a configured
  day/time. The full generation pipeline is built — this is just wiring the
  existing output to the bot's send path on a cron.
---
id: whatsapp-history-backfill
title: WhatsApp Chat History Backfill
stage: planned
effort: medium
summary: One-time import of exported WhatsApp .txt chat history to backfill all
  song shares that happened before the bot was installed. chatDb schema is
  already in place — needs a parser + ingest pipeline.
---
id: unified-research-song-card
title: Unified Research Song Card
stage: analyzed
effort: large
summary:
  One shared song-card on every surface where you research/evaluate songs — the History tabs (Song / Theme / Player), the chat screen, and the research-capable round tabs (NOT head-to-head). Canonical design is the sprint-23 History Tab-1 card (`ui/src/lib/components/SongSearchCard.svelte`):
    cover art, title, artist·album, me-vs-others history-status coloring,
    song/artist badges, expandable. Each card gains two add-actions available
    everywhere — "+ shortlist" (the global "might-be-of-interest-someday" stash)
    and "+ round list" (pick an active round → that round's candidate pool that
    feeds head-to-head → winner). The canonical card has no add buttons today
    (it's a search-result card), so this both consolidates every surface onto
    the one component AND adds the dual add affordance, with a round-target
    picker when adding from outside a round context.
---
id: history-card-parity
title: Theme & Player Tabs — Song Cards
stage: analyzed
effort: medium
summary: Render the songs in the History Theme research and Player research tabs
  as individual cards matching the Song-search tab's `SongSearchCard` (cover
  art, title, artist·album, expandable, history-status coloring) instead of the
  current compact rows. A focused first slice of `unified-research-song-card` —
  the same canonical card, scoped to just the two new tabs (no dual add-actions
  / chat / round-tab surfaces yet). Consider building this and
  `unified-research-song-card` as one effort, or this as the near-term step.
---
id: active-league-management
title: League/Season/Round/Player Model Foundation
stage: planned
effort: large
summary: "Make the app's knowledge of leagues, seasons, rounds, and players
  accurate and explicit — the foundation most roadmap features depend on. Fixes
  three live symptoms (digest 'Next Round Up' wrong round/deadlines, shortlist
  H2H locked to one league, second league stuck at 6 rounds), then builds the
  full model: leagues → seasons → player assignments (rosters change per season
  and mid-season), global player entities with chat identity (chat type
  whatsapp|google-chat + handle) explicitly linking chat users to ML players, a
  setup/management UI for league/season/round/player, and the full FK + history
  migration so gameplay tables key off stable player IDs (rename-proof history,
  cross-league identity, write-path for non-ML leagues). Research:
  docs/coordination/planning-league-model.md."
notes: "Owner direction 2026-06-11: full scope ratified — not worried about a
  long sprint. Includes the FK/history migration originally proposed as a
  follow-up. Fam-jam league is Google Chat with manual digest paste; chat-type
  field future-proofs auto-ingestion but no GChat ingestion in this card."
gaps:
  - Google Chat auto-ingestion (fam-jam stays manual paste; chat_type field only
    future-proofs it)
  - Manual round/submission/vote entry UI for non-ML leagues (FK migration
    enables the write path; the entry UI is a later card)
  - Analytics features this unblocks (player metrics, voting bias, Elo,
    cross-season DNA) remain separate roadmap cards
  - Digest auto-schedule + WhatsApp history backfill are separate planned cards,
    not folded in
jobs:
  - B1 [backend, seq 1] Fix season-status heuristic — importer must stop
    overwriting season status on every re-import; 'complete' only when all
    rounds have votes and no open rounds; support manual override; regression
    tests against real sqlite fixtures (partial-import / re-import /
    full-import). Root cause of the 6-round second league.
  - B2 [backend, seq 1] Fix getNextRound cross-season — when current round is
    last in its season, return round 1 of the league's next season; clarify
    theme (name vs description) and deadline fallback so the digest never shows
    a wrong round or missing countdown.
  - B3 [backend, seq 1] Derive active leagues from active seasons — remove
    leagues.is_active as the sole gate in getActiveLeaguesActiveRounds; derive
    from seasons with status=active, keep the manual flag as an override.
  - B4 [backend, seq 1] Fix active-round derivation for all-archived seasons —
    stop resolving the latest archived round as 'active'; surface a
    create-next-round state instead.
  - B5 [backend, seq 2] Add players table — players (id, name, chat_type,
    chat_identifier, ml_competitor_id, created_at); backfill one player per
    existing competitor; additive only.
  - "B8 [backend, seq 2] Shortlist H2H API: surface all leagues' active rounds —
    /api/rounds/open and the assign flow include every league with a derived
    active round, not just is_active=1."
  - B6 [backend, seq 3] Add season_players junction — (season_id, player_id,
    joined_at); importer upserts roster rows from each imported round's
    competitors; supports mid-season roster changes.
  - B9 [backend, seq 3] Season management API — endpoints to mark a season
    active/complete, reassign active_round_id, and re-import without status
    overwrite.
  - B10 [backend, seq 3] Chat-identity model + CRUD — link a player to a
    WhatsApp phone / Google Chat handle; routes chat_mentions.sender_name →
    player entity; no ingestion logic yet.
  - B7 [backend, seq 4] History views on player_id — migrate playerHistory.ts
    and /api/history/players from competitors.name string matching to stable
    player_id joins so renames don't fracture history.
  - "B11 [backend, seq 4] FK migration: gameplay tables → players — repoint
    ml_submissions.competitor_id, votes.voter_id,
    season_standings.competitor_id, rounds.theme_chooser_id at players;
    deterministic backfill from the B5 mapping; full regression pass over
    digest, standings, and history."
  - F1 [frontend, seq 1] League active-toggle UI — one control calling the
    existing PATCH /api/leagues/:leagueId/active; immediately unblocks the
    second league in ActiveRounds.
  - F6 [frontend, seq 2] Shortlist active-round header strip — sticky
    quick-assign header, one row per active league with current round
    theme/deadlines + per-song quick-assign (depends B3).
  - F8 [frontend, seq 2] Digest 'Next Round Up' persist + edit — persist exclude
    state to DB, wrap the section in DigestSection controls, inline
    theme/deadline editing with stored override; PATCH
    /api/digest/:roundId/next-round (depends B2).
  - "F2 [frontend, seq 3] League management screen — route or panel for league
    metadata: active flag, display name, chat type."
  - F3 [frontend, seq 3] Season management UI — mark seasons active/complete per
    league; scope shortlist/digest to the right season (depends B9).
  - F7 [frontend, seq 3] Shortlist H2H league selector — head-to-head ranking
    flow targets the chosen active league's round (depends B8).
  - "F4 [frontend, seq 4] Player roster screen — view/edit players per
    league-season: add/remove, display name, membership picker across existing
    leagues/seasons (depends B5, B6)."
  - F5 [frontend, seq 4] Player chat-identity fields — chatType + chatHandle on
    the player editor, linking ML players to chat users (depends B10).
  - F9 [frontend, seq 4] Explicit next-round pin UI — designate which round is
    'next' per league from the active-rounds panel / digest prepare flow,
    instead of pure inference.
---
id: theme-search-filters
title: League + Season Filters on Theme Research
stage: analyzed
effort: small
summary: Add league and season pill filters to the History Theme research tab so
  the ~80-theme list can be narrowed. UI filter chips over the existing `GET
  /api/history/themes` data (which already carries season; league may need to be
  added to the payload / a query param). Small frontend addition mirroring
  filter patterns elsewhere in the app.
---
id: player-research-metrics
title: Deeper Player Research Metrics
stage: idea
effort: large
summary: Extend the History Player research tab beyond songs / win-rate /
  taste-overlap with richer analytics — voting habits (who a player gives points
  to and withholds from), submission + voting timing habits (early vs
  last-minute behavior), and comment analysis (volume, tone, recurring themes).
  Needs design on which metrics matter and how to compute them (comment analysis
  likely LLM-assisted, reusing the OpenRouter path); new backend data services +
  UI, building on the sprint-24 player-data service.
---
id: submission-integration
title: Submit to Music League from Shortlist
stage: analyzed
effort: small
summary: Add a "submit to ML" action directly from the shortlist or shortlist
  detail view. ML Auth is already implemented — this closes the
  research-to-submit loop without leaving the app.
---
id: ytm-resolution
title: YouTube Music Resolution (Headless Queue)
stage: analyzed
effort: medium
summary:
  Replace the broken Odesli cross-link with a server-managed Playwright/Puppeteer queue for reliable YTM lookup. Unblocks YtmPlayButton and the existing YTM play infrastructure. Quick fallback: music.youtube.com/search?q=Artist+Title links when full resolution fails.
---
id: isrc-deduplication
title: ISRC-Based Strict Deduplication
stage: analyzed
effort: medium
summary: Replace fuzzy title/artist string matching with ISRC lookups against
  the historical songHistory database. Prevents submitting remasters, live cuts,
  or re-releases of previously played tracks.
---
id: algorithmic-theme-validation
title: Algorithmic Theme Validation
stage: idea
effort: medium
summary: Automated heuristic validation of submissions against Spotify track
  metadata (release year, BPM, genre tags, explicit flags). Instantly rejects
  submissions in WhatsApp if they violate numeric or categorical theme rules
  (e.g., "Songs over 180 BPM", "Released in 1994").
---
id: rich-media-digests
title: Rich-Media Digests Pushed to WhatsApp
stage: idea
effort: medium
summary: Render digest sections (podiums, standings, biggest upset) as images
  via a headless browser or HTML-to-image pipeline, then post them directly into
  the WhatsApp group when a round closes. Eliminates the "leave the app to see
  the digest" friction.
---
id: audio-previews-in-chat
title: Native Audio Previews in WhatsApp
stage: idea
effort: medium
summary: Fetch 30-second preview buffers from the Spotify Web API and dispatch
  them as native WhatsApp audio messages. Lets members preview submissions
  without opening a streaming app.
---
id: voting-bias-analytics
title: Voting Bias Analytics
stage: idea
effort: medium
summary: Track historical voting matrices across seasons — "User A awards 40% of
  their points to User B." UI dashboard with directed graphs of point
  distributions. Exposes voting cartels and introduces metagame depth.
---
id: elo-rating-system
title: Elo Rating System
stage: idea
effort: medium
summary: Augment or replace cumulative point tracking with a zero-sum Elo system
  that updates after every round based on expected vs. actual placement.
  Normalizes for varying participant counts and lucky rounds.
---
id: bracket-tournament-ui
title: Interactive Bracket Tournament UI
stage: analyzed
effort: large
summary: Full March Madness-style bracket UI on top of the existing
  tournamentStore and H2H infrastructure. Automates daily WhatsApp polling,
  advances winners by reaction count, renders live bracket SVGs in the SvelteKit
  UI.
---
id: cross-season-dna
title: Cross-Season Music DNA View
stage: idea
effort: medium
summary: Personal summary spanning all seasons — submission acceptance rate over
  time, themes you win at, artists you consistently pick, taste overlap with
  others. Standalone screen alongside the History tool.
---
id: agnostic-playlist-provisioning
title: Multi-Platform Playlist Provisioning
stage: idea
effort: large
summary: Extend Songlink integration to provision and sync mirrored playlists on
  Apple Music and Tidal alongside Spotify. Eliminates friction for members who
  don't use Spotify as their primary platform.
---
id: google-chat-integration
title: Google Chat Integration
stage: idea
effort: large
summary: Mirror the WhatsApp bot functionality in Google Chat — passive URL
  capture, digest posting, commands. Extends the platform to groups that use
  Google Workspace instead of WhatsApp.
---
id: mention-list
title: Owner Mention List (DM Queue)
stage: idea
effort: small
summary: Private song queue for the owner — URL drops in DM are appended to a
  running list; !mention process flushes the queue to a private Spotify
  playlist. No group noise.
---
id: the-b-side-league-dashboard
title: the b-side — Shareable League Dashboard
stage: planned
effort: large
summary: >-
  Public, no-auth, read-only micro-site per league on digest.mattmariani.com —
  the fan-facing flip side of the operator app. Digest archive, player profiles
  (taste fingerprint + overlap v2 + yearbook superlatives + biggest fan /
  friendly hater + discovery playlist), no-strife league KPIs, season moments.
  Spotify Wrapped × yearbook tone, never a brutal leaderboard. Claude Design
  delivered two full handoff packets — docs/design/dashboard/ (the public site)
  and docs/design/content/ (the operator "Content" screen that publishes /
  updates it). The ~80%-unbuilt read-model content generator is designed in
  docs/superpowers/specs/2026-06-14-bside-campaign-design.md. Tracked as the
  campaign `the-b-side`.
notes: >-
  Owner 2026-06-14: build as a campaign — sprint-31 read-model generator →
  sprint-32 public site → sprint-33 operator Content screen — then the Universal
  Share button as a separate capstone (own roadmap item). Locked decisions:
  spectrum sliders derived from the LLM taste fingerprint (no audio data needed
  for v1); static-generate the site on publish (same host model as digests);
  overlap v2 (Vote Together + Taste Twins) built in sprint-31.
