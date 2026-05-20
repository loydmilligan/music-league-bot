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
