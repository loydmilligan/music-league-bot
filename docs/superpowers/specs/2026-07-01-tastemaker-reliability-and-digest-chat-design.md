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

## Part 2 — Regular (percentile) popularity scale, both sources calibrated onto it

**Motivation (measured):** the current `popularity_proxy` (log-normalized listeners/playcount) is severely right-skewed — mean 76.5, 329/632 songs ≥80, almost nothing <30. Since the waveform obscurity axis is `100 - popularity_proxy` (`tasteData.ts:45`), that axis is squashed into a narrow band. We replace the proxy with a **uniform percentile-rank scale** (each song → its rank position in the corpus, 0–100, evenly spread) and translate both sources onto one unified ranking. This regularizes both the Tastemaker coverage/score and the waveform's obscurity axis.

**New `recomputePopularityProxies(db)` algorithm** (in `ui/src/lib/lastfm.ts`, replacing the old per-pair `computePopularityProxies` log-normalize as the corpus path; the script refactors to call it):

1. **Ensure raw signals present.** For every corpus song: Last.fm `listeners`/`playcount` (already fetched by the queue) and Spotify `popularity` (fetched corpus-wide, cached in `spotify_popularity`; batched `GET /v1/tracks?ids=` 50/req; no-op without creds).
2. **Last.fm raw signal** = `log1p(playcount)` (fallback `log1p(listeners)`), for songs with Last.fm data.
3. **Calibrate Spotify → Last.fm signal (unified ranking, chosen approach).** On the **overlap set** (songs with both a Last.fm signal and a Spotify popularity) build a monotonic quantile map: sort overlap by Spotify popularity and by Last.fm signal; a Spotify value maps to the Last.fm signal at the same quantile. For **Spotify-only** songs (the ones Last.fm couldn't find — systematically more obscure), convert their Spotify popularity to a Last.fm-equivalent signal via this map. This correctly places obscure Spotify-only songs low in the ranking instead of overstating them.
4. **Unified signal** per song = Last.fm signal if present, else calibrated Last.fm-equivalent from Spotify, else none.
5. **`popularity_proxy` = percentile rank** of the unified signal across all songs that have one → uniform 0–100. Set `popularity_source` to `'lastfm'` or `'spotify'` accordingly.
6. **Manual entries** (`popularity_source = 'manual'`) are entered directly on the 0–100 scale and are **left untouched** by recompute (fixed points). Songs with no signal from any source stay null → surfaced in the manual panel.

Idempotent, transactional, fast (~640 rows). Runs at prepare/generate (Part 1).

**Schema additions** (`ui/src/lib/db/schema.ts`, `song_popularity`; additive `ALTER TABLE … ADD COLUMN`, matching the project's migration pattern):
- `popularity_source TEXT` — `'lastfm' | 'spotify' | 'manual'` (nullable).
- `spotify_popularity INTEGER` — cached raw Spotify popularity (nullable), so it isn't re-fetched every recompute.

**Manual override API + UI:**
- `POST /api/songs/[spotifyUri]/popularity` — body `{ popularity_proxy: number (0–100) }`; upserts the row, sets `popularity_source = 'manual'`. `DELETE` clears the manual flag (revert to computed on next recompute).
- A small panel on the digest **prepare** screen: lists the season-cumulative submissions with null `popularity_proxy`, each with title/artist, a lookup link, and a 0–100 input + save. Saving writes via the API and refreshes the coverage indicator. Additive to the existing prep UI. Manual values are on the same 0–100 percentile scale (interpretable as "sits at the Nth percentile").

**Consequence (intended):** every player's waveform obscurity axis re-spreads to the new uniform scale, and existing digests will show different (better-distributed) obscurity once regenerated. The Tastemaker score already re-percentiles internally (`percentileByObscurity`), so it stays sensible; the underlying regularization improves its inputs.

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

- **Unit:** `recomputePopularityProxies` — produces a **uniform** proxy distribution (percentile spread, not skewed); the Spotify→Last.fm quantile calibration maps overlap values monotonically and places Spotify-only (obscure) songs low; preserves `manual` entries untouched; is idempotent; leaves signal-less songs null. Spotify fetch helper (mocked `fetch`, batches ids, no-ops without creds). prepChecks Tastemaker check (null-proxy → not-ok, ≥0.8 proxied → ok) and the new Chat check (mapped+messages → ok, unmapped/empty window → warn). Chat-window fetch selects the right messages for a round.
- **Integration/smoke:** on a real round for Hip Jammers and Second Best — generate, confirm Tastemaker renders, confirm auto-fetched chat appears in the draft, confirm the prep matrix shows accurate Tastemaker coverage and a Chat row.
- `cd ui && npm run check` clean; `npm run test` for the touched suites.

## Non-goals

- No change to the 0.8 coverage threshold or the Tastemaker scoring function itself (`percentileByObscurity` is unchanged). We DO change the `popularity_proxy` scale (skewed log-norm → uniform percentile) — that is intentional and also re-spreads the waveform obscurity axis.
- No new scheduled jobs (proxy recompute rides on prepare/generate).
- No change to how chat is *ingested* (relay/scripts unchanged) — only how digest generation *reads* it.
- No Tastemaker in the `read_model.json`/bside share surface (out of scope; it remains a round-digest section).
- No backfill of `popularity_source` for existing rows beyond what the first recompute naturally sets.
