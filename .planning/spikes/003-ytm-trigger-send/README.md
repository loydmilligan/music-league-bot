---
spike: 003
name: ytm-trigger-send
type: standard
validates: "Given a completed round playlist, when the round trigger fires, then the YTM link posts to the TEST group only"
verdict: PENDING
related: [001a-ytm-playlist-data-api, 002c-ytm-link-data-api-search]
tags: [whatsapp, trigger, youtube]
---

# Spike 003: ytm-trigger-send

## What This Validates
End-to-end: round submissions → resolved video ids (002c output) → real
unlisted YTM playlist (001a mechanics) → link posted to the **TEST group only**
(`120363428945055429@g.us`, hard-coded) via the bot's control `/say`.

## How to Run
```
node .planning/spikes/002c-ytm-link-data-api-search/resolve-round.mjs 149   # produce ids
node .planning/spikes/003-ytm-trigger-send/run-e2e.mjs 149                  # playlist + send
```

## What to Expect
An unlisted playlist "Boarz II Men · <round name>" with all round tracks, and
a 🎧 message with the music.youtube.com link in the Chat bot test group.

## Investigation Trail
- 2026-08-29 15:5x: first run — playlist created BUT `playlistItems.insert`
  threw **HTTP 409 SERVICE_UNAVAILABLE** partway through 10 rapid sequential
  inserts (3 inserts in 001a never tripped it). Known-flaky YouTube behavior.
- Added retry (5 tries, 1s→16s backoff on 409/500/503) + 400ms pacing between
  inserts → second run inserted all 10 tracks clean:
  https://music.youtube.com/playlist?list=PLKAJL1FE1lpk
  (first run's partial playlist is junk — delete both test playlists later).
- Send leg failed: control `/say` → 500 `Runtime.callFunctionOn timed out` —
  the documented Puppeteer wedge (bot container up 42h). Restarted the bot
  per the established recovery; retrying the send after client ready.
- 2026-08-29 16:0x: bot ready ~90s after restart; retried `/say` → **200 ok**,
  message delivered to the test group. Awaiting Matt's phone confirmation.

## Results
PENDING
