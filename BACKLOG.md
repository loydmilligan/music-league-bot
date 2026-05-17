# Backlog

## What this bot is for

This bot is a **passive music capture layer** for a WhatsApp group that plays Music League. The official Music League app handles actual submissions. This bot captures everything else — songs mentioned in conversation, songs people considered but didn't submit, songs from previous seasons, tangents, rabbit holes.

The goal is zero friction. No commands required. The bot listens, recognises music links from any platform, and quietly builds playlists in the background. Participants get value (playlists, history) without having to interact with the bot at all.

---

## Core: Auto-capture (replaces !song)

**Replace command-based submission with passive URL detection.**

Any message in the group containing a music URL is automatically captured — no `!song` prefix, no command needed. Supported platforms:

- Spotify track URLs (`open.spotify.com/track/...`)
- YouTube / YouTube Music URLs (`youtube.com/watch`, `youtu.be/`, `music.youtube.com/...`)
- Apple Music URLs (`music.apple.com/.../album/...`)

On capture: resolve to a Spotify track (via search if not a Spotify URL), store in DB with submitter, source platform, and original URL. Silent — no group reply unless resolution fails and `onFailure` is configured.

The `!song` command can remain as an explicit force-add (useful if a URL doesn't auto-resolve correctly), but it should no longer be the primary mechanism.

---

## Weekly digest

Once per week (configurable day/time), bot posts to the group:

1. **This week's mentions** — a Spotify playlist of every track captured in the last 7 days, in chronological order. Name: "Music League Mentions — Week of May 5"
2. **Master playlist** — a running Spotify playlist of every track ever captured in this group. Updated automatically on each capture, not just on digest day. Name: "Music League — All Mentions"

Digest is posted as a group message with both playlist links. No noise the rest of the week.

Owner can trigger manually with `!digest` if they want one outside the schedule.

---

## Spotify → YouTube playlist converter

When Music League publishes its weekly playlist (Spotify), participants who prefer YouTube Music get left out. 

Feature: owner pastes a Spotify playlist URL into the group (or sends `!convert <spotify-playlist-url>`). Bot:
1. Fetches all tracks from the Spotify playlist
2. For each track, generates a YouTube search URL (`https://music.youtube.com/search?q=Artist+Title`) or searches via YouTube Data API if available
3. Posts back to the group: a YouTube Music playlist link (if YouTube API available) or a formatted list of per-song YouTube Music search links

Requires either: YouTube Data API key (proper solution, creates actual playlist) or just search link generation (no API key, zero-friction fallback).

---

## Privacy / Infrastructure

- **Message log scope** — `message_create` fires for ALL WhatsApp chats. Move the debug log line inside the group-ID filter so personal conversations don't appear in the terminal. Low effort, do this soon.

---

## Commands (lightweight, non-intrusive)

Keep commands minimal. Participants should never need to use them. Owner-facing only unless noted.

- **`!digest`** — Manually trigger the weekly digest post (owner only)
- **`!convert <spotify-url>`** — Convert a Spotify playlist to YouTube Music links (owner only)
- **`!mysongs`** — Anyone can DM the bot to get their personal capture history (participant-facing, DM only — no group noise)
- **`!count`** — Posts current week's capture count to the group ("14 songs captured this week so far")

---

## Mention List (owner-only, private)

A personal song queue for the owner — separate from the group capture stream. Owner builds up a list of songs they're considering (for Music League submissions, personal use, etc.) and flushes it to a playlist when ready.

- **URL drop in DM** — Owner sends song URLs to the bot directly; bot appends to mention list
- **`!mention list`** — Bot DMs owner the current queue with titles/artists
- **`!mention process`** — Resolves all queued songs, adds to a private "mega mention" playlist, clears the queue. No group notification.

---

## Bracket Tournament Integration

Integration between the March Madness bracket web app (`song-tournament-bracket` repo) and Spotify. No WhatsApp involved — purely an HTTP API endpoint.

- `POST /bracket/round` — takes ordered Spotify URIs (paired as matchups), creates a Spotify playlist, returns playlist ID + URL
- `DELETE /bracket/playlist/:id` — deletes a round playlist
- Auto-delete previous round playlist when new round is pushed
- The bracket app calls these endpoints; music-league-bot handles Spotify auth

See `song-tournament-bracket/docs/spotify-integration-plan.md` for the full frontend spec.

---

## Future

- Per-platform stats: "Most links this week came from YouTube (8) vs Spotify (4)"
- Apple Music → Spotify resolution (requires Apple Music API or scraping)
- YouTube Music → Spotify resolution (search-based)
- Duplicate detection across the master playlist (flag but don't block)
- `!history <artist>` — search the capture history for a given artist

---

# SvelteKit Dashboard (ui/) — Backlog

These items are for the dashboard surface, captured during sprint orchestration as items deferred from the active sprint. Distinct from the WhatsApp-bot backlog above — but both ship in the same repo.

## Schema + data layer

- **Add-round endpoint (`POST /api/rounds`)** — sprint-5 added PATCH for editing existing rounds but no create path. Surfaced 2026-05-16 when a real Music League season needed rounds 8 & 9 added by hand. Endpoint should accept `{ season_id, ml_round_id, name, theme?, submission_deadline?, voting_deadline?, theme_chooser_id?, spotify_playlist_url? }` and return the new row + derived phase. Update `round-edit-modal` to optionally include a "+ Add round" mode in the same component.
- **League ↔ competitor linkage** — `competitors` table is currently flat (`id, ml_competitor_id, name`) with no per-league membership. ML export ingest populates competitors globally. Need either a `league_competitors(league_id, competitor_id)` join table OR a `league_id` column on competitors if a competitor is always scoped to one league. Decide which based on whether the same person appears across leagues with the same `ml_competitor_id` (likely yes — Music League IDs are global). Surfaced 2026-05-16 alongside the theme-chooser work.
- **Theme-chooser surfacing** — `rounds.theme_chooser_id` column added 2026-05-16 (nullable FK to competitors). Currently no UI to set or display it. Next: extend `round-edit-modal` with a "Theme chosen by" dropdown sourced from competitors in the round's league; show the chooser on the round detail page header alongside the theme.
- **Round-edit modal: add competitor field for theme-chooser** — depends on the above schema + the league↔competitor linkage so the dropdown can be scoped correctly.
- **My-standing query** — sprint-4 shipped `My place: —` and `Finished: —/N` placeholder slots on home cards. Need a `getMyStanding(leagueSlug, seasonNumber)` loader that uses `MY_COMPETITOR_ID` env var + votes/submissions tables to compute current rank in active season, final rank in archived seasons.

## Carryover from sprint-4 / sprint-5 deferred sections

- **BIG LIST overview** — unified Spotify playlist of every song across all participated leagues. Landing-page-as-Music-League-career-overview concept. Big feature; needs Spotify playlist creation API.
- **Email ingestion via n8n** — live submission/vote counts from Music League notification emails (user had this working before).
- **Manual submit/vote entry** — UI path since Music League doesn't notify users about their own actions; depends on tracking schema decisions.
- **Historical card fun facts** — total songs, players, genre breakdown, "biggest procrastinator," rotating fun facts on archive cards. Needs new aggregation queries.
- **CRUD UI for league + season metadata** — sprint-5 shipped round-edit only. League and season editing modals.

## Process / dev experience

- **POST `/api/research/[roundId]` upsert by spotify_uri** — sprint-5 `rate-anonymous-ml` and `h2h-rate-and-spotify` both consume `research_songs` from new UI surfaces; the current API may key by id only. If agents handled it via two-step POST-or-PUT, consolidate into a true upsert endpoint.
- **`--color-rating-voting` design token** — sprint-5 `rate-anonymous-ml` used inline blue for voting-phase rating dots; promote to a proper Tailwind token in `app.css` alongside `--color-accent`, `--color-health`, etc.
