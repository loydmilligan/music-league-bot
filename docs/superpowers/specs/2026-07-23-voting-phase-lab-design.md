# Voting Phase Lab — Design Spec

**Date:** 2026-07-23
**Status:** Approved (design), pending implementation plan
**Author:** Matt + Claude (brainstormed)

## Summary

A **personal decision scratchpad** for the Music League *voting* phase — the one
phase the app currently ignores. For a given round the lab shows the (anonymous,
live-fetched) playlist with per-song metadata, lets **you** divvy an editable
per-league vote budget across the songs, jot private notes, get a personalized
per-song LLM "second opinion" on each track, and draft public vote comments in
your own voice. It never submits anything — the output is your ballot + comment
text to transcribe into Music League.

Single user (the app owner). Works **live-first** (the currently-open voting
round) but also on any past round already in the DB.

## Goals

- Give the voting phase a real workspace instead of being ignored.
- Analyze a round's playlist with the song metadata the app already collects.
- Let the user allocate votes under their league's actual budget rule.
- Personalized per-song LLM take: *how to think about the track itself* (not a
  win-strategy recommender).
- Draft vote comments in the user's voice, seeded by their notes.
- Reuse existing frameworks (predict/, callOpenRouter, theme-brief patterns,
  Vote-Probe UI, metadata tables) rather than inventing new ones.

## Non-goals (YAGNI)

- **No auto-strategist / whole-playlist allocation recommendation.** The user
  allocates; the LLM only helps think about individual tracks.
- **No freeform chat / sounding board.**
- **No auto-voting or auto-submission** into Music League. Copy-out only.
- **No multi-user / auth / per-user privacy.** Single-owner scratchpad.
- **No directional "you should upvote this" nudge** in the per-song take.
- No new top-level route; no bulk "take all songs" action (possible future).

## User & context

- The **voter identity** (which competitor is "me" in a league) is resolved from
  the existing owner / `player_profiles` config, with a manual "I'm this player"
  fallback per league when it can't be inferred. Needed to exclude the user's own
  song from allocation and to source their taste fingerprint + voice sample.
- **Anonymity:** during a live voting round, `ml_submissions.competitor_id` is
  null (submitters hidden). The lab keeps submitters hidden even on past rounds
  for consistency, and the per-song LLM take never receives submitter identity.

## Architecture & placement (Approach B, reconciled for "both")

One self-contained **`VotingLab` Svelte component** mounted in two existing pages
— no new top-level route:

1. **Live-first (primary):** on the Active Round page (`ui/src/routes/+page.svelte`),
   a **"Voting" section appears when `currentRound.phase == 'voting'`**, reusing
   the `leagueStatus()` voting detection already in `ui/src/routes/+layout.svelte`.
2. **Past rounds:** the same component mounts on the round-detail page
   (`ui/src/routes/league/[league]/season/[n]/round/[roundId]/+page.svelte`).

The component is decoupled from either host's server `load()` — it talks to its
**own JSON endpoints** under `ui/src/routes/api/voting-lab/[roundId]/…`. Both host
pages just render `<VotingLab roundId={…} leagueId={…} />`.

**Loading a live round's songs (REVISED 2026-07-23):** a **"Load playlist"** action
populates `ml_submissions` for the current voting round from the round's **Spotify
playlist** (anonymous, `competitor_id NULL`, `visible_to_voters = 1`), by calling the
existing `ingestPlaylist()` (`ui/src/lib/import/playlistIngest.ts`). It then enqueues
those tracks for metadata enrichment, which `ingestPlaylist` does not do on its own —
without it the metadata chips are empty and the LLM take sees only title + artist.

The playlist URL reaches `rounds.spotify_playlist_url` by two existing paths: the
Music League **"New Playlist" email sent when voting opens** (already parsed by
`src/email/emailIngest.ts`), or the user pasting it manually in the round UI. Guards:
409 unless `phase = 'voting'` (`ml_submissions` is shared with digests/standings, so
this must never write into a completed round), and 409 with a clear message when the
round has no playlist URL yet.

> **Superseded approach:** an earlier draft shelled out to the `cli-web-musicleague`
> CLI. That was abandoned because `bot-ui` runs in Docker with neither the CLI nor
> Music League auth, so it could never work in production. The playlist route needs
> only Spotify credentials, which the container already has.

**Component boundary:** `VotingLab` owns the round's ballot UI + LLM-assist and
depends only on its API endpoints + the budget config. Data model, allocation UX,
LLM tasks, and persistence plug into this shell.

## Data model

### Reused as-is (no schema change)

- `ml_submissions` — the round's songs (`round_id`, `spotify_uri`, `title`,
  `artists`, `album`, `album_art_url`, `competitor_id` nullable, `visible_to_voters`).
- Per-song metadata keyed by `spotify_uri`: `song_popularity`
  (`listeners, playcount, popularity_proxy, spotify_popularity, tags`),
  `song_audio_features` (`bpm, key, scale, energy, duration_s`),
  `song_lyrics_metrics` (`has_lyrics, word_count, line_count`), plus theme tags.
- `rounds` (`phase`, deadlines, theme `name`/`description`).
- `player_profiles.taste_fingerprint` — the voter's taste (Task 1 input).
- `votes.comment` — the voter's past comments (Task 2 voice sample).
- `prediction_runs` — caches LLM task results.
- `llm_cost_log` — cost tracking (automatic via `callOpenRouter`).

### New tables (three; the only schema additions)

**`voting_lab_ballot`** — the scratchpad, one row per (round, song):

| column | type | purpose |
|--------|------|---------|
| `round_id` | INTEGER | PK part; FK → rounds |
| `spotify_uri` | TEXT | PK part |
| `up_points` | INTEGER DEFAULT 0 | up allocation for this song |
| `down_points` | INTEGER DEFAULT 0 | down allocation for this song |
| `rating` | INTEGER NULL | optional personal 1–5 |
| `notes` | TEXT | private jotted thoughts |
| `draft_comment` | TEXT | drafted/edited public comment |
| `is_mine` | INTEGER DEFAULT 0 | flags the voter's own submission (excluded from allocation) |
| `updated_at` | TEXT | autosave timestamp |

PK: `(round_id, spotify_uri)`.

**`voting_lab_budget`** — per-round effective budget (override of season default):

| column | type | purpose |
|--------|------|---------|
| `round_id` | INTEGER PK | FK → rounds |
| `up_total` | INTEGER | up pool |
| `down_total` | INTEGER | down pool |
| `per_song_cap` | INTEGER NULL | optional per-song max (null = no cap) |
| `updated_at` | TEXT | — |

### Budget config in Settings (season-level default)

Budget belongs to the **season**, because rosters grow within a season (e.g.
Second Best kept adding members, changing the upvote count). Surfaced in the
existing Settings league→season→round hierarchy (`ui/src/routes/settings/+page.svelte`):
each **season** node gets an editable vote-budget (`up_total`, `down_total`,
optional `per_song_cap`).

**`season_vote_budget`** — the season-level default (third new table):

| column | type | purpose |
|--------|------|---------|
| `season_id` | INTEGER PK | FK → seasons |
| `up_total` | INTEGER | default up pool |
| `down_total` | INTEGER | default down pool |
| `per_song_cap` | INTEGER NULL | optional default per-song max |
| `updated_at` | TEXT | — |

(Chosen over a JSON blob in `settings` for queryability and to keep the
inheritance resolver a simple join.)

**Inheritance + override:**
- When a round has no `voting_lab_budget` row, the lab **inherits** the season
  default.
- The lab header lets you **override per round** (writes a `voting_lab_budget`
  row) — for the mid-season case where a new member shifts later rounds.
- No budget formula is imposed (the −1/−2 debate is settled by these just being
  editable numbers).

## Allocation UX

**Budget header (sticky):** live meter — `Up: 5/7 · Down: 1/2 · 1 up remaining` —
with inline-editable `up_total` / `down_total` / optional `per_song_cap` (writing a
per-round override). Goes red / blocks when a pool is exhausted.

**Per-song row** (playlist order by default; optional sort by rating or LLM take):
- Album art, title, artist. Submitter hidden.
- **Metadata chips:** obscurity/popularity, energy·bpm, has-lyrics, theme-fit —
  from the reused metadata tables.
- **Allocation control:** separate **▲ up** and **▼ down** steppers, hard-capped
  so a row cannot push a pool over budget or exceed `per_song_cap`. The voter's own
  song (`is_mine`) has steppers disabled.
- **Rating:** optional 1–5.
- **LLM take:** "Get take" → personalized track lens (below), inline, cached.
- **Notes:** free-text (private).
- **Draft comment:** "Draft" → comment in the voter's voice (below); editable;
  saved to `draft_comment`; copy button.

**Ballot summary (bottom):** full allocation (songs with points, the one downvote,
total spent vs budget) + each drafted comment with copy, and a **"copy whole
ballot"** — the transcribe-into-Music-League handoff.

**Enforcement stance:** hard-capped to the budget pools; the budget itself is fully
editable. Guardrails, not a straitjacket. Allocation validation is a **pure
function** (correctness-critical, heavily unit-tested).

## LLM tasks

Both are new `PredictionTask`s on the existing `ui/src/lib/predict/` framework
(`runPrediction()`, Zod I/O, `prediction_runs` cache, `llm_cost_log`,
per-task model via `modelForSection`). Both fire **on-demand per song** (button),
so tokens are spent only on engaged songs.

### Task 1 — `votingTake` (personalized track lens)

- **Input:** round theme (`name`/`description`) + the song's metadata
  (obscurity/popularity, audio features, has-lyrics, genre/tags, theme-fit) +
  the voter's `taste_fingerprint`. **Submitter withheld** (anonymous-safe).
- **Output (structured):**
  - `theme_read` — how the track connects to the round's theme
  - `taste_note` — how it maps to *your* taste (personalized)
  - `angles` — 2–3 short "ways to think about this one" (a production detail, a
    lyrical angle, a mood, a comparison)
  - `signals` — descriptive chips (genre, obscurity, energy)
- **Explicitly not** a recommendation: no score, no verdict, no up/down/lean
  nudge. It is a second opinion on the *track itself* to react to.
- Rendered in the reused Vote-Probe visual shape (reasoning + signal chips), minus
  the likelihood bar.
- Cached in `prediction_runs` keyed on (task, round/theme, `spotify_uri`,
  taste-fingerprint version).

### Task 2 — `voteComment` (drafter in your voice)

- **Input:** the song + theme + the voter's **notes + rating** for it + the
  **allocation** (so a downvote gets a downvote-appropriate tone) + a **voice
  sample** = several recent `votes.comment` rows for the voter's player, pulled
  **across all leagues** (confirmed), as few-shot examples.
- **Output:** a `draft` comment in the voter's voice; editable inline;
  "regenerate" varies it; copy button; saved to `voting_lab_ballot.draft_comment`.
- Cached in `prediction_runs` keyed on inputs (changing notes → re-draft).

## Testing

Follows existing repo patterns (predict tasks + theme-brief are already tested):
- **Budget/allocation logic** (pure function): sum ≤ pool, per-song cap, up/down
  separate pools, `is_mine` excluded — thorough unit tests. Correctness-critical.
- **Budget inheritance** (season default → round override) — unit tests.
- **LLM tasks** — input assembly + Zod output parsing with `callOpenRouter`
  mocked; cache-key logic.
- **Data endpoints** — load join (songs + metadata + ballot + budget) and autosave
  round-trip.
- **Playlist load** — `ingestPlaylist` → anonymous `ml_submissions`, via its `tracksProvider` injection point (no network in tests).
- **Component** — light smoke test; real logic lives in testable `$lib` functions.

## Build order

1. Schema (2 tables) + season budget config in Settings + inheritance resolver.
2. Data endpoints + `VotingLab` shell mounted on active-round (voting phase) &
   round-detail pages.
3. Allocation UX (steppers, meter, `is_mine`, autosave, ballot summary + copy-out).
4. Load a live round's songs from its Spotify playlist (+ metadata enqueue).
5. `votingTake` (track lens) task + UI.
6. `voteComment` (drafter) task + UI.

## Open questions / future (not in v1)

- Bulk "get takes for all songs" action (deferred; per-song on-demand for now).
- Whether the season budget default should also roll down to a league-level
  default when a new season has none (currently: fall back to member-count guess).
- Optional "reveal submitters" toggle on past rounds (kept hidden in v1).
