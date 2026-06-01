# Changelog

All notable changes to the Music League Bot webapp are documented here.
Format loosely follows [Keep a Changelog](https://keepachangelog.com/);
versions track `ui/package.json` and render in the app footer (`mash co. · vX.Y.Z`).

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
