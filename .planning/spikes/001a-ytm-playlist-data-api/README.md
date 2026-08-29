---
spike: 001a
name: ytm-playlist-data-api
type: comparison
validates: "Given Matt's OAuth (new refresh token, youtube scope), when we create a playlist + insert videos via YouTube Data API v3, then a playlist exists that is visible/playable in YouTube Music"
verdict: VALIDATED
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
- 2026-08-29 15:43: mint SUCCEEDED — loopback flow worked first try, granted scope exactly youtube. Token refresh works (expires_in 3599).
- 2026-08-29 15:43: playlists.insert → 403 accessNotConfigured: YouTube Data API v3 never enabled on the mara GCP project (523223809842). One-time console enable required; retrying after.
- 2026-08-29 15:45: Matt enabled the API; attempt 3 of the poller SUCCEEDED — playlist PLHf4lRzTsx0A created (unlisted), 3 items inserted in order, 200 quota units, 2.9s end-to-end. Awaiting Matt's YTM visual confirmation for the verdict.

## Results
**VALIDATED** (Matt confirmed visually in YouTube Music, 2026-08-29 15:45).

- Loopback mint flow worked first try against mara's Desktop client; granted
  scope exactly `youtube`. Token written to .env, never printed.
- One-time gotcha: YouTube Data API v3 was not enabled on the GCP project
  (523223809842) — 403 accessNotConfigured until Matt clicked Enable; the
  change propagated in under 2 minutes.
- playlists.insert + 3× playlistItems.insert: 200 quota units, 2.9s total.
  Items landed in insertion order. Unlisted playlist renders and plays in
  YouTube Music at music.youtube.com/playlist?list=<id> — YT/YTM shared
  backend confirmed observably.
- Test artifact: playlist PLHf4lRzTsx0A ("SPIKE 001a — … delete me") left on
  the account for reference; safe to delete anytime.
- Consequence: **001b (ytmusicapi) is unnecessary** — no reason to add an
  unofficial Python dependency when the official API works this cleanly.
- Open question for the build (not spike-blocking): consent-screen status.
  If the client is in Testing, this refresh token dies in 7 days — surface
  fast if weekly runs start failing with invalid_grant.
