---
project: music-league-bot
sprint: sprint-10-extension-ingest
created: 2026-05-20T00:00:00Z
updated: 2026-05-20T00:00:00Z
status: planned
---

# music-league-bot — coordination doc (sprint-10-extension-ingest)

> **Backend** owns the ingest API, token management, Spotify enrichment, and DB schema for `api_tokens`.
> **Frontend** owns the Settings page section for API tokens (list / generate / revoke) in the webapp.
> **Extension** is a new agent track owning everything under `extension/` — manifest v3, popup, content script, background service worker.
> Wave 1 (backend + frontend) runs fully in parallel. Wave 2 (extension) starts after Wave 1 ingest endpoint lands so it has a real API to test against.

## Goal

Add songs to the music-league-bot's global shortlist (`shortlist_songs`) without using the webapp — via a Chrome browser extension (v1) that activates on Spotify track / album / playlist pages. YouTube Music ingest is a mid-sprint stretch goal (via Songlink → Spotify resolution). Firefox port is v2, out of scope.

---

## Active Sprint Plan

### Wave 1 — API + token mgmt (parallel)

- [ ] {agent: backend, id: api-tokens} Task 1: API token management — new `api_tokens` table + generate / list / revoke endpoints
  - **Acceptance:** New table `api_tokens(id INTEGER PRIMARY KEY, hash TEXT NOT NULL UNIQUE, label TEXT NOT NULL, created_at TEXT NOT NULL, last_used_at TEXT, revoked_at TEXT)` added to `ui/src/lib/db/schema.ts`. `POST /api/tokens` accepts `{ label }`, generates random 32-byte token, returns plaintext **once** in response and stores SHA-256 hash. `GET /api/tokens` returns list (id, label, created_at, last_used_at, revoked_at) — never plaintext. `DELETE /api/tokens/:id` sets `revoked_at = now()`. Tokens are not user-scoped (single-user app). `npm run check` passes.

- [ ] {agent: backend, id: bearer-auth} Task 2: Bearer-token auth middleware
  - **Acceptance:** Reusable SvelteKit-side helper (`requireBearerToken` in `ui/src/lib/auth/bearer.ts` or similar) that reads `Authorization: Bearer <token>` from a `Request`, SHA-256 hashes it, looks up in `api_tokens` where `revoked_at IS NULL`, and either returns the token row (updating `last_used_at`) or throws 401. Used by the ingest endpoint in Task 3. Existing webapp routes are NOT affected (no auth retrofitted).

- [ ] {agent: backend, id: ingest-endpoint, depends: api-tokens, bearer-auth} Task 3: `POST /api/ingest/songs` — Spotify URL ingest
  - **Acceptance:** Endpoint authenticates via Bearer token (Task 2). Body: `{ urls: string[] }`. For each URL:
    - Match against Spotify track / album / playlist URL patterns (e.g. `open.spotify.com/track/<id>`, `/album/<id>`, `/playlist/<id>`)
    - Track: fetch via Spotify Web API → insert into `shortlist_songs` (use existing Spotify client from `src/` or `ui/src/lib/`)
    - Album / playlist: fetch tracklist → bulk insert each track into `shortlist_songs`
    - Deduplicate against existing `shortlist_songs.spotify_track_id` — skip duplicates, report in `failed` with reason "already in shortlist"
  - Response: `{ added: [{ title, artist, spotifyId }], failed: [{ url, reason }] }`.
  - CORS: allow `chrome-extension://*` origins (Chrome extensions need this) — confirm via OPTIONS preflight handling.

- [ ] {agent: frontend, id: settings-tokens} Task 4: Settings page — API tokens section (list / generate / revoke)
  - **Acceptance:** New section in the existing Settings page (or new `/settings/api-tokens` route if no Settings page exists yet — check first). UI:
    - List of existing tokens with label, created_at, last_used_at, "Revoke" button per row (calls DELETE; revoked tokens grey out, don't disappear).
    - "Generate new token" button → modal asking for `label`. On submit, POST to `/api/tokens`, modal flips to a one-time reveal view showing the plaintext token with a "Copy" button and a warning that this is the only chance to copy it. Confirm-to-dismiss closes the modal.
    - Empty state if no tokens exist yet.
  - `npm run check` passes.

### Wave 2 — Chrome extension (after Wave 1 lands)

> **Extension agent owns all files under `extension/`.** New top-level directory in the MLB repo. No existing pattern to follow — agent picks its own conventions consistent with Chrome MV3 best practices.

- [ ] {agent: extension, id: manifest, depends: ingest-endpoint} Task 5: Manifest v3 skeleton + options page
  - **Acceptance:** `extension/manifest.json` (v3, host permissions for `https://open.spotify.com/*` and `https://mlb.mattmariani.com/*`). `extension/options.html` + `extension/options.js` provide a form to set: (a) the MLB API base URL (default `https://mlb.mattmariani.com`), (b) the Bearer token. Settings persist via `chrome.storage.local`. Loadable as unpacked extension in Chrome.

- [ ] {agent: extension, id: content-script, depends: manifest} Task 6: Content script — Spotify URL detection
  - **Acceptance:** `extension/content-spotify.js` runs on `open.spotify.com/*` pages. Detects current URL type (track / album / playlist) via URL path regex. Extracts page metadata: title, primary artist (track) or owner (playlist), track count (album / playlist). Exposes the detected resource to the popup via `chrome.runtime.sendMessage` (responder pattern: popup asks "what's on this page?", content script replies with `{ kind, url, title, artist, count }`).

- [ ] {agent: extension, id: popup, depends: content-script, manifest} Task 7: Popup UI — detect, confirm, add
  - **Acceptance:** `extension/popup.html` + `extension/popup.js`. On open:
    - Asks the active tab's content script what's detected. Shows: kind badge (Track / Album / Playlist), title, artist or owner, track count if applicable.
    - "Add to shortlist" button calls the background worker (Task 8). Status feedback: loading spinner, success toast with "Added N · Skipped M (already in shortlist)", failure with reason.
    - Disabled state with reason message when no Spotify URL detected, or no token configured (with a link to options page).

- [ ] {agent: extension, id: bg-worker, depends: popup, manifest} Task 8: Background service worker — POST to ingest endpoint
  - **Acceptance:** `extension/background.js` registered as service_worker in manifest. Receives `{ urls: string[] }` from popup, reads token + base URL from `chrome.storage.local`, POSTs to `<base>/api/ingest/songs` with `Authorization: Bearer <token>`. Returns the full response to the popup. Handles 401 (invalid/revoked token), 5xx, and network errors with surfaceable messages.

### Wave 3 — Stretch (mid-sprint, only if Wave 2 lands with time to spare)

- [ ] {agent: backend, id: ytm-songlink, depends: ingest-endpoint} Task 9: YTM URL support via Songlink fallback
  - **Acceptance:** `POST /api/ingest/songs` accepts `music.youtube.com/*` URLs alongside Spotify. For YTM URLs: call the existing Songlink integration to resolve to a Spotify URL, then proceed through the existing track-ingest path. If Songlink fails or returns no Spotify equivalent, return `failed` with reason "no Spotify match via Songlink".

- [ ] {agent: extension, id: ytm-detect, depends: content-script, ytm-songlink} Task 10: Extension content script for music.youtube.com
  - **Acceptance:** `extension/content-ytm.js` analogous to `content-spotify.js`, runs on `music.youtube.com/*`. Detects track / playlist / album pages via URL pattern (YTM URL shape differs from Spotify). Extracts canonical URL — backend handles the Songlink resolution downstream.

### Deploy

- [ ] {agent: backend, id: deploy} Task 11: Deploy ingest API + UI changes to prod
  - **Acceptance:** `docker compose build --no-cache bot-ui && docker compose up -d bot-ui`. `/settings/api-tokens` (or wherever Task 4 lands) reachable on mlb.mattmariani.com. `POST /api/ingest/songs` callable with a valid Bearer token.

- [ ] {agent: extension, id: package} Task 12: Package extension for manual install
  - **Acceptance:** `extension/README.md` documents how to load the extension as unpacked in Chrome (Settings → Extensions → Developer mode → Load unpacked → select `extension/` dir). No Chrome Web Store submission in v1 — user installs manually. Optional: a build script that zips `extension/` into `mlb-extension-v1.zip` for portability.

---

## Agent Roster

| Agent | Owns | Does not touch |
|---|---|---|
| backend | `ui/src/lib/db/schema.ts` (add `api_tokens`), `ui/src/lib/auth/bearer.ts`, `ui/src/routes/api/tokens/**`, `ui/src/routes/api/ingest/**`, Spotify client (existing) | `ui/src/routes/settings/**`, `extension/**` |
| frontend | `ui/src/routes/settings/**` (API tokens section), any new Svelte components for the token UI | `ui/src/routes/api/**`, `ui/src/lib/db/**`, `extension/**` |
| extension | `extension/**` (new directory; full ownership) | `ui/**`, `src/**`, `scripts/**` (does not touch the existing app code; only consumes the API as a foreign client) |

---

## Decision Log

- **D1**: Tokens are not user-scoped — this is a single-user app. Any valid token authorizes any ingest. Simplicity > multi-user shape; can revisit if multi-user becomes a real requirement.
- **D2**: Plaintext token is shown **once** on generation and never again. Stored as SHA-256 hash. Standard pattern; mirrors how GitHub PATs work.
- **D3**: Shortlist is global, not per-league. Songs added via ingest go into the global `shortlist_songs` pool; assignment to round / competitor happens later in the webapp via the existing flow.
- **D4**: Extension lives in `extension/` inside the MLB repo (single repo, single version). Reduces version-skew risk between API + extension.
- **D5**: v1 = Chrome only. Firefox port is v2 — Manifest V3 is supported in both but the service-worker / `browser` namespace details differ; defer until Chrome v1 is shipped.
- **D6**: YTM is mid-sprint stretch (Tasks 9 + 10), not Wave 2 baseline. If Wave 2 finishes with time, agents pull these; otherwise YTM = future sprint.
- **D7**: Albums and playlists ingest all tracks at once. No track-by-track multi-select UI in the popup (would balloon scope; user can always remove unwanted tracks from the shortlist via the webapp).
- **D8**: CORS on `/api/ingest/songs` allows `chrome-extension://*`. The token is the auth boundary, not the origin.

## Blockers

## Activity Log

### 2026-05-19 — frontend — T4 done (Settings API tokens section)
- **Layout decision:** existing `/settings/+page.svelte` is already a dense, multi-section page (rating weights, ZIP import, songlink queue, auto-fill deadlines, round deadlines collapsible). Bolting another section in would push it past comfortable scrolling. **Created `/settings/api-tokens` as a sub-route** and added a single nav link from `/settings` header pointing to it (`→ API tokens (extension auth)`). Sidebar nav already has the parent `/settings` entry labeled "Setup"; per the brief ("if Settings has no sub-nav, leave layout alone and just link from the root /settings page"), the `+layout.svelte` is untouched.
- **Files added:**
  - `ui/src/routes/settings/api-tokens/+page.server.ts` — server load calls `GET /api/tokens` via SvelteKit internal fetch. Fail-soft: if backend is down or returns 5xx, page still renders with a warn chip ("failed to load tokens · GET /api/tokens → 500") and an empty list, so the route is reachable even before backend T1 ships. Defensive `normalize()` accepts both the planned camelCase shape (`createdAt`, `lastUsedAt`, `revokedAt`) and snake_case (`created_at`, `last_used_at`, `revoked_at`) — if backend pins one form, the other dies gracefully.
  - `ui/src/routes/settings/api-tokens/+page.svelte` — Tailwind table matching existing settings-page styling. Empty state copy matches the brief verbatim. Revoke uses `window.confirm()` per the v1 brief, then DELETE `/api/tokens/:id`, then `invalidateAll()`. Inline toast for success / failure (5 s auto-dismiss). Revoked rows grey out at `opacity-50`; Revoke button hides once `revokedAt !== null`.
  - `ui/src/lib/settings/TokenGenerateModal.svelte` — two-phase modal matching the existing `RegenModal` / `RelContextDiffModal` scrim/Esc/scrim-click pattern. Phase 1 = label input (Enter-to-submit, validation, focus via `bind:this`+`$effect` to avoid the `autofocus` a11y warning). Phase 2 = one-time plaintext reveal with amber warn box, monospace token in `user-select:all` box, Copy button calling `navigator.clipboard.writeText`. Esc / scrim-click on reveal route through `onGenerated` (not `onCancel`) so no escape path avoids the list refresh.
- **`npm run check`:** 1 ERROR (pre-existing `vite.config.ts`), 31 WARNINGS, 14 FILES — unchanged baseline.
- **Deploy:** `docker compose build --no-cache bot-ui && docker compose up -d --force-recreate bot-ui`. (Force-recreate was needed; the first `up -d` after the build kept the old container running. Worth noting for future deploys.)
- **Backend T1 already shipped** out of band — `GET /api/tokens` returned `[{"id":1,"label":"smoke","createdAt":"…",…}]` with the exact planned camelCase shape. No backend Activity Log entry yet — heads-up that backend T1 endpoints are live with the documented contract.
- **End-to-end smoke (localhost:3002):**
  1. `GET /settings/api-tokens` → 200, renders the `smoke` token row with `ACTIVE` chip + `Revoke` button. ✓
  2. `GET /settings` → 200, contains the link to `/settings/api-tokens`. ✓
  3. `POST /api/tokens {"label":"frontend smoke 2026-05-19"}` → 200 with **plaintext `token` field** (64 hex chars), `lastUsedAt:null`. ✓
  4. `DELETE /api/tokens/2` → 204, `revokedAt` populated on next GET. Page render: REVOKED chip + greyed row. ✓
  5. Refresh `/settings/api-tokens` → state persists; Revoke button hides on revoked rows. ✓
- **Modal click flow** verified by code inspection (no headless DOM available): scrim/Esc/Close all route through the right callback per phase; Copy falls back to `! Failed` chip if the clipboard API is unavailable (e.g. non-secure HTTP origin).
- **Status:** sprint-10 frontend Wave 1 (T4) done and shipped to local prod on port 3002.

### 2026-05-20 — backend — Wave 1 done (T1 + T2 + T3 bundled)
All three Wave 1 backend tasks shipped in one commit since they're tightly coupled (token CRUD → bearer middleware → ingest endpoint consumes both).

**T1 — api_tokens table + CRUD endpoints**
- **Schema** (`ui/src/lib/db/schema.ts`): added `api_tokens(id PK, hash TEXT UNIQUE NOT NULL, label TEXT NOT NULL, created_at, last_used_at, revoked_at)` + partial index `idx_api_tokens_active ON api_tokens(hash) WHERE revoked_at IS NULL` to keep lookups O(log n) at scale. **No `client.ts` migration needed** — this is a brand-new table, so the `db.exec(SCHEMA)` on boot creates it via `CREATE TABLE IF NOT EXISTS`; the PRAGMA+ALTER dance is only for *column* additions to existing tables (which is what T12 needed). Verified live: `PRAGMA table_info(api_tokens)` returns the 6 expected columns.
- **`POST /api/tokens`** (`ui/src/routes/api/tokens/+server.ts`): body `{ label: string }` (validated non-empty). Generates 32 random bytes via `crypto.randomBytes` → 64-char hex plaintext; SHA-256 of plaintext is what's stored. Response **201** `{ id, label, createdAt, lastUsedAt, revokedAt, token }` — `token` is the only place plaintext ever appears. Errors: `400 body.label (non-empty string) required`.
- **`GET /api/tokens`**: returns `[{ id, label, createdAt, lastUsedAt, revokedAt }]` ordered DESC by id. **Never includes a `token` field** — verified in smoke (`has plaintext token field? False`).
- **`DELETE /api/tokens/:id`** (`ui/src/routes/api/tokens/[id]/+server.ts`): sets `revoked_at = now()` (soft-delete; row stays so the audit trail and `last_used_at` history survives). Returns **204** No Content. Idempotent — calling on an already-revoked row is a no-op success. `404 token not found` for unknown id.

**T2 — Bearer-token auth middleware**
- **New module** `ui/src/lib/auth/bearer.ts`:
  - `hashToken(plain)` and `generateToken()` — shared between routes so the hashing algorithm has one definition.
  - `requireBearerToken(request, db)` — reads `Authorization: Bearer <token>` (case-insensitive header lookup), regex-validates the value (`^Bearer\s+([A-Za-z0-9._\-+/=]+)$` — accepts hex, base64url, base64 padded), SHA-256 hashes, looks up `api_tokens` where `revoked_at IS NULL`, updates `last_used_at = now()`, returns the row. Throws SvelteKit `error(401, ...)` on any failure — distinct messages per case so debugging is easy: `missing Authorization header` / `malformed Authorization header (expected: Bearer <token>)` / `invalid or revoked token`.
- **Reusable:** any future API surface can `requireBearerToken(request, getDb())` and inherit the same auth semantics. Existing webapp routes are deliberately not retrofitted — they remain open for browser sessions, only `/api/ingest/songs` is locked down here.

**T3 — `POST /api/ingest/songs` (the meat)**
- **File** `ui/src/routes/api/ingest/songs/+server.ts`. Calls `requireBearerToken` first (throws 401 before any work). Body: `{ urls: string[] }` (filters empty / non-string entries silently). Iterates URLs in order:
  - `parseSpotifyUrl()` matches against `^https?://open\.spotify\.com/(?:intl-xx/)?(track|album|playlist)/([A-Za-z0-9]{15,40})(?:\?|$|#|/)` *or* the raw `spotify:kind:id` URI form. Returns `{ kind, id, uri }` or null. The `intl-xx/` allowance handles country-localized Spotify share URLs (`/intl-de/track/...`); regex tail allows `?si=...` query suffix that copy-from-Spotify always appends.
  - **Track:** `fetchTrack(id)` → resolved metadata → addOne.
  - **Album:** `fetchAlbumTracks(id)` — single `/albums/{id}` fetch (returns up to 50 tracks plus a `tracks.next` cursor if more); pages via `tracks.next`. Grafts the album-level metadata (name / release_date / images) onto each track since `/albums/{id}/tracks` pagination doesn't echo it back.
  - **Playlist:** `fetchPlaylistTracks(id)` — paginates `/playlists/{id}/tracks?limit=100&fields=...` via `next` URL. Uses Spotify's `fields=` projection so only the columns we need come back (lighter payloads on big playlists).
- **Dedup:** one pre-fetch `SELECT spotify_uri FROM shortlist_songs` builds an in-memory `Set` per call; each candidate URI is checked against both the existing set AND an in-call `seenUrisThisCall` set (catches the case where the same album appears twice in one POST). Skipped tracks land in `failed` with `reason: "already in shortlist"`.
- **Insert:** reuses the existing `addShortlistSong(db, ...)` helper at `ui/src/lib/shortlist/shortlist.ts:39` — that helper already does `INSERT OR IGNORE` on `spotify_uri UNIQUE`, generates the `id` via `randomUUID()`, and is the path the webapp uses for manual adds. **Important schema note:** the column is `spotify_uri` (e.g. `spotify:track:0DiWol3AO6WpXZgp0goxAV`), **not** `spotify_track_id` — the task brief used the latter name but the actual schema (line 83 of `schema.ts`) is `spotify_uri`. Dedup is by URI for that reason.
- **Response shape:** `{ added: [{ title, artist, spotifyId }], failed: [{ url, reason }] }`. `spotifyId` is the raw track id (not the URI) so the extension can hand it to other Spotify integrations directly. `added` order matches the order of successful inserts; `failed` order matches the order of failures.
- **CORS:** `OPTIONS` handler returns 204 with `Access-Control-Allow-Origin: <reflected origin or *>`, `Allow-Methods: POST, OPTIONS`, `Allow-Headers: Authorization, Content-Type`, `Max-Age: 86400`, `Vary: Origin`. POST handler echoes the same headers on the JSON response. Per D8 the token is the auth boundary, so we reflect any origin that asks (incl. `chrome-extension://*`) — there is no allowlist to maintain.

**Spotify client — where it lives (for Task 5+ extension agent and future backend work)**
- **New** `ui/src/lib/spotify/client.ts`. Exports: `parseSpotifyUrl(input)`, `fetchTrack(id)`, `fetchAlbumTracks(id)`, `fetchPlaylistTracks(id)`, `ResolvedTrack` type. Uses **client_credentials** OAuth (needs only `SPOTIFY_CLIENT_ID` + `SPOTIFY_CLIENT_SECRET`; no `SPOTIFY_REFRESH_TOKEN` needed for public-data reads). Token is cached in a module-level singleton with a 60 s safety margin before expiry.
- **Why a new module vs. reusing existing code:**
  - `src/spotify/token.ts` + `src/spotify/adapter.ts` (root workspace) — these use a **refresh_token** flow scoped to a user, needed for *write* operations like creating/modifying playlists. Overkill for ingest, and pulling them into the ui workspace would have meant either copying or a cross-workspace import (ui is its own npm package).
  - `ui/src/routes/api/spotify/search/+server.ts` already has an **inline** client-credentials client. I extracted that pattern into the new `lib/spotify/client.ts` so both can share it; the existing inline `search` route is left untouched (no in-flight risk to working code).
- **Editorial-playlist caveat (discovered during smoke):** Spotify restricted `client_credentials` access to algorithmic / editorial playlists (the `37i9dQZF...` ID range) in late 2024 — those now return 404 to apps using client_credentials. **User-owned public playlists work fine** (verified: 5/5 tracks ingested from a user playlist). If we ever need to ingest editorial playlists, the workaround is to switch that one code path to the root `src/spotify/token.ts` user-OAuth client. Not blocking — extension users will be sharing user playlists, not editorial ones.
- **Why this matters for future agents:** if you need to do anything *Spotify-write* (modify playlists, add tracks to a user's library, etc.), use `src/spotify/token.ts`. If you need to do anything *Spotify-read public* (search, fetch metadata, list playlist tracks), use the new `ui/src/lib/spotify/client.ts`.

**Smoke (against `https://mlb.mattmariani.com`)**
1. **POST /api/tokens** `{label:"smoke"}` → **201** id=1, token 64 hex chars, all fields present.
2. **GET /api/tokens** → 200, 1 row, no `token` field in response (plaintext never leaked).
3. **POST /api/ingest/songs** (track URL: Daft Punk — "One More Time") → 200 `{added:[{title:"One More Time", artist:"Daft Punk", spotifyId:"0DiWol3AO6WpXZgp0goxAV"}], failed:[]}`.
4. **Same URL again** → 200 `{added:[], failed:[{reason:"already in shortlist"}]}`. ✓ dedup.
5. **Album URL** (Daft Punk — *Discovery*, 14 tracks) → 200 in 0.4 s, `added=13, failed=1`. The 1 failure is "One More Time" (deduped from step 3) ✓.
6. **User-owned public playlist** → 200, 5 tracks ingested, 0 failures.
7. **Editorial playlist 37i9dQZF1DXcBWIGoYBM5M** → 200 `failed:[{reason:"spotify fetch failed: Spotify 404 ..."}]`. Documented as a Spotify-side restriction, not a bug; the error is surfaced through the normal `failed[]` channel rather than 5xx-ing.
8. **Bad token** → 401 `{message:"invalid or revoked token"}`.
9. **Missing Authorization header** → 401 `{message:"missing Authorization header"}`.
10. **Non-Spotify URL** (`music.youtube.com/...`) → 200 `failed:[{reason:"only Spotify URLs supported in v1 (track / album / playlist)"}]` — Wave 3 Task 9 will widen this via Songlink.
11. **OPTIONS preflight** with `Origin: chrome-extension://abcdefghijklmnop` → 204 with all expected `Access-Control-*` headers + `Vary: Origin`. Origin reflected verbatim.
12. **GET /api/tokens after ingest** → `lastUsedAt` populated on the row that was used (UTC iso, second granularity). Confirms middleware writeback works.
13. **DELETE /api/tokens/3** → 204. Subsequent ingest with the revoked token → 401 `{message:"invalid or revoked token"}`. GET shows `revokedAt` populated, row preserved.
14. **DB sanity:** `SELECT count(*) FROM shortlist_songs WHERE added_at >= '2026-05-20T03:33:00Z'` → 19. Matches expected (1 track + 13 album + 5 playlist).

**Collision note (process, not code):** parallel frontend agent ran their own smoke against `/api/tokens` between my smoke 4 and 5. They reused the same `/tmp/tok.json` path I was using, which clobbered my captured token. No functional impact — I re-issued with a unique `/tmp/be-tok*.json` path. **Recommendation for future cross-track smokes:** isolate scratch files in `/tmp/<agent-prefix>-*.json`. Frontend's tokens (ids 1, 2) are revoked, mine (ids 3, 4) are revoked, DB is clean.

**Status of agent-roster boundaries**: did not touch `ui/src/routes/settings/**` (frontend's T4); did not create `extension/**` (Wave 2 territory).

**`npm run check`:** 520 files (was 507), 1 error / 31 warnings — baseline unchanged, zero new diagnostics.

**Frontend / extension consumer cheat-sheet:**
- Token mint: `POST /api/tokens` with `{label}` → capture `.token` (64-char hex), never returned again.
- Token usage: `Authorization: Bearer <token>` on `/api/ingest/songs`.
- Ingest call: `POST /api/ingest/songs` with `{urls: string[]}` → `{added: [...], failed: [...]}`. Always 200 if the token is valid — per-URL outcomes live inside the body, not in HTTP status.
- Revoke: `DELETE /api/tokens/:id` → 204. Soft delete; row stays visible in `GET /api/tokens` with `revokedAt` populated so the UI can grey it out instead of removing it.
- CORS for extension: any chrome-extension origin works out of the box; preflight is handled.

**Stopping per standing instruction.** Wave 1 backend (T1+T2+T3) complete.
