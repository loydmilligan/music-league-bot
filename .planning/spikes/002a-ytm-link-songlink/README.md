---
spike: 002a
name: ytm-link-songlink
type: comparison
validates: "Given a round's Spotify track ids, when resolved via Songlink/Odesli, then ≥80% yield YTM video ids (and the 0-for-10 cache failure is explained)"
verdict: INVALIDATED
related: [002b-ytm-link-ytmusicapi-search, 002c-ytm-link-data-api-search]
tags: [songlink, resolver]
---

# Spike 002a: ytm-link-songlink

## What This Validates
Given a round's Spotify track ids, when resolved via Songlink/Odesli, then
≥80% yield YTM video ids — and the existing `ytm_link_cache` 0-for-10 failure
is explained.

## Investigation Trail
- 2026-08-29: `ytm_link_cache` has 10 rows, ALL `ytm_url: null`, resolved May–June.
- `resolveYtmLink` (ui/src/lib/songlink.ts) is logically correct but returns
  null on any non-2xx AND the caller caches that null permanently — failures
  poison the cache with no retry and no error distinction.
- Live test (15:47): `GET api.song.link/v1-alpha.1/links?url=<spotify track>` →
  **HTTP 401 `{"statusCode":401,"code":"PUBLIC_API_ACCESS_DEPRECATED"}`**.

## Results
**INVALIDATED — Songlink has shut down its free public API.** No bug hunt
needed: every call returns 401, `res.ok` is false, null is returned and cached
forever. That is the entire 0-for-10 story.

Consequences:
- `resolveYtmLink`/`resolveSpotifyFromYtm` are dead code paths in prod today
  (worth a follow-up: they silently degrade features that call them).
- The cached nulls should be treated as poison, not data.
- Resolver comparison pivots to 002c (YouTube Data API search.list — official,
  already authed after 001a) vs 002b (ytmusicapi) as fallback.
