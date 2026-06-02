---
project: music-league-bot
sprint: sprint-13-ytm-play-button
created: 2026-06-02T01:10:22Z
updated: 2026-06-02T01:10:22Z
status: active
---

# music-league-bot — coordination doc (sprint-13-ytm-play-button)

> **Feature sprint.** Every song card today has a "Play on Spotify" button but
> no YouTube Music equivalent. Add a parallel YTM play button across all song
> surfaces, resolving Spotify↔YTM via the **existing** Songlink integration.
> Much of the plumbing already exists (`/api/ytm/[spotifyUri]`,
> `ytm_link_cache`, `ytm_resolution_queue`, `src/resolver/songlinkResolver.ts`,
> the queue worker) — this sprint wires it into the UI, hardens on-click
> resolution, and adds the reverse direction. **Backend** owns the API/data
> side (resolve endpoints, cache, Songlink); **frontend** owns the play-button
> UI on the song rows.

## Sprint Goals

- Play any song on YouTube Music, not just Spotify
  Every song card gets a YTM button beside Spotify; missing links resolve on click.

## Active Sprint Plan

- [x] {agent: backend, id: resolve-endpoint} On-demand bidirectional Spotify↔YTM resolution. Today `ui/src/routes/api/ytm/[spotifyUri]/+server.ts` only reads `ytm_link_cache` and relies on the async queue worker for misses. Extend it so a cache-miss synchronously resolves via the existing `resolveSonglinkUrl` in `src/resolver/songlinkResolver.ts` (rate-limited through `songlinkLimiter`), persists the result to `ytm_link_cache`, and returns it. Add the reverse path (YTM URL → Spotify) for songs ingested via the extension that only have a `ytm_url`. Reuse the existing resolver + cache; do not introduce a parallel resolution mechanism.
  - **Acceptance:** `curl 'http://192.168.4.217:3002/api/ytm/<uncached-spotify-uri>'` returns HTTP 200 with a populated `ytmUrl`, and a new row exists in `ytm_link_cache` for that uri; the reverse endpoint resolves a `music.youtube.com` URL → a Spotify URL. Deployed to prod via `docker compose build --no-cache bot-ui && docker compose up -d --force-recreate bot-ui`; behaviour + endpoint shapes recorded in the Activity Log.

- [ ] {agent: backend, id: no-match-cache, depends: resolve-endpoint} Persist a "no-match" marker so a track with no equivalent on the other platform isn't re-sent to Songlink on every click. Store the marker in `ytm_link_cache` (e.g. a sentinel `ytm_url IS NULL` with a populated `resolved_at`, or a dedicated `no_match` flag — match whatever the cache row shape already supports) so the resolve endpoint short-circuits to a "no match" response on repeat calls.
  - **Acceptance:** resolving a track Songlink can't match returns a `noMatch:true` (or equivalent) JSON response; a second `curl` for the same uri returns the same marker **without** a fresh Songlink call (verify via the `songlinkLimiter` counter not advancing, or the cache row's `resolved_at` being unchanged). Logged in the Activity Log.

- [x] {agent: backend, id: song-payload-urls} Expose both `spotifyUrl` and `ytmUrl` on song-list API payloads so the UI can render the correct initial button state without a per-row call. LEFT JOIN `ytm_link_cache` into the song-list queries (mirroring the existing join in `ui/src/lib/db/headToHead.ts`) for the shortlist, research, and chat-songs list endpoints.
  - **Acceptance:** `GET /api/shortlist`, the research list, and the chat-songs list each return a `ytmUrl` field (string or null) per song; `npm run check` passes; deployed to prod and a spot-check confirms a previously-cached song carries its `ytmUrl` in the payload. Recorded in the Activity Log.

- [x] {agent: frontend, id: ytm-button} Build a reusable YTM play-button Svelte component with three states: **resolved** — a direct `<a>` to the YTM URL (mirrors the existing `▶ Play on Spotify` `<a>` in `ShortlistRow.svelte`); **unresolved** — clicking calls the resolve endpoint, shows an inline spinner, then re-renders as the resolved link; **no-match** — a disabled control reading "No YTM match". Component takes the song's `spotifyUri`/`ytmUrl` as props and self-manages the resolve call.
  - **Acceptance:** the component file exists under `ui/src/lib/`; rendered in isolation it shows the resolved link when given a `ytmUrl`, a clickable resolve control when not, and the disabled no-match state for a no-match prop; clicking the unresolved state hits the resolve endpoint and swaps to a live `<a href="…music.youtube.com…">`. `npm run check` passes.

- [ ] {agent: frontend, id: wire-song-rows, depends: ytm-button,song-payload-urls} Render the YTM button beside the existing Spotify button on every song surface: `ui/src/lib/shortlist/ShortlistRow.svelte`, `ui/src/lib/components/ResearchList.svelte`, `ui/src/lib/chat/CwRow.svelte`, and `ui/src/lib/components/HeadToHeadCard.svelte`. Drive the initial button state from the `ytmUrl` now present in each payload (from `song-payload-urls`).
  - **Acceptance:** on prod (`192.168.4.217:3002`), each of the four surfaces renders both a Spotify and a YTM button per song; a song with a cached YTM link shows a direct YTM link (no click-to-resolve); a song without one shows the resolve control. Visual check noted in the Activity Log; deployed to prod.

- [ ] {agent: frontend, id: reverse-spotify-button, depends: ytm-button} For songs that only have a YTM URL (ingested via the extension path, no `spotifyUri`), render the reverse control — a "resolve to Spotify" button using the same component pattern, targeting the reverse resolve endpoint.
  - **Acceptance:** a YTM-only song row renders a Spotify resolve button that, on click, resolves via the reverse endpoint and swaps to a live `open.spotify.com` link; no-match handled the same way. Visual check on prod recorded in the Activity Log.

### Deploy

Each change deploys to prod per the always-deploy-to-prod convention in `CLAUDE.md`: `docker compose build --no-cache bot-ui && docker compose up -d --force-recreate bot-ui`. No `ml-auth-trigger` daemon involvement this sprint (no auth changes).

---

## Agent Roster

| Agent | Owns | Does not touch |
|---|---|---|
| backend | the song/YTM/Songlink API routes (`ui/src/routes/api/ytm/**`, `ui/src/routes/api/ytm-queue/**`, any new resolve route under `ui/src/routes/api/**`), the Songlink resolver + rate limiter (`src/resolver/**`), the resolution cache + queue worker (`ytm_link_cache`, `ytm_resolution_queue`, `ui/src/lib/queueWorker.ts`), song-list payload DB joins (`ui/src/lib/db/**`) | the song-row Svelte components + play-button UI (`ui/src/lib/components/**`, `ui/src/lib/shortlist/**`, `ui/src/lib/chat/**`) |
| frontend | the play-button UI + song-row components (`ui/src/lib/shortlist/**`, `ui/src/lib/components/**`, `ui/src/lib/chat/**`, the new reusable YTM button component) | the API `+server.ts` routes, the Songlink resolver, the cache/queue worker, and the `ui/src/lib/db/**` query layer |

---

## Decision Log

- **D1** — Feature sprint: bidirectional Spotify↔YTM play buttons across every song surface. Reuse the existing Songlink resolver + `ytm_link_cache` + queue worker; do **not** build a parallel resolution mechanism.
- **D2** — Roster split inside the SvelteKit app: backend owns the `+server.ts` API routes + resolver + cache/queue + `ui/src/lib/db`; frontend owns the `.svelte` components + play-button UI. The `+server.ts`/`.svelte` boundary is the lane line.
- **D3** — On-click synchronous resolution for v1. The optional background backfill worker (pre-resolving rows ahead of clicks) is deferred to the backlog per its own "probably not v1" note.
- **D4** — Persist no-match markers so unresolvable tracks don't re-hit Songlink on every click.

## Blockers

- **B1 (frontend → backend) — RESOLVED.** The 2 `submissions.test.ts:15,16` type
  errors are fixed (`null` → `''` for `upsertRound`'s non-null `description`/
  `spotifyPlaylistUrl`). `npm run check` is back to **0 errors** (28 pre-existing
  svelte warnings remain, all in `.svelte` files). Landed in commit `73779da`.

- **B2 (backend) — EXTERNAL: Songlink/Odesli no longer returns Spotify↔YTM
  cross-links, so live resolution yields null in BOTH directions.** The resolve
  endpoints are correct and deployed, but the *value* is blocked at the data source:
  - Spotify-sourced lookups (`open.spotify.com/track/…`) return ~11 platforms with
    **no `youtube` and no `youtubeMusic`** key — verified across **8/8** tracks
    (incl. Blinding Lights, and 6 real round-101 submissions), and unchanged with
    `userCountry=US`. → forward `/api/ytm/[uri]` returns `ytmUrl: null` for everything.
  - YTM-sourced lookups (`music.youtube.com/watch?v=…`) **do** return youtube/
    youtubeMusic but **never `spotify`** (verified 5/5 incl. dQw4w9WgXcQ). → reverse
    `/api/spotify-from-ytm` returns `spotifyUrl: null, error:"no Spotify match"`.
  - This is Odesli gating the YouTube↔Spotify edges (a known policy — YouTube links
    require a commercial key). **Not a code defect:** endpoint mechanics, caching,
    rate-limiting, and null-handling all verified (see Activity Log + endpoint tests).
  - **Impact on the sprint:** the frontend YTM buttons will render the **no-match**
    state for ~all songs, and the reverse Spotify button likewise, until resolution
    has a working source. **Options (need user/orc decision):** (a) obtain an Odesli
    API key and pass it (small resolver change, in-lane); (b) swap the resolver source
    (e.g. a YouTube Music search/lookup) — larger; (c) ship the wiring now and accept
    "no match" until a key is added. The code is ready for any of these — only the
    resolver's data source changes.

## Activity Log

### 2026-06-02 — backend — Wave 1: resolve-endpoint + song-payload-urls (code done & deployed; resolution blocked externally — B2)

**resolve-endpoint (DONE, deployed).**
- Forward `GET /api/ytm/[spotifyUri]` → `{ ytmUrl: string|null }`. Cache hit returns
  instantly; on a miss it now throttles through a shared **ui-local `songlinkLimiter`**
  (`ui/src/lib/songlinkLimiter.ts`, mirrors `src/resolver/songlinkRateLimiter.ts` —
  `src/` is outside the ui Docker build context (`Dockerfile.ui: COPY ui/ ./`), so it
  can't be imported; the ui's existing `$lib/songlink.ts` is the in-context resolver),
  resolves, persists (incl. null), returns. `?redirect=1` still 302s.
- Reverse `GET /api/spotify-from-ytm?url=<ytm>[&redirect=1]` → `{ spotifyUrl: string|null, error? }`.
  Reverse-looks-up `ytm_link_cache.ytm_url`; on miss resolves via the existing
  `resolveSpotifyFromYtm`, then writes the discovered `(spotify_uri, ytm_url)` pair
  into `ytm_link_cache` (bidirectional cache). **Frontend reverse-spotify-button:
  call this endpoint.**
- **Verified mechanics on prod:** `GET /api/ytm/<uncached uri>` → HTTP 200 + a new
  `ytm_link_cache` row created (confirmed in DB). Reverse → HTTP 200 with the
  `{spotifyUrl,error}` shape. Rate-limiter confirmed active (serialises miss-path calls).
- **Populated-path proven by tests** (live API returns null — B2): endpoint integration
  tests with a mocked resolver assert miss→resolve→persist→**populated** `ytmUrl`,
  cache-hit→no resolver call, and null→cached. `ui/src/routes/api/ytm/[spotifyUri]/server.test.ts`.

**song-payload-urls (DONE, deployed).**
- New `ui/src/lib/db/ytmLinks.ts` `attachYtmLinks()` enriches a song list with
  `spotifyUrl` (from `spotifyUri`) + `ytmUrl` (cached value or null) — LEFT-JOIN-
  equivalent to `headToHead.ts`, applied at the **route** layer (the shortlist/chat
  query helpers are in the frontend's lane, so no edits there).
- Wired into `GET /api/shortlist`, `GET /api/research/[roundId]`, `GET /api/chat/songs`.
- **Verified on prod:** all three payloads carry `spotifyUrl` + `ytmUrl` per song
  (shortlist 18, research/101 11, chat 4). `ytmUrl` is null for all today (nothing
  resolvable — B2); the field + spotifyUrl are correct. `npm run check` 0 errors; ui
  vitest 18 files / 92 tests pass.

**⚠️ See Blocker B2** — Songlink/Odesli no longer returns Spotify↔YTM cross-links, so
every live resolution is a no-match. The wiring is complete and correct; the buttons
will show "no match" until the resolver has a working data source (Odesli API key or
alternative). **Frontend Wave 2 can proceed** (buttons render from `ytmUrl`/reverse
endpoint); they'll just mostly show the no-match state until B2 is resolved.

Deploy: `docker compose build --no-cache bot-ui && docker compose up -d --force-recreate bot-ui` (done).
Endpoint shapes for frontend: forward `{ytmUrl}`, reverse `{spotifyUrl, error?}`.

### 2026-06-02 — frontend — ytm-button: reusable YTM play-button component (Wave 1)

Built `ui/src/lib/components/YtmPlayButton.svelte` — a reusable YouTube Music play
control mirroring the existing `▶ Play on Spotify` `<a>` in `ShortlistRow.svelte`.

- **Three states**, driven by props + click-time resolution:
  - *resolved* — direct `<a href={ytmUrl} target="_blank" rel="noopener">` (when a
    `ytmUrl` prop is given, or once a click resolve succeeds).
  - *unresolved* — a `<button>` that on click calls `GET /api/ytm/:spotifyUri`
    (`encodeURIComponent` on the `spotify:track:…` uri), shows an inline CSS spinner
    (`Resolving…`), then re-renders as the resolved `<a>`.
  - *no-match* — a disabled `<button>` reading "No YTM match" (when `noMatch` prop is
    set, or a resolve returns `ytmUrl:null` / `noMatch:true`).
- **Props:** `spotifyUri`, `ytmUrl`, `noMatch`, `label` (default "Play on YTM"), and a
  `class` passthrough so Wave 2 `wire-song-rows` can align it to each surface's button
  styling. Component self-manages the resolve call; failed fetches stay clickable
  (→ "Retry YTM") rather than locking to no-match.
- **Contract:** coded against the live `GET /api/ytm/[spotifyUri]` → `{ytmUrl: string|null}`;
  also tolerant of backend's hardened `{noMatch:true}` shape (parallel `resolve-endpoint`
  work). Verified against prod: `GET /api/ytm/spotify%3Atrack%3A0s9aeZriwqyBYfxFzsd20R`
  → `{"ytmUrl":null}` HTTP 200 → component lands in no-match state as designed.
- **check:** the component contributes **0 errors / 0 warnings**. (2 unrelated errors
  remain in backend-lane `ui/src/lib/db/submissions.test.ts` — see Blocker B1.)
- **Deploy:** `docker compose build --no-cache bot-ui && up -d --force-recreate bot-ui`
  → built clean, prod `/` 200. Component compiles into the prod bundle; not yet
  rendered on any surface (that's Wave 2 `wire-song-rows` + `reverse-spotify-button`).
- **Lane:** only added `ui/src/lib/components/YtmPlayButton.svelte`. Did not touch any
  `+server.ts`, the resolver, the cache/queue, or `ui/src/lib/db`.



### 2026-06-02 — docs — Sprint plan created: YTM play button (sprint-13)
- authored `## Active Sprint Plan` with 6 tasks for the bidirectional Spotify↔YTM play button: on-demand resolve endpoint + no-match cache + song-payload URL exposure (backend), reusable YTM button component + wiring across 4 song surfaces + reverse Spotify button (frontend)
- 3 backend / 3 frontend / 0 docs
- dependency chains: `no-match-cache` depends `resolve-endpoint`; `wire-song-rows` depends `ytm-button,song-payload-urls`; `reverse-spotify-button` depends `ytm-button`. Everything else parallel — `resolve-endpoint`, `song-payload-urls`, `ytm-button` all start immediately (3 parallel at kickoff)
- scope grounded in the existing plumbing: `/api/ytm/[spotifyUri]`, `ytm_link_cache`, `ytm_resolution_queue`, `src/resolver/songlinkResolver.ts`, `ui/src/lib/queueWorker.ts`, and the `▶ Play on Spotify` `<a>` already in `ShortlistRow.svelte` — sprint wires + hardens rather than builds greenfield
- pulled from `docs/coordination/backlog.md` ("YouTube Music play button alongside Spotify"); backlog item can be marked consumed
