# Changelog

All notable changes to the Music League Bot webapp are documented here.
Format loosely follows [Keep a Changelog](https://keepachangelog.com/);
versions track `ui/package.json` and render in the app footer (`mash co. · vX.Y.Z`).

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
