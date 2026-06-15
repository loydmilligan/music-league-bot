# Music League Web UI — Design Spec

**Date:** 2026-05-14  
**Status:** Approved for planning

---

## Overview

A personal web dashboard for browsing Music League seasons, reviewing round results, managing a WhatsApp-captured "all songs" master playlist, and conducting per-round song research before submitting. Built for two users (no in-app auth — Cloudflare Access handles that externally).

---

## Tech Stack

| Layer | Choice |
|---|---|
| Frontend + API | SvelteKit (full-stack, server routes) |
| Database | SQLite — new `data/league.db`, separate from existing `data/submissions.db` |
| Container | Docker, added to existing `docker-compose.yml` |
| Remote access | Cloudflare tunnel (user-managed, external to this app) |
| Spotify integration | Reuse existing `SpotifyAdapter` |
| YouTube Music links | Songlink/Odesli API (already in codebase) |

The SvelteKit app is one new Docker container. It mounts the same `data/` volume as the bot so it can read `submissions.db` and write `league.db`.

---

## Data Sources

### Music League ZIP exports
Each ZIP contains four CSVs:
- `rounds.csv` — `ID, Created, Name, Description, Playlist URL`
- `submissions.csv` — `Spotify URI, Title, Album, Artist(s), Submitter ID, Created, Comment, Round ID, Visible To Voters`
- `votes.csv` — `Spotify URI, Voter ID, Created, Points Assigned, Comment, Round ID`
- `competitors.csv` — `ID, Name`

ZIPs are stored at `data/<league-slug>/season-<n>/export.zip`. The app imports from these on startup and via a manual re-import trigger in the admin UI. In-progress seasons have incomplete data (empty rounds/submissions); the app handles this gracefully.

### WhatsApp submissions DB (`data/submissions.db`)
The existing bot writes auto-captured chat mentions here. The UI reads it as a secondary read-only source — never writes to it.

### Songlink API
Used to resolve Spotify URIs → YouTube Music links on demand. Results are cached in `league.db` to avoid repeated lookups.

---

## Leagues

| Slug | Name | Special behavior |
|---|---|---|
| `hip-jammers` | Hip Jammers | — |
| `fam-jam` | Fam-Jam | — |
| `second-best` | Second Best | — |
| `nostalgia-pit` | Nostalgia Pit | `exclude_from_combined = true`. One band per round. Songs from this league are excluded from the "All Songs Ever" master list and from any combined playlists. |

League metadata (slugs, names, exclusion flags) is seeded from a config at startup rather than entered through the UI.

---

## Database Schema (`league.db`)

```sql
CREATE TABLE leagues (
  id                    INTEGER PRIMARY KEY,
  slug                  TEXT UNIQUE NOT NULL,
  name                  TEXT NOT NULL,
  exclude_from_combined INTEGER NOT NULL DEFAULT 0,  -- boolean
  notes                 TEXT
);

CREATE TABLE seasons (
  id             INTEGER PRIMARY KEY,
  league_id      INTEGER NOT NULL REFERENCES leagues(id),
  season_number  INTEGER NOT NULL,
  status         TEXT NOT NULL CHECK(status IN ('active', 'complete')),
  UNIQUE(league_id, season_number)
);

CREATE TABLE rounds (
  id                   INTEGER PRIMARY KEY,
  season_id            INTEGER NOT NULL REFERENCES seasons(id),
  ml_round_id          TEXT UNIQUE NOT NULL,  -- ID from rounds.csv
  name                 TEXT NOT NULL,
  description          TEXT,
  spotify_playlist_url TEXT,
  created_at           TEXT NOT NULL,
  UNIQUE(season_id, ml_round_id)
);

CREATE TABLE competitors (
  id               INTEGER PRIMARY KEY,
  ml_competitor_id TEXT UNIQUE NOT NULL,
  name             TEXT NOT NULL
);

CREATE TABLE ml_submissions (
  id                  INTEGER PRIMARY KEY,
  round_id            INTEGER NOT NULL REFERENCES rounds(id),
  competitor_id       INTEGER NOT NULL REFERENCES competitors(id),
  spotify_uri         TEXT NOT NULL,
  title               TEXT NOT NULL,
  album               TEXT,
  artists             TEXT NOT NULL,
  comment             TEXT,
  created_at          TEXT NOT NULL,
  visible_to_voters   INTEGER NOT NULL DEFAULT 0,
  UNIQUE(round_id, spotify_uri, competitor_id)
);

CREATE TABLE votes (
  id             INTEGER PRIMARY KEY,
  round_id       INTEGER NOT NULL REFERENCES rounds(id),
  voter_id       INTEGER NOT NULL REFERENCES competitors(id),
  spotify_uri    TEXT NOT NULL,
  points         INTEGER NOT NULL,
  comment        TEXT,
  created_at     TEXT NOT NULL,
  UNIQUE(round_id, voter_id, spotify_uri)
);

CREATE TABLE research_songs (
  id                      INTEGER PRIMARY KEY,
  round_id                INTEGER NOT NULL REFERENCES rounds(id),
  spotify_uri             TEXT NOT NULL,
  title                   TEXT NOT NULL,
  artist                  TEXT NOT NULL,
  album                   TEXT,
  added_at                TEXT NOT NULL,
  notes                   TEXT,
  theme_fit               INTEGER CHECK(theme_fit BETWEEN 1 AND 5),
  discovery_potential     INTEGER CHECK(discovery_potential BETWEEN 1 AND 5),
  nostalgia_potential     INTEGER CHECK(nostalgia_potential BETWEEN 1 AND 5),
  personal_rating         INTEGER CHECK(personal_rating BETWEEN 1 AND 5),
  save_for_future         INTEGER NOT NULL DEFAULT 0,
  submitted_by_me         INTEGER NOT NULL DEFAULT 0,
  submitted_by_other      INTEGER NOT NULL DEFAULT 0,
  other_submission_votes  INTEGER,
  UNIQUE(round_id, spotify_uri)
);

CREATE TABLE ytm_link_cache (
  spotify_uri   TEXT PRIMARY KEY,
  ytm_url       TEXT,
  resolved_at   TEXT NOT NULL
);

CREATE TABLE ytm_resolution_queue (
  id           INTEGER PRIMARY KEY,
  spotify_uri  TEXT NOT NULL UNIQUE,
  title        TEXT,
  artist       TEXT,
  status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK(status IN ('pending', 'processing', 'done', 'failed')),
  error        TEXT,
  queued_at    TEXT NOT NULL,
  resolved_at  TEXT
);

CREATE TABLE import_log (
  id              INTEGER PRIMARY KEY,
  league_slug     TEXT NOT NULL,
  season_number   INTEGER NOT NULL,
  filename        TEXT NOT NULL,
  imported_at     TEXT NOT NULL,
  rounds_count    INTEGER NOT NULL DEFAULT 0,
  submissions_count INTEGER NOT NULL DEFAULT 0,
  votes_count     INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL CHECK(status IN ('success', 'partial', 'error')),
  error           TEXT
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- Seeded with defaults:
-- weight_discovery = 35
-- weight_theme_fit = 25
-- weight_personal  = 25
-- weight_nostalgia = 15
```

The `rounds` table also gains a `submission_deadline TEXT` and `voting_deadline TEXT` column (nullable ISO timestamps, manually entered via Settings).

---

## Scoring Formula

Research songs get a computed weighted score displayed on each card:

| Dimension | Weight |
|---|---|
| Discovery Potential | 35% |
| Theme Fit | 25% |
| Personal Rating | 25% |
| Nostalgia Potential | 15% |

Score = `(discovery × 0.35) + (theme_fit × 0.25) + (personal_rating × 0.25) + (nostalgia × 0.15)`

Discovery is weighted highest because the user explicitly prioritizes it over nostalgia when all else is equal. The Discovery label is marked with ⭐ in the UI as a visual reminder.

---

## Page Structure

### 1. Home (`/`)

**Top section — Active seasons:**
Four cards in a grid (or two rows of two), one per active season. Each card shows:
- League name + season number
- Status badge: `ACTIVE · ROUND N/9`
- Current round name (theme)
- Research count for current round ("4 songs in research" / "No research yet")
- Nostalgia Pit card uses amber border instead of cyan, with "1 band per round" note
- If deadlines are set for the current round: show countdown badges on the card ("Submit in 2d 4h" in yellow → red when under 24h, "Vote in 6h" similarly)

**Middle section — Past seasons:**
Collapsed into one compact row per league (not per season). Each row shows league name, total rounds, total songs, and a `→` to expand into that league's season list.

**Bottom section — All Songs Ever:**
A searchable/filterable list of every song across all leagues (excluding Nostalgia Pit). Color-coded dot per entry:
- Blue: Music League submission
- Green: WhatsApp chat mention
- Purple: Research list entry

Each row: dot · track title · artist · source label (e.g., "Hip Jammers S2 R3" or "Mentioned May 8").

---

### 2. Season Detail (`/league/:league/season/:n`)

Header: league name → season number, status badge, date range.

Round list: cards in chronological order. Each card shows:
- Round name (theme) + description
- Date
- Song count + total points available
- "N songs in research" badge if any

Clicking a round card navigates to the round detail page.

---

### 3. Round Detail (`/league/:league/season/:n/round/:roundId`)

**Header:** breadcrumb (`Hip Jammers › Season 3 › Round 4`) · round name · description

**Tabs:** `ML Playlist` | `Chat Mentions` | `🔬 Research`

#### ML Playlist tab
- Spotify playlist link at the top (opens in Spotify)
- Spotify / YouTube Music toggle (pill toggle, default Spotify)
  - Spotify mode: shows track info + points/rank
  - YTM mode: each song links to YouTube Music (resolved via Songlink, cached)
- Song list sorted by points descending. Each row: rank · album art · title · artist · submitter · points

#### Chat Mentions tab
Songs auto-captured from the WhatsApp group chat during the week of this round, read from `submissions.db`. Date range for matching: from this round's `created_at` to the next round's `created_at` (or "now" for the current active round). Each row: title · artist · submitted by · date · source platform badge.

#### Research tab
- `+ Add Song` button opens a search modal
- Song list: compact rows, click to expand inline

**Compact row (collapsed):**  
`▶ [art] Title — Artist · T:4 D:5 N:1 P:4 · score · [future ✓]`

**Expanded row:**
- 2×2 rating grid (Theme Fit, Discovery ⭐, Nostalgia, Personal) with clickable stars
- Booleans: "Save for future round" / "I've submitted this before" / "Someone else submitted this" + vote count if known
- Notes text area (auto-saves on blur)
- `submitted_by_me` and `submitted_by_other` are auto-populated from `ml_submissions` data when a matching Spotify URI is found in the imports; user can override
- "Me" is identified by a `MY_COMPETITOR_ID` env var (the user's `ml_competitor_id` from `competitors.csv`)

---

### 4. Add Song Modal

Triggered by `+ Add Song` in the Research tab.

- Spotify search input (queries Spotify search API via server route)
- Results list: album art · title · artist · year
- Clicking a result: adds it to research list for this round, closes modal, card appears collapsed at bottom of research list

---

### 5. Settings (`/settings`)

Accessible from a cog icon (⚙) in the top-right nav on every page.

Organized into four sections:

#### Research Rating Weights
Four sliders (one per dimension) that must sum to 100%. Displays the current split visually as a proportional bar. Changes persist to `league.db` in a `settings` key-value table and take effect immediately on all score calculations.

Default weights:
| Dimension | Default |
|---|---|
| Discovery Potential | 35% |
| Theme Fit | 25% |
| Personal Rating | 25% |
| Nostalgia Potential | 15% |

A "Reset to defaults" button restores the above values.

#### ZIP Import
- Per-league/season upload form: league selector + season number + file picker + "Import" button
- "Re-scan disk" button to re-import all ZIPs from `data/*/season-*/export.zip` without uploading
- **Import history table**: one row per import event — league, season, filename, imported at, rounds/submissions/votes counts, status (success / partial / error). Stored in a new `import_log` table.

#### Round Deadlines
A table of all active rounds across all leagues. For each round: league, season, round name, submission deadline, voting deadline. Both deadline fields are editable date/time pickers (manual entry). Stored in a `deadline` column added to the `rounds` table. Deadlines are shown as countdown badges on the home page active season cards ("Submission due in 2d 4h" / "Voting due in 6h").

#### Songlink Resolution Queue
Shows the state of the background Songlink resolution queue — used whenever a large set of Spotify URIs needs YouTube Music links resolved (e.g., importing a full season's worth of songs).

Displays:
- **Pending**: count of URIs waiting to be resolved, estimated time at 10/min rate limit
- **In progress**: currently resolving URI + progress bar
- **Completed today**: count resolved in last 24h
- **Failures**: table of URIs that returned no YTM link or an error — columns: Spotify URI, track title, error, retry button

Queue state is stored in a `ytm_resolution_queue` table. A server-side background worker drains the queue at ≤10 requests/minute using the existing `songlinkRateLimiter`. The UI polls this endpoint every 10 seconds while the Settings page is open.

---

## ZIP Import Logic

On app startup, the server scans `data/*/season-*/export.zip` and imports any that haven't been imported yet (tracked by the `import_log` table). Re-import is idempotent — all inserts use `INSERT OR REPLACE` / `ON CONFLICT DO UPDATE`. Each import run writes a row to `import_log` regardless of outcome.

---

## Spotify / YouTube Music Toggle

The toggle is per-playlist-view (ML Playlist tab). It does not persist globally. When toggling to YTM:
1. Check `ytm_link_cache` for each Spotify URI in the list
2. For any uncached URIs, call Songlink API (rate-limited, reusing existing `songlinkRateLimiter`)
3. Cache results in `ytm_link_cache`
4. Render each song as a link to its YouTube Music URL (or a "not available" badge if Songlink returns no YTM link)

---

## Docker

New service in `docker-compose.yml`:
```yaml
ui:
  build:
    context: .
    dockerfile: Dockerfile.ui
  ports:
    - "3002:3002"
  volumes:
    - ./data:/app/data
  environment:
    - SPOTIFY_CLIENT_ID
    - SPOTIFY_CLIENT_SECRET
    - MY_COMPETITOR_ID
```

Port 3002 (bracket API is on 3001). Cloudflare tunnel points at 3002.

---

## What This Does NOT Include (out of scope)

- Email parsing for in-progress season updates (user handles manual ZIP uploads)
- YouTube Music playlist creation (Spotify playlists only for now)
- Authentication (delegated to Cloudflare Access)
- Mobile-optimized layout (desktop-first, but should be readable on mobile)
- Multi-user research lists (single user assumed)
