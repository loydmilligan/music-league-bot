# Tastemaker reliability + digest chat auto-fetch — design

**Date:** 2026-07-01
**Status:** Approved (brainstorming complete)

## Goals

1. **Tastemaker section stops silently vanishing.** Make `popularity_proxy` always fresh at digest-generation time, add fallback + manual paths to fill missing popularity, and make the prep-checks matrix tell the truth about coverage.
2. **Digest generation auto-uses the league's chat.** At generate time, read the already-ingested `chat_messages` for the league's mapped group over the round window and feed it into the digest, and surface chat availability in the prep-checks matrix.

Must work for **Hip Jammers** and **Second Best** (both have live chat and popularity data today).

## Root cause (investigated, confirmed)

The Tastemaker/discoverability section renders only when `getDiscoverability(db, roundId)` returns a payload (`ui/src/lib/db/discoverability.ts`). Its gate (~L161):

```ts
if (!cov.total || cov.covered / cov.total < COVERAGE_THRESHOLD) return null; // 0.8; covered = popularity_proxy IS NOT NULL
```

`popularity_proxy` (`song_popularity.popularity_proxy`, `schema.ts:234`) is **only** written by the manual batch script `scripts/backfill-popularity.ts`. The automated queue path `fetchPopularity()` (`lib/lastfm.ts:222`) writes `listeners`/`playcount` but explicitly **not** the proxy (`lastfm.ts:201`). So every freshly-ingested round has null proxies → coverage < 0.8 → section self-suppresses until someone runs the script by hand.

`prepChecks.ts` (~L95–101, L149) compounds it: its Tastemaker check tests `song_popularity` **row existence** (INNER JOIN), not `popularity_proxy IS NOT NULL`, so the prep screen shows a green check while the section will actually be suppressed.

Verified: the live discoverability API currently returns full payloads for Hip Jammers and Second Best (their proxies were backfilled), and `GET /v1/tracks/{id}` still returns `popularity` (tested: "Mr. Brightside" = 95) using the app's existing `getSpotifyToken()` client-credentials creds.

---

## Part 1 — Proxy always fresh at generate time

**`recomputePopularityProxies(db)`** — new exported function in `ui/src/lib/lastfm.ts`, extracted from the core of `scripts/backfill-popularity.ts`:

- Recomputes `popularity_proxy` corpus-wide from `listeners`/`playcount` via the existing `computePopularityProxies()` (`lastfm.ts:176`).
- **Never overwrites manual entries** (see `popularity_source = 'manual'` below).
- Idempotent, transactional, fast (a few thousand rows).
- `scripts/backfill-popularity.ts` is refactored to call this function so there is one implementation (script stays as a manual entry point).

**Call site:** invoke `recomputePopularityProxies(db)` at the start of digest generation — inside the `POST /api/digest/[roundId]/draft` handler (`draft/+server.ts:28`) before `gatherRoundData`, and in the prepare endpoint (`prepare/+server.ts`) before building prep-checks — so coverage is always evaluated against fresh proxies. (Cheap enough to run on each prepare/generate; no scheduling needed.)

## Part 2 — Layered popularity fill

Each submission's `popularity_proxy` resolves in priority order:

1. **Manual override** — if `popularity_source = 'manual'`, keep the stored value untouched by recompute.
2. **Last.fm** — log-normalized `listeners`/`playcount` (existing path); `popularity_source = 'lastfm'`.
3. **Spotify fallback** — for submissions with no usable Last.fm data (no row, or listeners+playcount both 0), fetch `GET /v1/tracks/{id}` and use its `popularity` (0–100) as the proxy; `popularity_source = 'spotify'`. Uses the existing `getSpotifyToken()` / shared client in `ui/src/lib/spotify.ts`. New helper `fetchSpotifyPopularity(uris: string[]): Map<uri, number>` (batchable via `GET /v1/tracks?ids=`). No-ops gracefully when creds are absent (like `playlistIngest`).
4. **Still missing** — remains null; surfaced in the manual panel (Part 3) for hand entry.

**Schema additions** (`ui/src/lib/db/schema.ts`, `song_popularity`):
- `popularity_source TEXT` — `'lastfm' | 'spotify' | 'manual'` (nullable; which source set the current proxy).
- `spotify_popularity INTEGER` — cached raw Spotify popularity (nullable), so the fallback isn't re-fetched every recompute.
- Added via additive `ALTER TABLE … ADD COLUMN` migration (matches the project's existing additive-migration pattern; no destructive change).

**Manual override API + UI:**
- `POST /api/songs/[spotifyUri]/popularity` — body `{ popularity_proxy: number (0–100) }`; upserts the row, sets `popularity_source = 'manual'`. `DELETE` clears the manual flag (revert to computed).
- A small panel on the digest **prepare** screen: lists the round's (and cumulative season's) submissions with null `popularity_proxy`, each with title/artist, a link out to look it up, and a 0–100 input + save. Saving writes via the API and refreshes the coverage indicator. Purely additive to the existing prep UI.

**Scale caveat (documented, accepted):** Last.fm proxy is log-normalized across the corpus; Spotify popularity and manual values are their own 0–100 scale. The Tastemaker score is a *percentile across the corpus*, so mixing is acceptable for coverage/ranking. Fallback/manual-filled songs are tagged via `popularity_source` so we can revisit comparability later if needed.

## Part 3 — Honest prep-checks matrix

In `ui/src/lib/digest/prepChecks.ts`:
- **Fix the Tastemaker check** to count `popularity_proxy IS NOT NULL` (matching `discoverability.ts`), cumulative over the season through the round (matching the gate's scope), against the 0.8 threshold. The check's `ok`, `count`, and `total` reflect real coverage.
- Include a human pointer when short: e.g. "N songs need popularity" so the operator knows the manual panel is where to go.

## Part 4 — Chat auto-fetch + prep-checks row

**Auto-fetch at generate:** In the digest draft flow (`draft/+server.ts` / `gatherRoundData` in `lib/digest/llm.ts:92`):
- If the generate request supplied no pasted chat, look up `getChatSettings(db).leagueGroupMap[league.slug]` (`lib/chat/historyQuery.ts:142`).
- If a group is mapped, compute the round window using the **exact** logic the Chat History tab uses (`round.createdAt → nextRound.createdAt` plus `chatSettings.roundBoundary`/`bufferDays`, per `league/[league]/season/[n]/round/[roundId]/+page.server.ts:44–55` — reuse it, do not re-derive), and call `getRoundMessages(db, groupName, fromIso, toIso)` (`historyQuery.ts:54`).
- Feed the serialized conversation into the prompt the same way pasted chat is used (`llm.ts:713–715`) — as a new optional `chatHistory` field on `RoundData` (preferred) or by populating the existing pasted-chat slot. Manual paste still overrides auto-fetch.
- Respects the `contiguous round windows` fix (`6a89131`).

**Prep-checks row:** add a **Chat** row to the matrix showing: whether the league has a mapped group, and how many messages fall in the round window (0 → warn "no chat for this round / league unmapped"; >0 → ok with count). This makes chat availability visible and gated like the other sections.

---

## Isolation / boundaries

- **`recomputePopularityProxies(db)`** (lib/lastfm.ts) — pure corpus recompute honoring `popularity_source='manual'`. One implementation, used by the script and the generate/prepare paths.
- **`fetchSpotifyPopularity(uris)`** (lib/spotify.ts or lastfm.ts) — batched Spotify lookup; graceful no-op without creds.
- **Popularity override endpoint** — thin CRUD over `song_popularity`, sets/clears the manual flag.
- **prepChecks** — reporting only; reads the same conditions the render gate uses.
- **Chat auto-fetch** — a read of `chat_messages` via the existing `getRoundMessages`, injected at one seam in the draft flow; window logic reused verbatim from the round page.

## Testing

- **Unit:** `recomputePopularityProxies` (fills nulls, preserves `manual`, is idempotent); Spotify fallback (mocked `fetch`, maps popularity, no-ops without creds); prepChecks Tastemaker check (null-proxy → not-ok, ≥0.8 proxied → ok) and the new Chat check (mapped+messages → ok, unmapped/empty window → warn); chat-window fetch selects the right messages for a round.
- **Integration/smoke:** on a real round for Hip Jammers and Second Best — generate, confirm Tastemaker renders, confirm auto-fetched chat appears in the draft, confirm the prep matrix shows accurate Tastemaker coverage and a Chat row.
- `cd ui && npm run check` clean; `npm run test` for the touched suites.

## Non-goals

- No change to the 0.8 coverage threshold or the percentile-scoring algorithm.
- No new scheduled jobs (proxy recompute rides on prepare/generate).
- No change to how chat is *ingested* (relay/scripts unchanged) — only how digest generation *reads* it.
- No Tastemaker in the `read_model.json`/bside share surface (out of scope; it remains a round-digest section).
- No backfill of `popularity_source` for existing rows beyond what the first recompute naturally sets.
