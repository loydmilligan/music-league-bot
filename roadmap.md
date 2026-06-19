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
stage: shipped
shippedIn: sprint-25 (v1.0.1-v1.0.4)
shippedNote: "Core model + FK/history migration + setup UI shipped. The round-phase piece was de-scoped to round-phase-model-and-action-center."
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
stage: shipped
effort: large
shipped: 2026-06-15 (campaign the-b-side, sprints 31→32→33; v1.1.1; owner-ratified)
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
---
id: bside-season-round-truth
title: b-side — Season & Round Truth (current / prev / next)
stage: analyzed
effort: large
campaign: bside-season-awareness
sprint: S1
source: owner-uat
summary: >-
  The recurring sitewide problem, felt sharply on the b-side: the app can't
  reliably answer "for league X, season Y — what are the rounds, in what order,
  and which is current / previous / next?" Surfaces as the Latest-round teaser
  showing an empty winner / 0 votes. The b-side read-model and archive must KNOW
  this with certainty and feed it to the generators. Heavy overlap with the
  existing `active-league-management` card (jobs B1–B4 season-status + getNextRound
  + active-round derivation, B9 season management, F9 explicit next-round pin) —
  treat this as the b-side-facing slice that consumes that foundation. Owner calls
  this the load-bearing fix everything else depends on.
---
id: bside-season-lens
title: b-side — Season Lens (current-season vs all-time)
stage: idea
effort: medium
theme: the-b-side-polish
source: orc-proposal
summary: >-
  Make "which seasons does this b-side cover" an explicit, labeled product choice
  rather than an accident. The archive currently says "season" but often means ALL
  seasons. Let the operator pick the lens at publish/update — current-season recap
  vs all-time league history — and label the site + archive accordingly ("Fam-Jam ·
  Season 4" vs "Fam-Jam · all-time"). All-seasons input is fine (esp. at season
  start, the sensible default) — this just makes it deliberate and splits the data
  cleanly per section. Builds on bside-season-round-truth.
---
id: bside-superlatives-curation
title: b-side — Superlative Curation & Snark Control
stage: analyzed
effort: medium
theme: the-b-side-polish
source: owner-uat
summary: >-
  Fewer, better, operator-curated superlatives. (1) Configurable count on the
  landing page (2..#players, default 2–3) — too many dilutes each, and every player
  already gets one on their profile. (2) Only ~2 in each player profile. (3) A
  generate-N-pick-M flow: the LLM proposes several (e.g. 10), operator picks which
  to include, or lets the LLM choose. (4) An adjective-variation engine — once a
  player qualifies for an award (e.g. ">25% of picks from the 90s"), generate ~5
  variations from a pool of ~30 tone adjectives (snarky / praising / goofy /
  disbelieving / bored), operator picks the keeper. Rename the "Yearbook awards"
  label to "Superlatives".
---
id: bside-superlative-visual-identity
title: b-side — Superlative Card Visual Identity
stage: idea
effort: small
theme: the-b-side-polish
source: owner-uat
summary: >-
  The award cards look a touch amateur. (1) Replace the clip-art trophy icon with
  something better (TBD). (2) Give the card colors MEANING instead of random —
  e.g. superlative categories (maybe only known internally), each with a top-level
  color, and the generator picks a tint of that family, never repeating a tint on
  the same b-side. Pairs with bside-semantic-accent-system.
---
id: bside-llm-avatars
title: b-side — LLM-Generated (Themed) Player Avatars
stage: idea
effort: large
theme: the-b-side-polish
source: owner-uat
summary: >-
  Supersedes/expands the existing "add avatars" intent. Beyond static uploads: (1)
  one-off LLM avatar-batch generation for a league's players on demand; (2) at
  archive-update time, an operator prompt that regenerates ALL players' avatars —
  ideally auto-themed to that round's theme (spooky theme → spooky versions of each
  player). Needs a per-player base: an uploaded photo or an LLM-generated "plain"
  generic-style version to theme from. Makes the member grid far more visual.
---
id: bside-member-grid-richness
title: b-side — Richer Member Grid Cards
stage: idea
effort: small
theme: the-b-side-polish
source: owner-uat
summary: >-
  Make "The Family" grid more visual and information-dense: more concise per-member
  text, a more stylized name treatment, and encoded badges — current-season rank,
  genre/music-taste badges, milestones. Complements bside-llm-avatars.
---
id: bside-mobile-card-rows
title: b-side — Mobile Card-Row UX (fade / carousel)
stage: idea
effort: small
theme: the-b-side-polish
source: owner-uat
summary: >-
  Recurring mobile issue on the horizontally-scrolling rows (the "Season so far"
  KPI ribbon, the superlatives reel): cards cut off at the right edge and the
  cutoff reads as unintentional until you discover the scroll. Horizontal scroll on
  desktop also feels sketchy. Options to evaluate: a right-edge fade so the cutoff
  reads as "more →" on purpose, or a proper mobile carousel. Owner wants orc's input
  on the right pattern.
---
id: bside-moments-chat-mined
title: b-side — Moments from Chat + Editor Pass
stage: idea
effort: medium
theme: the-b-side-polish
source: owner-uat
summary: >-
  Upgrade "Moments of the season" content. (1) Mine the league's WhatsApp/group
  chat for genuinely interesting or controversial things tied to specific picks /
  voting — owner can paste a season's chat to mine. (2) Fix the repeat-info bug
  (Biggest Upset re-using the Most-Loved song). (3) Add an "editor" LLM pass that
  reviews and punches up content with directives (funnier, nicer, or "build so-and-so
  up, she's had a rough week"). Voice-aware (see bside-voice-snark-tuning).
---
id: bside-voice-snark-tuning
title: b-side — Voice / Snark Tuning (loosen no-strife)
stage: idea
effort: medium
theme: the-b-side-polish
source: owner-uat
summary: >-
  The hard no-strife constraint may be too strict — owner notes the snarky,
  slightly-mean jokes are some of the funniest parts of the digests. Make tone a
  dial rather than a single floor: configurable snark/edge levels per section or
  per generation, with guardrails (punch-up not punch-down, opt-out per player).
  Connects to the superlative adjective engine and the moments editor pass.
---
id: bside-fan-hater-overlap-normalization
title: b-side — Fan/Hater & Overlap Normalization (averages)
stage: analyzed
effort: medium
theme: the-b-side-polish
source: owner-uat
summary: >-
  Fix tenure skew in Biggest Fan / Friendly Hater and "Your People". Use AVERAGE
  votes per shared round, not raw totals — newer players (e.g. Sarah) win/lose these
  spuriously just from fewer rounds. Use the setup-screen player relationships (the
  vote-matrix data) and player age where relevant. Vote Together has the same
  totals-vs-averages problem (may already be a backlog item — reconcile). Optional:
  a funny LLM-generated art piece for the award.
---
id: bside-real-audio-fingerprint
title: b-side — Real-Audio Taste Fingerprint Sliders
stage: analyzed
effort: medium
theme: the-b-side-polish
source: owner-uat
summary: >-
  Replace the LLM-derived spectrum sliders (Polished↔Raw, Sunny↔Melancholy,
  Familiar↔Obscure) with values from REAL audio features (Spotify audio-features or
  an equivalent) aggregated over a player's picks. v1 deliberately used LLM
  estimates with no audio data; owner wants the real signal "asap".
---
id: bside-discovery-playlist-link
title: b-side — Real, Linkable Discovery Playlist
stage: idea
effort: medium
theme: the-b-side-polish
source: owner-uat
summary: >-
  Turn the per-player discovery playlist from a text list into an actual playlist
  with a shareable link (Spotify, ideally multi-platform via the existing Songlink
  path). Owner: "one of the BEST features we have" if real + playable. Reuses the
  YTM/Spotify resolution roadmap work; pairs with bside-playlist-audio-integration.
---
id: bside-age-field-save-bug
title: "b-side — Bug: setup-screen age field not saving"
stage: analyzed
effort: small
theme: the-b-side-polish
source: owner-uat
summary: >-
  Spotted during UAT — the player Age field on the setup screen does not persist.
  Needed by fan/hater + other places that should use age. Straight bugfix
  (likely a missing save/PATCH wire on the age input).
---
id: bside-update-diff-preview
title: b-side — Per-Section Update Diff Preview
stage: idea
effort: medium
theme: the-b-side-polish
source: orc-proposal
summary: >-
  In the operator update modal, show a before/after preview for each section the
  operator chose to refresh, with accept/reject per section, before committing the
  in-place rewrite. Tightens the refresh/hold/lock loop — the operator sees exactly
  what changes and can keep the old copy on a per-section basis with confidence.
---
id: bside-content-lint
title: b-side — Pre-Publish Content Lint
stage: idea
effort: medium
theme: the-b-side-polish
source: orc-proposal
summary: >-
  A pre-publish QA pass that flags likely content problems before a b-side goes
  live — exactly the class of nits this UAT surfaced: duplicate moment songs, empty
  winner / 0-vote rows, a superlative referencing a lite-tier member, blurbs over a
  length budget, repeated card colors, missing avatar/description. Surfaces as a
  checklist in the Content screen; can gate or just warn.
---
id: bside-degenerate-state-handling
title: b-side — Graceful Empty / Sparse States
stage: idea
effort: small
theme: the-b-side-polish
source: orc-proposal
summary: >-
  Robust handling for sparse/degenerate data so sections hide or show a tasteful
  placeholder instead of "—" or an empty winner: a just-closed round with no votes
  (the Latest-round teaser), lite-only leagues, 0-member leagues (Nostalgia Pit), a
  brand-new season, archive rounds with no winnerSong. Directly cleans up the H5 /
  archive "—" nits from UAT.
---
id: bside-read-model-provenance
title: b-side — Read-Model Provenance & Freshness
stage: idea
effort: small
theme: the-b-side-polish
source: orc-proposal
summary: >-
  Make it obvious (to viewers and the operator) what each b-side reflects and how
  current it is — "generated from rounds X–Y · updated <date>", and a small per-section
  "as of round N". Builds trust on the public side and is a debugging aid for the
  season-scoping work (bside-season-round-truth / bside-season-lens).
---
id: bside-returning-visitor-diff
title: b-side — "What's New This Round" Banner
stage: planned
effort: small
campaign: bside-season-awareness
sprint: S2
source: orc-proposal
summary: >-
  When a b-side updates, show returning visitors what changed this round — the new
  archive entry, any new/changed award, a new moment — as a dismissible banner.
  Increases reshare pull ("come see what's new") and gives the same-slug update a
  visible payoff.
---
id: bside-share-card-og-meta
title: b-side — Share-Card Polish + OG/Unfurl Meta
stage: idea
effort: small
theme: the-b-side-polish
source: orc-proposal
summary: >-
  Make the unguessable link unfurl nicely when dropped in a chat — Open Graph /
  Twitter meta tags so it previews with a clean card (league name + tagline, no HQ
  leak, still noindex), plus a polish pass on the per-award share-card overlays.
  Strengthens the core "drop it in the family chat" moment.
---
id: bside-semantic-accent-system
title: b-side — Site-Wide Semantic Accent System
stage: idea
effort: small
theme: the-b-side-polish
source: orc-proposal
summary: >-
  Generalizes the owner's "give colors meaning" idea (bside-superlative-visual-identity)
  across the whole site: a small semantic palette (e.g. discovery=teal,
  consistency=gold, divisiveness=ember) used consistently on superlatives, moments,
  and fingerprint chips so color carries information rather than decoration.
---
id: bside-playlist-audio-integration
title: b-side — Playlist + Inline Audio Previews
stage: idea
effort: medium
theme: the-b-side-polish
source: orc-proposal
summary: >-
  Make the discovery playlist (and archive picks) playable inline — tie into the
  existing Spotify/YTM resolution + the roadmap's audio-preview work so each track
  has a 30s preview or a one-tap open-in-app. The natural companion to
  bside-discovery-playlist-link.
---
id: bside-force-check-new-digests
title: b-side — Manual "Check for New Digests" / Force Refresh
stage: analyzed
effort: small
theme: the-b-side-polish
source: owner-uat
summary: >-
  An explicit operator affordance on the Content → Archive screen to force a
  re-scan for finalized/regenerated digests and offer an update, rather than
  relying only on the auto pending-flag. Companion to the freshness-aware
  pending fix (shipped as a hotfix 2026-06-15) — the auto-detection now catches
  digests finalized after publish, but a manual "check / force refresh" button
  is a useful safety valve, especially during season backfill when re-generating
  many already-archived rounds. Small frontend + a re-scan endpoint.
---
id: bside-digest-context-channel
title: b-side — Digest → Read-Model Context Channel
stage: analyzed
effort: large
campaign: the-b-side-polish
source: owner-uat
shippedNote: "A LEAN precursor (basic archive_context capture) shipped in sprint-36; the full structured per-round payload described here remains unbuilt."
summary: >-
  Today the b-side read-model derives ENTIRELY from structured vote/submission data
  — it never reads digest narrative (verified), so the context an operator crafts
  during digest generation cannot shape the b-side. Owner's design: have digest
  generation emit a structured, NON-PUBLISHED per-round "archive context" payload —
  round dynamics, notable pick/vote events, operator steer/intent, and a "what came
  before" summary (the digest gen may already build some of this) — stored alongside
  the digest but never shown in the published digest. The read-model generators
  (superlatives, moments, fan/hater blurbs) then consume it as additional input.
  This is the bridge that lets operator/digest context flow into the b-side and the
  enabler for bside-temporal-aware-generation and richer bside-moments-chat-mined.
  Cross-cuts the digest pipeline + the read-model generators.
---
id: bside-temporal-aware-generation
title: b-side — Sequence-Aware (Temporal) Generation
stage: planned
effort: large
campaign: bside-season-awareness
sprint: S2
source: owner-uat
summary: >-
  The read-model currently treats the season as an unordered bag — generators get
  whole-season aggregates with no round sequence (verified) — so the b-side can't
  distinguish a round-1 "still learning the game" downvote from a later revenge
  downvote (owner's example). Make generation sequence-aware by consuming the ordered
  per-round context from bside-digest-context-channel (each round's note inherently
  carries "what came before"), so superlatives / moments / fan-hater can reason about
  WHEN something happened and how the season evolved. Depends on
  bside-digest-context-channel.
---
id: openrouter-model-management
title: OpenRouter Model Management (table + lookup + default)
stage: shipped
shippedIn: sprint-38-ai-model-management (v1.5.0/v1.5.1)
effort: medium
spike: model-cost-infra
source: owner
campaign: ai-model-management
summary: >-
  Replace the scattered env-var model config (OPENROUTER_DIGEST_MODEL,
  OPENROUTER_PREDICT_MODEL, hardcoded defaults) with a backend model table. Paste an
  OpenRouter model id (copied from openrouter.ai) → look it up via the OpenRouter
  models API (GET /api/v1/models) → store + verify capabilities (context length,
  prompt/completion pricing, modality, tool/JSON support) so we never set a model
  that lacks what a call needs. Set ONE model as the default for all calls. Settings
  UI to be mocked by Claude Design. Immediate stopgap already applied 2026-06-15:
  switched digest + predict to anthropic/claude-haiku-4.5 to stop ~$0.18/digest
  spend during testing (restore to Sonnet for maintenance-mode runs).
---
id: per-section-model-selection
title: Per-Section Model Selection
stage: shipped
shippedIn: v1.7.0
effort: medium
spike: model-cost-infra
source: owner
campaign: openrouter-cost-management
sprint: sprint-41-per-section-models
summary: >-
  Build on openrouter-model-management: let each content section (digest sections,
  b-side read-model sections) optionally pin its own model, falling back to the
  global default. So we can run cheap models for boilerplate sections and a high-end
  model only where it matters. Depends on openrouter-model-management.
---
id: model-quality-signal
title: Model quality signal (implicit regen and edit, optional rating)
stage: idea
effort: medium
spike: model-cost-infra
source: orc-proposal
summary: >-
  Capture a quality KPI for LLM outputs so model comparison can weigh quality
  alongside cost and latency. Not built today; cost-management v1 ships with cost
  and latency only. Preferred cheap path: derive an implicit signal from data we
  already capture (regeneration count plus section edit or exclude before finalize,
  where low regen equals good), optionally plus a manual owner thumbs or stars per
  generated section. LLM-as-judge is a later opt-in (adds spend, uncertain
  reliability). Also consider reliability (JSON-mode and parse success plus retry
  rate) as a free automatic companion metric. Fills the third KPI slot in the
  per-model-per-task comparison and the weighted value score.
---
id: models-cost-tier-display-bug
title: Models cost-tier display bug (every model shows one dollar sign)
stage: shipped
shippedIn: v1.6.0
effort: small
spike: model-cost-infra
source: owner-uat
campaign: openrouter-cost-management
sprint: sprint-39-cost-ledger
summary: >-
  In the Models and AI roster, every model's cost tier renders as a single
  dollar sign regardless of price, so an expensive model (Opus, Sonnet) looks
  the same as a cheap one. Root cause: tierFromPricing in ui/src/lib/models/
  qualify.ts compares against per-million-token thresholds (1 and 10 USD) but is
  passed the raw per-token decimals stored in the DB (e.g. 0.000003), so the
  average is always below the lowest threshold. Fix by converting per-token to
  per-million at the call sites (multiply by 1e6) in qualify.ts and the two
  ModelsScreen render spots; the same units bug affects the "$X/M in" price
  label. Carryover from sprint-38; bundled into the cost ledger sprint.
---
id: openrouter-cost-tracking
title: OpenRouter Cost Tracking (per-call ledger)
stage: shipped
shippedIn: v1.6.0
effort: medium
spike: model-cost-infra
source: owner
priority: urgent
campaign: openrouter-cost-management
sprint: sprint-39-cost-ledger
summary: >-
  Record every OpenRouter call to a ledger: model, prompt/completion tokens, cost
  (from the OpenRouter usage/cost in the response), purpose (digest vs archive/b-side
  + which section), league/round, timestamp. The data layer behind the debug cost
  dashboard. Owner can't afford blind spend during testing — this makes spend visible.
---
id: llm-usability-delight-capture
title: LLM Usability and Delight Event Capture
stage: shipped
shippedIn: v1.9.0
effort: medium
spike: model-cost-infra
source: owner
priority: high
campaign: openrouter-cost-management
sprint: sprint-42-usability-capture
summary: >-
  The UI-side half of the third KPI. Sprint-39 lays the schema and the passive,
  can't-backfill fields; this captures the human-action outcomes from controls that
  already exist plus one new control: digest inline-edit (salvaged + edit distance),
  regenerate/skip (rejected), finalize untouched (passed), a thumbs-up on a standout
  line (delight), and quarantined availability/capability failures (health events,
  kept out of the usability score). Digest reaches the full passed-salvaged-rejected-
  unusable ladder; prediction and b-side reach passed/rejected/unusable only. No
  evaluator and no AI judge — that is a later stage. Runs after sprint-39, before the
  sprint-40 dashboard surfaces any of it.
---
id: settings-debug-mode-cost-dashboard
title: Settings Debug Mode + Cost Dashboard
stage: shipped
shippedIn: v1.8.0
effort: medium
spike: model-cost-infra
source: owner
priority: urgent
campaign: openrouter-cost-management
sprint: sprint-40-cost-dashboard
summary: >-
  A debug-mode toggle on the Settings page that reveals debug-only UI. First widget:
  today's total OpenRouter cost split by digest vs archive, a drilldown listing the
  individual calls (what each was for), and a 2-week chart — stacked bar per day made
  of digest calls + archive calls in two base colors, with each individual call a
  different shade of its base color and a hover tooltip naming the section per shade.
  Depends on openrouter-cost-tracking; Claude Design to mock the UI.
---
id: vote-forfeiture-rule
title: Model the "failed to submit votes" forfeiture rule
stage: analyzed
effort: medium
source: owner-uat (RCA-confirmed 2026-06-15)
summary: >-
  Music League rule: if a player fails to submit their votes for a round, they get
  0 pts that round AND the votes cast FOR them are wasted/forfeited. RCA confirmed
  the app does NOT model this — standings.ts LEFT JOINs votes, so a non-submitting
  player's song still accumulates votes normally; no penalty, no forfeiture, no
  wasted-vote tracking anywhere. Affects standings, top/bottom, fan/hater, and digest
  content accuracy. Live example: jac, Second Best R4 (REO Speedwagon) failed to
  submit votes. Needs: detect non-submission, zero the player, and void votes for
  them in scoring. Verify against Music League's exact rule first.
---
id: digest-consensus-field-robustness
title: Digest — Consensus section field-name robustness
stage: shipped
shippedIn: consolidated into digest-consensus-note-field (resolved 2026-06-16)
consolidatedInto: digest-consensus-note-field
effort: small
source: owner (hit live 2026-06-15)
summary: >-
  The digest LLM sometimes emits consensus items as {submission, agreement} but the
  renderer (DigestSection.svelte consensusHeadline/consensusNote) only reads
  {title/song/point/statement} + {note/detail/body}. On a mismatch every item is
  empty and the section dumps the RAW JSON object onto the published page (hit live
  on round 134's digest, slug 7RrFR_pukBsyfxL7). Fix both ends: (a) make the renderer
  tolerant — accept submission→headline, agreement→note, and NEVER dump raw JSON
  (graceful fallback); (b) pin the field names in the digest prompt/schema so the LLM
  emits {song, note} consistently. Part of the structured-output reliability work.
---
id: digest-exclude-section-button-bug
title: Digest — "exclude from final digest" button doesn't persist
stage: analyzed
effort: small
source: owner (hit live 2026-06-15)
summary: >-
  The per-section "exclude from final digest" control did not set the section state
  to 'excluded' — round 134's consensus section stayed state='default' despite the
  click, so the operator could not remove a broken section without DB access. Repro +
  fix the exclude action (PATCH digest_sections.state) and confirm excluded sections
  are dropped from draft/finalize/export and the published HTML.
---
id: digest-archive-link-review
title: Digest → b-side archive link (review + dead-link bug)
stage: idea
effort: small
source: owner (2026-06-15)
summary: >-
  The published digest page (digest.mattmariani.com/d/<slug>) links out to the
  league's b-side archive. Two things: (a) decide whether we even WANT that link on
  a shared digest (owner unsure — "leave it for now"); (b) it can be a DEAD link —
  on the round-134 digest just shared to the group, the archive link was dead.
  Audit when/whether to show it and ensure it never renders dead (gate on the league
  being published + a valid archive slug).
---
id: round-phase-model-and-action-center
title: Round Phase Model + Operator Action Center
stage: planned
shippedNote: "PHASE-MODEL half SHIPPED in sprint-34 (v1.2.0). This card now tracks the REMAINING half — the operator Action Center."
effort: large
source: owner (2026-06-15)
summary: >-
  Two-ended feature. (1) Make round PHASE an explicit STORED field on rounds
  (not-started | submission | voting | complete), advanced by "End Submission" /
  "End Voting" buttons; demote deadlines to informational + soft pre-fills; stop
  prep-checks hard-blocking on deadlines. Replaces today's fragile deadline+clock
  derivation (lifecycle.ts getRoundPhasesForSeason) which walks rounds by id order
  and silently flips a round to "archive" the instant its voting deadline passes —
  exactly when the content loop should begin. (2) Add an operator ACTION CENTER on
  the mlbot landing page: a notification/todo panel rendered from data-authored
  cards (YAML templates -> JSON runtime instances) that can stand alone or roll up
  into bundles. The "End Voting" button becomes a trigger that emits a content-todo
  card (generate digest -> update archive -> share card). Phase model is the trigger;
  Action Center is the surface. Full card schema + design captured in the vault note
  round-phase-and-action-center-spec.md.
notes: >-
  Sequencing RATIFIED: build phase-first STANDALONE (not bundled into
  active-league-management) — the rounds.phase column is additive; this card
  de-scopes the active-round-truth piece + the activeRound/lifecycle rewrite from
  active-league-management. Action-Center half is net-new. Parallels orc-tower's own
  operator-surfaces-control-affordances card (orc-tower mailbox notification center)
  but is mlbot-specific. RATIFIED (2026-06-15): author YAML / JSON runtime; v1
  schema cut as-proposed; instance persistence = HYBRID (YAML template files +
  SQLite cards table); End-Voting auto-prefills next deadline; escalation
  confirmed; read/snooze/complete confirmed; Web Push = v2. Fully ratified.
  PROGRESS: the PHASE-MODEL half SHIPPED in sprint-34 (v1.2.0, 2026-06-16) —
  stored rounds.phase + End Submission/End Voting buttons + stored-phase-
  authoritative active-round resolution + deadlines demoted. REMAINING: the
  Action Center half (cards table + reactive resolver + escalation + landing-
  page panel + End-Voting→digest-todo trigger) → on-deck sprint-35.
jobs:
  - "Schema: add rounds.phase column (not-started|submission|voting|complete) + migration; backfill from current deadline-derived phase."
  - "Phase transitions: End Submission / End Voting buttons + API. End-Submission modal = editable end-timestamp + Accelerated (keep voting deadline) vs Speedy (shift +N days, prefill N=3). End-Voting completes the round + can prefill next round's submission deadline."
  - "Make phase the source of truth: rewrite activeRound/lifecycle to read stored phase; keep deadline derivation only as fallback/suggestion; deadlines become informational; prep-checks no longer hard-block on deadlines."
  - "Action Center data model: implement the card/bundle schema (identity/type/trigger/style/content/features/state + escalation + push); author as YAML template files, validate via loader."
  - "Action Center persistence (HYBRID, ratified): templates as YAML files; live instances in a SQLite cards table (hot cols status/severity/scope/dedupe_key + JSON payload). Emit = upsert on dedupe_key. v1 resolver closes cards REACTIVELY by scope+type when a digest finalizes+archives (no predicate engine) and applies escalation steps by fired_at age."
  - "Action Center UI: landing-page notification/todo panel rendering cards + bundles (variants, severity sort, read/snooze/complete/dismiss, checkbox/checklist, actions). No in-frontend bundle builder — bundles are data-authored."
  - "Content-loop trigger: End-Voting emits a content-todo card (generate digest -> update archive -> share) scoped to the round; auto-resolves when the digest is finalized + archived. End-Voting auto-prefills next round's submission deadline (ratified) — must guard the duplicate-round trap."
  - "[v2] Web Push: mlbot is already an HTTPS PWA — add service worker + VAPID keys + per-device push-subscription store + server sender; emit (and escalation repush) fires a Web Push that deep-links to the mobile action. Deferred to v2 (after the in-app Action Center)."
gaps:
  - "Duplicate-round trap: auto-prefilling the next submission deadline must not recreate the manual-vs-import two-row split."
  - "Coordination: keep the rounds.phase migration compatible with active-league-management's planned FK migration (this card de-scopes the active-round-truth piece from it)."
---
id: digest-round-aware-context
title: Digest — Round-Aware Cross-Round Context (ghost fix)
stage: shipped
effort: medium
source: owner (2026-06-16)
shipped: 2026-06-16
shippedIn: sprint-35
followUp: "Optional: scrub old contaminated rel-context snapshots. Not required — bundle-cite-only prompt discipline already overrides dirty snapshots (verified on R3 regen)."
summary: >-
  Fix the digest's cross-round accuracy bug (the "ghost"): regenerating an old
  round's digest cites FUTURE-round songs/people as "last round" (e.g. an R3
  digest cited R5's "Cottonfield Blues" + "Johnny Lang"). RCA RESOLVED — the
  deterministic chronology is already correct (priorRounds is slice(0,seqIdx)
  ordered by round_number; a chronology block already forbids forward refs); the
  SOLE leak is the league-level relationship_contexts blob (PRIMARY KEY league_id,
  one forward-accumulated row) injected raw at llm.ts:168/424. Regenerating R3
  after R6 reads the post-R6 blob, so future narrative is right there to miscite.
  Approach C (hybrid, owner-ratified 2026-06-16): (1) build a DETERMINISTIC
  per-round factual bundle that owns ALL cross-round citations — per prior round
  {round_number, name, top3 (song·submitter·pts), bottom1, winner}, scoped to the
  season and ordered, prev/current flagged; (2) KEEP the narrative blob but scope
  it to <= current round (snapshot per round / key by round_number, never the live
  latest); (3) tighten the prompt so every cross-round reference cites the bundle
  only — ghosts kept but bundle-cite-only, forward refs forbidden. Foundation for
  the b-side cards (bside-digest-context-channel / bside-temporal-aware-generation).
notes: >-
  Owner quality bar for first-share content: <=1-2 minor errors, 0 major, >=2
  compelling sections. Verify by REGENERATING the R3 "villain" section (Second
  Best, season 8) and confirming no future-round (R4-R6) attributions. Narrative
  read-model context CHANNEL (the accumulating distilled-threads layer) stays the
  separate bside-digest-context-channel card; this card only scopes the existing
  blob + adds the factual bundle. Entity/round-numbering cleanup (r-111 global ids)
  tracked in parallel via bside-season-round-truth / active-league-management.
  Quality-gate auto-lint deferred (quality_gate=later). Design: vault brainstorm
  2026-06-15-digest-cross-round-context-bundle.md (RCA + decisions captured).
jobs:
  - "Deterministic cross-round bundle: build a per-round factual bundle in llm.ts generation — for each round with round_number <= current, {round_number, name, top3 (song·submitter·points), bottom1, winner}, ordered, prev/current flagged. Replaces the thin priorRounds {number,name} as the cross-round fact source."
  - "Scope the narrative blob to <= current round: stop feeding the live league relationship_contexts blob into an old round's (re)generation. Read the round-scoped version instead (per-round snapshot via digest_drafts.rel_context, and/or key/filter narrative to rounds <= current). First-gen still uses current; regen of round N uses the N-era context."
  - "Prompt tightening: every cross-round reference must cite the bundle; forbid forward references and invented callbacks; keep the ghost/callback voice but bundle-cite-only. Update the chronology + relationship-context prompt sections in llm.ts."
  - "Tests: unit-cover the bundle scoping (round N bundle contains only rounds <= N), the rel-context scoping (regen of an early round does NOT see later-round narrative), and a regression for the R3-cites-R5 ghost."
  - "Verification artifact: regenerate the R3 villain section (Second Best s8) and produce a before/after for owner review against the quality bar (no R4-R6 attributions)."
gaps:
  - "Decide the exact rel-context scoping mechanism in-build: per-round snapshot (digest_drafts.rel_context already exists) vs keying relationship_contexts by (league, round_number). Snapshot is smaller; keyed is cleaner for regen-correctness."
  - "Backfill/regeneration: existing per-league blobs are already future-contaminated — regenerating old rounds needs the scoped path to avoid re-poisoning; may need a one-time reset or per-round reconstruction."
  - "The narrative threads/continuity layer (recurring jokes carried forward) is only minimally touched here; the full accumulating channel is bside-digest-context-channel."
---
id: digest-consensus-note-field
title: "Digest bug: consensus section drops the note (only song shows)"
stage: shipped
shippedIn: "code RESOLVED 2026-06-16 (DigestSection.svelte consensusNote + ChatMoments + SectionInlineEditor; 35 tests pass); deployed in the next prod build"
effort: small
source: owner (2026-06-16)
summary: >-
  The consensus ("Locked In") section renders only each item's song headline —
  the per-item explanation text is dropped. Recurs every digest (seen on r-119
  and the prior digest). Root cause: the LLM emits consensus items as
  {song, agreement}, but consensusNote() in
  ui/src/lib/digest/DigestSection.svelte (~line 155) only reads
  x.note ?? x.detail ?? x.body — never x.agreement — so the note resolves to ''
  and nothing renders below the song. consensusHeadline() reads x.song fine,
  hence "only the song data displays." Inline-edit shows the text because the
  raw content_json does carry the agreement field; it just never reaches render.
notes: >-
  One-line fix: add x.agreement to the consensusNote() fallback chain in
  DigestSection.svelte (consider also pinning the consensus item shape in the
  prompt / SECTION_DESCRIPTIONS so the key is stable across drafts). Interim
  (ratified by owner 2026-06-16): finalize the r-119 digest as-is; orc patches
  the exported HTML by hand (as done for the previous digest). Verify by
  finalizing a digest with a consensus section and confirming the note renders
  in both the in-app view and the export.
  SECOND INSTANCE (same class): chat-section "moments" render title-only when the
  LLM emits a moment's body under "description" instead of "detail" — ChatMoments
  reads only "detail" (seen on r-119 "The Digest App Premieres" moment, hand-fixed
  in the draft content_json). Broaden the fix: make BOTH consensusNote() and the
  chat ChatMoments renderer tolerant of field-name variation (detail/description/
  note/body/agreement), and/or pin the item shapes in the prompt.
  RESOLVED (code) 2026-06-16 — IMPLEMENTED + UI-verified against a prod build:
  consensusNote() now falls back to x.agreement (DigestSection.svelte); ChatMoments
  normalizes detail ?? description; SectionInlineEditor generalized to edit ALL
  top-level string fields (title/summary/…) AND array fields (items/moments/…) —
  which also fixes chat-section inline edit. svelte-check 0 errors, 35 digest tests
  pass. Pending the next orc-gated prod deploy to go live; the already-published
  r-119 share HTML was hand-patched separately so no re-export is needed for it.
---
id: bside-season-update-section
title: b-side — Season-Update section (season pulse)
stage: shipped
effort: medium
campaign: bside-season-awareness
sprint: S2
source: owner (2026-06-16)
shipped: 2026-06-16
shippedIn: sprint-37 (v1.4.0)
followUp: "Capability live; no real Season-Update is on a public prod b-side yet (dev sample was for voice review only). Publishing one = regenerate a league's digest in prod via the shipped snark dial — owner-gated content action, natural at the next round's digest flow."
summary: >-
  New regenerated-wholesale "season pulse" block on the b-side, placed BELOW the
  standings: an editorial read of what stands out about the season as of the latest
  digest — surging/falling players (standings deltas + multi-week streaks),
  discovery-behavior shifts (tastemaker obscure<->radio drift), rivalries (reciprocal
  downvotes — deterministic in our data — spot-trading, chat barbs), and the tension
  into the next round. A deterministic season-signals engine computes the facts in
  code; the LLM only narrates them (no hallucinated movement). Voice: funny/fact-based
  strife, never cruel; safe targets (Matt/Mara/Jordan); punching-bag guard; operator
  snark dial (default medium); forward-look may name artists but NOT songs. Regenerates
  on every b-side update; stores the narrative + a SeasonSignals snapshot. Capstone of
  the bside-season-awareness campaign (S2); consumes the S1 temporal read-model +
  season-signals engine + lean digest channel. Folds in bside-returning-visitor-diff
  ("what's new") as the section lede. Design:
  docs/superpowers/specs/2026-06-16-bside-season-awareness-design.md.
---
id: bside-public-deploy-cdn-bundle-stale
title: "b-side public deploy: stale CDN bundle (no purge / no versioning)"
stage: analyzed
effort: small
source: orc (2026-06-17)
summary: >-
  The public b-side (digest.mattmariani.com, Cloudflare in front of the
  digest-static Caddy) serves a SHARED, fixed-name SPA bundle at
  /_bside/bside.js + bside.css with a 4h Cloudflare edge cache (cache-control
  max-age=14400, cf-cache-status HIT). The publish/deploy step copies a freshly
  built bundle into digests/_bside/ but does NOTHING to bust the CDN, so any
  bside CODE change (e.g. the v1.4.0 Season-Update HomeScreen section) is
  invisible to the public until the 4h cache expires — even though the origin
  (local Caddy :8088) and the per-slug index.html + read_model.json (both
  cf-cache-status DYNAMIC / uncached) are already correct. Surfaced 2026-06-17
  when the v1.4.0 deploy rebuilt the bot-ui operator container but the public
  bside bundle stayed at the Jun-15 build behind the cache. Fix options: (a)
  content-hash the bundle filename (bside.[hash].js) in bside/vite.config so each
  build is a new URL — index.html already regenerates per publish so it would
  reference the new name, sidestepping the cache entirely (preferred, durable);
  or (b) add a Cloudflare cache-purge call (API token + zone id) to the deploy
  step for /_bside/*. Also: the v1.4.0 "deploy" runbook should include rebuilding
  + shipping the public bside bundle, not just the bot-ui container.
---
id: generation-pipeline-core
title: Generation Pipeline (core)
stage: shipped
shippedIn: v1.10.0
effort: large
source: owner
campaign: generation-pipeline
sprint: sprint-43-pipeline-core
summary: >-
  Replaced the single hard-coded digest call with a configurable pipeline (EPs,
  skips, merge, prior-EP context). Per-section model pins now bind on the initial
  draft; regression-guarded so a no-skip single-model pipeline equals the prior call.
---
id: pipeline-covers-ab-review
title: Pipeline Covers and A/B Review
stage: shipped
shippedIn: v1.11.0
effort: medium
source: owner
campaign: generation-pipeline
sprint: sprint-44-covers-ab-review
summary: >-
  Covers (re-run a section later on a better model with prior context) + a cover A/B
  review surface in the digest flow + an llm_preference table logging each pick as a
  head-to-head model-preference signal. Default pipeline covers Flow on Sonnet.
---
id: archive-pipeline
title: Archive (b-side) Pipeline
stage: shipped
shippedIn: v1.13.0
effort: large
source: owner
campaign: generation-pipeline
sprint: sprint-46-archive-pipeline
summary: >-
  Extended the generation pipeline to b-side archive generation: buildReadModel now runs
  an archive pipeline (order + skip/context + covers + per-task model), with a digest/archive
  switcher on the Pipeline tab. No merge (b-side tasks are heterogeneous — each its own call);
  regression-guarded so the degenerate archive pipeline reproduces today's b-side generation.
---
id: pipeline-config-ui
title: Pipeline Config UI
stage: shipped
shippedIn: v1.12.0
effort: medium
source: owner
priority: high
campaign: generation-pipeline
sprint: sprint-45-pipeline-config-ui
summary: >-
  A UI to view and edit the shared generation pipeline without touching code or the
  DB — section order, per-section model, skip placement, and covers — writing the same
  pipeline_config the resolver reads. Owner explicitly needs to use the pipeline without
  coding. Per-league profiles remain a later extension.
---
id: pipeline-recoup-budgeting
title: "Pipeline Recoup: per-Release budgeting"
stage: idea
effort: large
source: design
campaign: generation-pipeline
summary: >-
  v2. A per-Release spend budget evaluated at each skip (a natural checkpoint): pick the
  best model the remaining budget affords for the next EP. Open decisions: reserve rule,
  re-plan on overrun, per-league vs global. Depends on the v1 pipeline.
---
id: per-league-pipeline-profiles
title: Per-League Pipeline Profiles
stage: idea
effort: medium
source: design
campaign: generation-pipeline
summary: >-
  v2. Saved pipelines (Thrifty / Balanced / Showcase) assignable per league. A profile is
  a saved pipeline, so this is additive once the config UI exists. Subsumes the earlier
  model-to-section profiles idea.
---
id: pipeline-feature-duets
title: "Pipeline Feature: duet sections"
stage: idea
effort: large
source: design
campaign: generation-pipeline
summary: >-
  Explore. A second model co-appearing in one section (a duet), vs Cover which just picks
  the better single take. Needs a content-format decision + proof it beats Cover. Parked
  until a concrete creative use justifies it.
