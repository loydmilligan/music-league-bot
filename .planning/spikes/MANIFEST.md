# Spike Manifest

## Idea
Auto-create a YouTube Music playlist for each Music League round (mirror of the round's Spotify playlist) and post the link to the WhatsApp group, so YTM users stop being second-class citizens. Matt currently builds these by hand every week.

## Requirements
Decisions made during decomposition (2026-08-29, approved by Matt):

- Playlists are created on **Matt's personal Google account** — no service account, no new Google Cloud project.
- Reuse the existing OAuth client from `~/Projects/mara-college-tracker/.env` (`GOOGLE_OAUTH_CLIENT_ID`/`SECRET`), but mint a **NEW refresh token** with the `youtube` scope — do not touch mara's token.
- Minting the token requires Matt to click a consent URL once; the spike must produce that URL and capture the resulting refresh token into this repo's `.env` (`YOUTUBE_*` block already scaffolded in `.env.example`).
- Any WhatsApp send goes to the **TEST group only** ("Chat bot test group" `120363428945055429@g.us`) until explicitly promoted.
- Repo already has `resolveYtmLink` + `ytm_link_cache` (currently empty, 0-for-10 on Songlink) — spike 002 must explain why before choosing a resolver.

## Spikes

| # | Name | Type | Validates | Verdict | Tags |
|---|------|------|-----------|---------|------|
| 001a | ytm-playlist-data-api | comparison | Given Matt's OAuth (new refresh token, youtube scope), when we create a playlist + insert videos via YouTube Data API v3, then a playlist exists that is visible/playable in YouTube Music | VALIDATED ✓ | youtube, oauth, playlist |
| 001b | ytm-playlist-ytmusicapi | comparison | Same, via ytmusicapi (Python) — only if 001a fails or quota-blocks | SKIPPED (001a won) | youtube, ytmusicapi, playlist |
| 002a | ytm-link-songlink | comparison | Given a round's Spotify track ids, when resolved via Songlink/Odesli, then ≥80% yield YTM video ids (and the 0-for-10 cache failure is explained) | INVALIDATED ✗ (Songlink public API shut down — 401 PUBLIC_API_ACCESS_DEPRECATED) | songlink, resolver |
| 002b | ytm-link-ytmusicapi-search | comparison | Same, via ytmusicapi search on title+artist | SKIPPED (002c won) | ytmusicapi, resolver |
| 002c | ytm-link-data-api-search | comparison | Given a round's Spotify submissions, when searched via Data API search.list, then ≥80% yield correct video ids | VALIDATED ✓ 10/10 | youtube, resolver |
| 003 | ytm-trigger-send | standard | Given a completed round playlist, when the round trigger fires, then the YTM link posts to the TEST group only | PENDING | whatsapp, trigger |

Risk order: 001a first — if playlist creation on the personal account fails, the idea dies.
