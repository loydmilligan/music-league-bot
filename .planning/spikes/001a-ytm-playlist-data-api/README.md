---
spike: 001a
name: ytm-playlist-data-api
type: comparison
validates: "Given Matt's OAuth (new refresh token, youtube scope), when we create a playlist + insert videos via YouTube Data API v3, then a playlist exists that is visible/playable in YouTube Music"
verdict: PENDING
related: [001b-ytm-playlist-ytmusicapi]
tags: [youtube, oauth, playlist]
---

# Spike 001a: ytm-playlist-data-api

## What This Validates
Given Matt's personal Google account and a freshly minted refresh token with the
`youtube` scope, when we call `playlists.insert` + `playlistItems.insert` on the
Data API v3, then an unlisted playlist exists whose `music.youtube.com` URL
opens and plays in YouTube Music.

## Research
- Quota: `playlists.insert` = 50 units, `playlistItems.insert` = 50 units/call,
  default 10,000 units/day ([docs](https://developers.google.com/youtube/v3/docs/playlistItems/insert)).
  A 10-song round ≈ 550 units — weekly use is trivial; even daily would be fine.
- OAuth: reuses mara-college-tracker's Desktop client. Its loopback
  installed-app mint flow is proven in that repo (`mint-drive-refresh-token.mjs`);
  ours requests ONLY `https://www.googleapis.com/auth/youtube`.
- **Watch out:** if the OAuth consent screen is in *Testing* status, refresh
  tokens expire after 7 days — fatal for unattended weekly use. Mara's Drive
  token has lived longer than that on this same client, which suggests
  Production status, but the spike should note the granted-token behavior.
- YTM visibility is undocumented but YT and YTM share the playlist backend;
  the spike verifies it observably rather than trusting folklore.

| Approach | Tool | Pros | Cons |
|----------|------|------|------|
| Data API v3 (this) | REST + refresh token | Official, stable, in-house mint flow, ample quota | Consent click needed; YTM visibility implicit |
| ytmusicapi (001b) | Python lib | Native YTM, search built in | Unofficial, fragile auth, new Python dep |

## How to Run
1. **Matt, one time** (opens a browser for consent; writes YOUTUBE_* into `.env`):
   ```
   node .planning/spikes/001a-ytm-playlist-data-api/mint-youtube-refresh-token.mjs
   ```
2. Then:
   ```
   node .planning/spikes/001a-ytm-playlist-data-api/create-playlist.mjs
   ```

## What to Expect
- Mint: browser consent → "SUCCESS — YOUTUBE_* written to .env", granted scope
  is exactly `https://www.googleapis.com/auth/youtube`.
- Create: an unlisted playlist "SPIKE 001a — Boarz YTM test (delete me)" with
  3 videos; both a `youtube.com` and a `music.youtube.com` URL are printed.
  The YTM URL should open in YouTube Music with all three tracks playable.

## Observability
`create-playlist.mjs` writes `result.json` next to itself: ISO-timestamped
event log (auth / playlist.created / item.inserted), quota used, duration.

## Investigation Trail
- 2026-08-29: scripts written; awaiting Matt's consent click to mint the token.

## Results
PENDING
