# Player portal — piece 2: live stats tab — design spec

**Date:** 2026-10-03 · **Status:** design approved in chat 2026-10-03; spec pending review
**Program:** b-side is the ONLY player page (Matt, 2026-10-03). Order: **2 live stats** → 3 survey in portal (proxy) → 4 per-league portal admin (Cloudflare Access path) → 5 research → 6 song rating.
**Builds on:** piece 1 (`2026-10-03-player-portal-1-shell-digests-season-design.md`: `portal.json`, b-side nav) and the 2.0 publisher (`ui/src/lib/digest2/publish.ts`, `publishHtml.ts`: capture, `transformDigest2Html`, `findLeaks`, `swapDirAtomically`).

## 1. Goal

Each league's portal gets a **Stats** tab: the full stats explorer (standings & scores, songs, artists,
vote heatmap, votes given, playlist position, **chat stats**, fun stats, wrapped) for the league, with a
season switcher, refreshed nightly and on demand, served statically from the digest host with the
portal's nav — no admin host anywhere.

**Success criteria**
1. `https://digest.mattmariani.com/<slug>/stats/` shows the current season's explorer; `/stats/s<N>/`
   shows season N; a season switcher links between them. Every explorer tab works (charts draw).
2. The page carries the portal nav (Home · Digests · Stats · Season) and links back into the b-side
   SPA; the b-side nav shows a **Stats** tab when stats are published.
3. A nightly job republishes every league that has a b-side site; `POST /api/portal/<leagueId>/stats/publish`
   republishes one league on demand (the admin button in piece 4 will call it).
4. Every published file passes the existing leak gate (no admin host, no internal origin, no
   root-relative links); a failed publish leaves the previous copy live.
5. No change to `Caddyfile.digest` (stats folders live inside the already-served `/<slug>/` folder).

## 2. Components

### 2.1 Portal stats page (bot-ui)
New route `ui/src/routes/portal-stats/[leagueId]/+page.server.ts` + `+page.svelte`:
- Load: league row + `dashboard_sites.slug` (404 if no b-side site); `season` query param (number) or
  default = the snapshot's default season; `depth` derived from whether a season param is present
  (`/stats/` = 2 levels under the slug, `/stats/s<N>/` = 3). Returns `{ share: true, snapshot, portalNav }`
  where `share: true` triggers the existing bare layout.
- `portalNav = { leagueName, seasons: [{ number, href, current }], homeHref, digestsHref, seasonHref, statsHref }`,
  all **relative** paths computed from depth (e.g. at `/stats/s1/`: home `../../`, digests
  `../../archive`, season `../../season`, stats current `../`, season N `../s<N>/`). Root-relative paths
  are forbidden by the leak gate.
- Page: a slim `PortalStatsNav.svelte` (b-side look: `--ink-*`, `--mash-pulp`, Bricolage/Inter Tight)
  with the four tabs + season switcher, all links `data-sveltekit-reload` (full page loads — the
  static host has no SvelteKit routes for them); then `<StatsExplorer frozen …>` with all tabs
  (chat included — no `omitTabs`, no `omitLeaderboardRace`).
- `StatsExplorer` is reused unchanged except as needed for the frozen mode already shipped
  (season picker, `/stats` link, copy-link hidden).

### 2.2 Stats publisher (bot-ui)
`ui/src/lib/portal/statsPublish.ts`:
- `publishLeagueStats(leagueId, deps?)`: for the current season and each season in
  `snapshot.league.seasons`, capture `${APP_INTERNAL_URL}/portal-stats/<leagueId>?season=<N>` (current
  also captured without the param for `/stats/`), loading **each explorer tab** (`&tab=<id>` for every
  visible tab id) in the same browser so lazily-imported chart chunks are captured, scrolling each to
  the bottom; then transform (`transformDigest2Html`), leak-scan HTML + text assets (`findLeaks`,
  forbidden = app host + internal origin), verify every referenced `./_app/` asset was captured (shared
  helper extracted from `publish.ts` into `publishHtml.ts` as `missingAppAssets(html, assets)`), write to
  `DIGESTS_DIR/<slug>/stats/.<dir>.tmp` and `swapDirAtomically` into `stats/` or `stats/s<N>/`.
- Each season folder swaps independently: a failure in one season is reported and leaves that
  season's previous copy live, while the other seasons still publish.
- Records `portal_stats_published:<leagueId>` setting = JSON `{ updatedAt, current: N, seasons: [N…] }`
  and calls `writePortalJson(db, leagueId)`.
- Returns `{ seasons: [{ number, path, ok, error? }], updatedAt }`. Injectable `capture` for tests.
- One publish at a time per process (simple in-module mutex) — the nightly run and a manual click
  can't collide.

### 2.3 Endpoint + nightly job
- `POST /api/portal/<leagueId>/stats/publish` → 400 bad id, 404 unknown league / no b-side site,
  409 if a publish is already running, 200 with the result (partial failures listed, status 200).
- `POST /api/portal/stats/publish-all` → publishes every league with a `dashboard_sites` row, sequentially;
  returns per-league results.
- Host timer (repo-tracked units in `ops/systemd/`, installed to `~/.config/systemd/user/`):
  `mlb-portal-stats.service` (oneshot `curl -fsS -X POST http://localhost:3002/api/portal/stats/publish-all`)
  + `mlb-portal-stats.timer` (`OnCalendar=*-*-* 03:30:00`, `Persistent=true`).

### 2.4 portal.json + b-side
- `portal.json` v1 gains optional `stats: { updatedAt: string; current: number; seasons: number[] } | null`
  (from the setting; additive — existing readers ignore it). Leak check unchanged.
- b-side `PortalNav`: a **Stats** tab (plain `<a href="stats/">`-style link relative to the slug — full
  page load) shown when `portal.stats` is non-null; mirror the `stats` field in `bside/src/lib/portal.ts`.

## 3. Error handling
- Capture/leak/missing-asset failure for a season → that season's previous copy stays live; result lists
  the error; nightly job exits non-zero if any league fully failed (journal shows it).
- League with no b-side site → skipped (publish-all) / 404 (single).
- Concurrent publish → 409.

## 4. Testing
- Unit: relative nav-path builder (depth 2 vs 3, season links) with fixtures where answers differ;
  `missingAppAssets` (extracted, existing publish tests stay green); `publishLeagueStats` with a fake
  capture: writes `stats/` + `stats/s<N>/`, leak in one season → that season not swapped and others are,
  setting + portal.json updated, mutex → second concurrent call rejected; endpoint 400/404/409/200;
  `portal.json` includes `stats`; b-side `loadPortal` accepts `stats`.
- Route: share mode load returns `share: true` and only relative hrefs (render the nav component via
  `svelte/server` and assert no `href="/`).
- Post-deploy smoke: publish Boarz + Second Best; `/<slug>/stats/` and `/stats/s1/` 200; Playwright: every
  tab's canvases draw, request hosts ⊆ {digest.mattmariani.com, fonts, cloudflareinsights}; no `mlb13`
  in `digests/*/stats/**`; b-side shows the Stats tab; nightly timer listed in `systemctl --user list-timers`.

## 5. Out of scope
Survey in portal (3), portal admin incl. "Refresh stats" button and player visibility (4), research (5),
song rating (6). No live (per-request) stats — nightly + on-demand only.
