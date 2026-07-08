# League Research Tab — Design

**Date:** 2026-07-07
**Status:** Approved design, pending implementation plan

## Overview

A new fourth tab on the `/history` screen — **League research** — that acts as a
playground of "that's kinda cool" visuals over a **single league** at a time.
Where the existing history tabs (Song search, Theme research, Player research)
are deliberately whole-corpus (aggregating across every league via the stable
`player_id`), this tab is scoped to one league so relational and trend visuals
stay legible. It never mixes people who were never in the same league.

The origin was a basic CSV-to-dashboard reference project (DuckDB + Streamlit).
We are porting only a few of its *analytical concepts* — not its stack — and
fusing them with the song-level enrichment this app already has
(`popularity_proxy`/obscurity, librosa audio features, Last.fm genre tags) that
a plain Music League export does not carry.

Digest integration is explicitly **not** part of this work (see Out of Scope).

## Scope model

The tab operates on **one league at a time**, chosen via controls at the top:

- **League selector** — dropdown of all leagues; defaults to the active league.
- **Season filter** — `All seasons` (default) or a single season within the
  chosen league.

Every visual below reacts to these two controls. All player sets are drawn from
the chosen league's roster only.

## The three visuals

### #1 — Directional points heatmap

A matrix where **rows = voters** and **columns = submitters** (the league
roster), each cell showing the relationship from voter → submitter within the
current scope. Self-cells (voter voting on their own submission) are blank.

A **mode toggle** above the grid switches what the cell encodes:

- **`Points`** (default) — cell brightness = total points that voter gave that
  submitter. Reveals blocs, alliances, one-way admiration, quiet rivalries.
- **`Obscurity` / `Energy` / `Era`** — cell = the **points-weighted average** of
  that attribute across the songs the voter rewarded that submitter for. This
  answers "does A reward B *specifically* for obscure (or high-energy, or old)
  picks?" Attribute sources: obscurity = `100 − song_popularity.popularity_proxy`;
  energy = `song_audio_features.energy`; era = release era (derived from
  available metadata; if release year is unavailable for a song it is excluded
  from that cell's average).

Each cell has a tooltip showing the raw underlying numbers (total points, song
count, and the attribute value driving the current mode).

### #5 — Obscurity drift

A line chart tracking whether the league trends more obscure or poppier over
time.

- **x-axis** — rounds in chronological order. Under `All seasons` the timeline
  spans every season; season boundaries are marked on the axis. Under a single
  season, only that season's rounds appear.
- **y-axis** — obscurity (`100 − popularity_proxy`).
- **Line A** — league **median obscurity** of each round's submissions.
- **Line B** — obscurity of each round's **winning** song (the top-scoring
  submission that round).

Reading the two lines together shows both the league's drift and whether obscure
songs actually win.

### #3 — Genre radar

A per-player spider chart contrasting the genres a player **submits** with the
genres they **vote for**.

- A **player picker** (league roster) selects the subject.
- **Axes** — the top ~8 genres in the chosen league, computed from
  `song_popularity.tags` (Last.fm, already stored as a top-5 tag array per song).
  Rarer tags fall outside the axes and are ignored.
- **Polygon A** — distribution of genres across the songs the player submitted.
- **Polygon B** — genres of the songs the player gave points to, **points-weighted**.

Overlaying the two surfaces mismatches like "submits indie, votes pop."

## Data flow & rendering

- **Server module:** new `ui/src/lib/db/leagueResearch.ts` with three query
  functions (interactions matrix, obscurity drift series, genre profile), each
  taking a `leagueId` and optional `season`.
- **Routes:** new endpoints under `ui/src/routes/api/history/league/[leagueId]/`:
  - `GET .../interactions?season=` → voter×submitter cells with per-cell points,
    song count, and per-attribute weighted averages.
  - `GET .../obscurity-drift?season=` → ordered round series with median-submission
    and winning-song obscurity, plus season boundary markers.
  - `GET .../genre-profile?player=&season=` → league genre axes + the selected
    player's submit and vote distributions.
- **League/season list:** a small endpoint feeds the two selectors (reuse an
  existing leagues-list endpoint if one exists; otherwise add one).
- **Rendering:** hand-rolled **SVG Svelte components**, matching the existing
  convention (`StandingsChart.svelte`, the taste-waveform engine). No new
  charting dependency is introduced.
- **Tab shell:** `LeagueResearchTab.svelte` added as the fourth tab in
  `ui/src/routes/history/+page.svelte` (tab key `league`), with the three visuals
  as collapsible sections like `PlayerResearchTab.svelte`.

## Risks & notes

- **Genre tag vocabulary is messy.** Last.fm tags are free-form; the top-8
  per-league axis selection is a deliberate simplification. Expect to iterate on
  normalization (casing, near-duplicates like "hip hop"/"hip-hop") once we see
  real output.
- **Era depends on release year**, whose coverage is partial. The era mode and
  any era axis must degrade gracefully when a song lacks a year (exclude, don't
  zero).
- **Heatmap size is bounded** by a single league's roster, so sparsity is not a
  concern the way a corpus-wide matrix would be.

## Out of scope (for now)

- Digest integration / "flag for digest" — deferred until we see which visuals
  land.
- League superlatives (a version already exists in the app).
- Voting-by-playlist-position — depends on a playlist-position backfill
  (position is recoverable from the Spotify playlist order but not currently
  stored); deferred.
