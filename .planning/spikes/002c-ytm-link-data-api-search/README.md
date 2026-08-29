---
spike: 002c
name: ytm-link-data-api-search
type: comparison
validates: "Given a round's Spotify submissions, when searched via YouTube Data API search.list (title + artist, music category), then ≥80% yield correct video ids"
verdict: VALIDATED
related: [001a-ytm-playlist-data-api, 002a-ytm-link-songlink]
tags: [youtube, resolver, search]
---

# Spike 002c: ytm-link-data-api-search

## What This Validates
Given a round's Spotify submissions, when searched via YouTube Data API
`search.list` (q = "title artists", type=video, videoCategoryId=10), then
≥80% of tracks yield a correct video id for playlist insertion.

## How to Run
```
node .planning/spikes/002c-ytm-link-data-api-search/resolve-round.mjs [roundId]   # default 149
```

## Results
**VALIDATED — 10/10 on round 149 (Surrender Monkeys), word-overlap score 1.00
on every track.**

- Better than required: most top hits are **"- Topic" channels** — YouTube
  Music's auto-generated audio uploads, i.e. the exact YTM catalog entries —
  plus VEVO/official uploads for the rest. No fan re-uploads in the top slot.
- Quota: 100 units/search → 1,000 units for a 10-song round. Combined with
  playlist creation (001a: ~550) a full weekly run is ~1,550 of 10,000 daily.
- Naive scorer (fraction of query words in title+channel) was enough; ties/
  ambiguity never arose on this round. The build should still keep top-3
  alternates (already in result.json) for a manual-fix path.
- Consequence: **002b (ytmusicapi) unnecessary** — no Python dep, no cookie
  auth; one API family (Data API v3) covers both resolve and create.
