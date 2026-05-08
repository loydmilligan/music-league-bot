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
