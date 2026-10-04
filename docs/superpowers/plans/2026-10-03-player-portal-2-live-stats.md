# Player Portal Piece 2 (Live Stats Tab) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish each league's full stats explorer (all tabs incl. chat, per season) as static, leak-checked pages under `digest.mattmariani.com/<slug>/stats/`, styled with the portal nav, refreshed nightly and on demand, and linked from the b-side nav.

**Architecture:** A new bare-layout bot-ui route `/portal-stats/[leagueId]?season=N&depth=2|3` renders a portal nav (relative links only) + `StatsExplorer frozen`. A stats publisher (sibling of the 2.0 publisher, sharing its helpers) captures every season × every tab in one headless browser, transforms + leak-scans + asset-checks, and swaps each season into `DIGESTS_DIR/<slug>/stats/` (current) and `stats/s<N>/`. It records a setting that `portal.json` exposes as `stats`, which the b-side nav uses to show a Stats tab. A host systemd timer calls a publish-all endpoint nightly.

**Tech Stack:** SvelteKit + better-sqlite3 + Vitest + puppeteer-core (`ui/`), Svelte 5 SPA (`bside/`), systemd user timers.

**Spec:** `docs/superpowers/specs/2026-10-03-player-portal-2-live-stats-design.md`

## Global Constraints

- No published file may contain the admin host `new URL(appBaseUrl()).host` or the internal origin host, and published HTML may contain **no root-relative links** — reuse `findLeaks` (`ui/src/lib/digest2/publishHtml.ts`). All portal-nav links are relative paths.
- No changes to `Caddyfile.digest`. Stats live in `DIGESTS_DIR/<slug>/stats/…`.
- Writes allowed: `DIGESTS_DIR/<slug>/stats/**`, `DIGESTS_DIR/<slug>/portal.json`, setting `portal_stats_published:<leagueId>`. Nothing else.
- Each season folder swaps atomically and independently (`swapDirAtomically`); a failed season leaves its previous copy live.
- One stats publish at a time per process (module mutex) → concurrent request = 409.
- Existing `publishDigest2` behaviour and its tests must stay green after helper extraction.
- No hardcoded hostnames in `ui/` (`hostLiterals.test.ts` has 3 pre-existing failures; add none).
- `cd ui && npm run check` 0 errors; `cd bside && npm run check` no NEW errors (4 pre-existing in ProfileScreen.svelte).
- Repo rules: gitnexus impact before editing existing symbols (CLI from main repo, stale index → grep fallback, report it); detect-changes once at merge.
- Commit trailers exactly (adjacent lines, final paragraph):
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01SAJiVCbHEqhbaSePqoQF5v
  ```
- Never push; never touch `~/Projects/boarz-season-2-survey`; tests never write to the real `data/` or `digests/`.

## Review Focus

1. **Relative links at depth 3** (`/stats/s1/`): home must be `../../`, not `../` — a wrong depth silently 404s on the static host. Pinned in Task 2.
2. **Lazy chart chunks per tab** — a tab never loaded during capture publishes blank charts and passes the missing-asset check (lazy chunks aren't in index.html). Pinned in Task 3 (capture visits every visible tab id; test asserts the URL list).
3. **A league whose only season has no completed rounds** (new season, round 1 open) → snapshot arrays empty; page must render and publish, not crash. Pinned in Task 2 (route load with empty snapshot) and Task 3.
4. **Concurrent nightly + manual publish** → 409, no interleaved temp dirs. Pinned in Task 3/4.
5. **League without a b-side site** → skipped by publish-all, 404 on single publish. Pinned in Task 4.

---

## File Structure

| File | Responsibility |
|---|---|
| `ui/src/lib/digest2/publishHtml.ts` (modify) | + `missingAppAssets(html, assets)` (moved from publish.ts). |
| `ui/src/lib/digest2/publish.ts` (modify) | export `localizeFonts`, `APP_INTERNAL_URL`, `TEXT_EXT`; use `missingAppAssets`. |
| `ui/src/lib/portal/statsNav.ts` (new) | Pure relative-path builder for the portal stats nav. |
| `ui/src/lib/portal/PortalStatsNav.svelte` (new) | Portal-styled nav + season switcher. |
| `ui/src/routes/portal-stats/[leagueId]/+page.server.ts`, `+page.svelte` (new) | Bare-layout stats page for capture. |
| `ui/src/lib/portal/statsPublish.ts` (new) | Capture all seasons × tabs, gate, swap, record, refresh portal.json; mutex. |
| `ui/src/lib/portal/portalJson.ts` (modify) | `stats` field from the setting. |
| `ui/src/routes/api/portal/[leagueId]/stats/publish/+server.ts`, `ui/src/routes/api/portal/stats/publish-all/+server.ts` (new) | Endpoints. |
| `bside/src/lib/portal.ts`, `bside/src/lib/atoms/PortalNav.svelte` (modify) | `stats` field + Stats tab. |
| `ops/systemd/mlb-portal-stats.service`, `.timer` (new) | Nightly publish-all. |

---

### Task 1: Share publisher helpers

**Files:** Modify `ui/src/lib/digest2/publishHtml.ts`, `ui/src/lib/digest2/publish.ts`; Test `ui/src/lib/digest2/publishHtml.test.ts` (extend).

**Interfaces — Produces:** `export function missingAppAssets(html: string, assets: Map<string, Buffer>): string[]` (paths like `_app/x.js` referenced as `./_app/…` in html, excluding `_app/fonts.css`, absent from `assets` keyed `/_app/…`); from publish.ts: `export async function localizeFonts(html, assets)`, `export const APP_INTERNAL_URL`, `export const TEXT_EXT`.

- [ ] **Step 1: Failing tests** in `publishHtml.test.ts`:

```ts
import { missingAppAssets } from './publishHtml.js';
describe('missingAppAssets', () => {
	const html = '<script src="./_app/a.js"></script><link href="./_app/b.css"><link href="./_app/fonts.css">import("./_app/c.js?v=1")';
	it('lists referenced assets that were not captured', () => {
		const assets = new Map([['/_app/a.js', Buffer.from('')]]);
		expect(missingAppAssets(html, assets).sort()).toEqual(['_app/b.css', '_app/c.js']);
	});
	it('ignores fonts.css and returns [] when all present', () => {
		const assets = new Map(['/_app/a.js', '/_app/b.css', '/_app/c.js'].map((k) => [k, Buffer.from('')] as [string, Buffer]));
		expect(missingAppAssets(html, assets)).toEqual([]);
	});
});
```

- [ ] **Step 2:** Run `cd ui && npx vitest run src/lib/digest2/publishHtml.test.ts` → FAIL (not exported).
- [ ] **Step 3:** Implement in `publishHtml.ts` (move the loop from publish.ts verbatim):

```ts
export function missingAppAssets(html: string, assets: Map<string, Buffer>): string[] {
	const missing = new Set<string>();
	for (const m of html.matchAll(/\.\/(_app\/[^"'\s)>?#]+)/g)) {
		if (m[1] !== '_app/fonts.css' && !assets.has('/' + m[1])) missing.add(m[1]);
	}
	return [...missing];
}
```

In `publish.ts` replace the inline loop with `const missing = missingAppAssets(indexHtml, assets); if (missing.length) throw new Digest2PublishError(500, \`Publish blocked — missing assets: ${missing.slice(0, 10).join(', ')}\`);` and add `export` to `localizeFonts`, `APP_INTERNAL_URL`, `TEXT_EXT` (no behaviour change).
- [ ] **Step 4:** Run `cd ui && npx vitest run src/lib/digest2 "src/routes/api/digest2"` → all PASS; `npm run check` 0 errors.
- [ ] **Step 5: Commit** `refactor(digest2): share missingAppAssets/localizeFonts with the portal stats publisher`

---

### Task 2: Portal stats route (nav builder, nav component, page)

**Files:** Create `ui/src/lib/portal/statsNav.ts`, `ui/src/lib/portal/statsNav.test.ts`, `ui/src/lib/portal/PortalStatsNav.svelte`, `ui/src/routes/portal-stats/[leagueId]/+page.server.ts`, `+page.svelte`, `ui/src/lib/portal/portalStatsRoute.test.ts`.

**Interfaces — Produces:**
```ts
export interface StatsNav { leagueName: string; homeHref: string; digestsHref: string; seasonHref: string;
  seasons: { number: number; href: string; current: boolean; selected: boolean }[] }
export function buildStatsNav(o: { leagueName: string; depth: 2 | 3; seasons: number[]; currentSeason: number; selectedSeason: number }): StatsNav
```
Rules: `up = depth === 2 ? '../' : '../../'`; `homeHref = up`, `digestsHref = up + 'archive'`, `seasonHref = up + 'season'`; season links relative to the `stats/` folder: from depth 2 → current `./`, other `s<N>/`; from depth 3 → current `../`, other `../s<N>/`. Seasons sorted descending.

Route load (`+page.server.ts`): `leagueId` int else 400; league + `dashboard_sites` row else 404; `season = Number(url.searchParams.get('season'))` if present; `depth = url.searchParams.get('depth') === '3' ? 3 : 2`; snapshot via `buildSnapshotCached({ leagueSlug, seasons: season ? [season] : undefined })` (404 on throw); `currentSeason` = active season number (else max); returns `{ share: true, snapshot, nav: buildStatsNav(...) }`.

Page: `<PortalStatsNav nav={data.nav} />` then `<StatsExplorer snapshot={data.snapshot} basePath="./" frozen />`. `PortalStatsNav`: b-side tokens (copy the color values used in `bside/src/colors_and_type.css`: bg `#0d1116`, fg `#c2cad3`, accent `#ff5b2e`; fonts Bricolage Grotesque / Inter Tight), tabs Home · Digests · **Stats** (active) · Season, season pills; every `<a>` has `data-sveltekit-reload`.

- [ ] **Step 1: Failing tests** `statsNav.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildStatsNav } from './statsNav.js';
describe('buildStatsNav', () => {
	it('depth 2 (/stats/) uses ../ and season links relative to stats/', () => {
		const n = buildStatsNav({ leagueName: 'Boarz', depth: 2, seasons: [1, 2], currentSeason: 2, selectedSeason: 2 });
		expect([n.homeHref, n.digestsHref, n.seasonHref]).toEqual(['../', '../archive', '../season']);
		expect(n.seasons).toEqual([
			{ number: 2, href: './', current: true, selected: true },
			{ number: 1, href: 's1/', current: false, selected: false }
		]);
	});
	it('depth 3 (/stats/s1/) climbs two levels', () => {
		const n = buildStatsNav({ leagueName: 'Boarz', depth: 3, seasons: [1, 2], currentSeason: 2, selectedSeason: 1 });
		expect([n.homeHref, n.digestsHref, n.seasonHref]).toEqual(['../../', '../../archive', '../../season']);
		expect(n.seasons).toEqual([
			{ number: 2, href: '../', current: true, selected: false },
			{ number: 1, href: '../s1/', current: false, selected: true }
		]);
	});
	it('never emits a root-relative href', () => {
		const n = buildStatsNav({ leagueName: 'X', depth: 3, seasons: [1, 2, 3], currentSeason: 3, selectedSeason: 1 });
		for (const h of [n.homeHref, n.digestsHref, n.seasonHref, ...n.seasons.map((s) => s.href)]) expect(h.startsWith('/')).toBe(false);
	});
});
```

`portalStatsRoute.test.ts`: (a) render `PortalStatsNav` via `svelte/server` with a depth-3 nav → body has no `href="/`, contains `data-sveltekit-reload`, and `href="../../archive"`; (b) the route `load` (mock `$lib/db/client.js` with an in-memory `openLeagueDb(':memory:')` seeded with a league + season + `dashboard_sites`, and mock `$lib/server/boarzStats/data.js` `buildSnapshotCached` to return a minimal snapshot with `league.seasons`) → returns `share: true` and the nav; unknown league → 404; league without `dashboard_sites` → 404; bad id → 400.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run tests PASS; `npm run check` 0 errors. Manual: against a DB copy (`cp data/league.db /tmp/claude-1000/p2data/`), `DATA_DIR=… PORT=5198 node build` after `npm run build`, `curl -s 'http://localhost:5198/portal-stats/5?depth=2' | grep -oE '(href|src|action)="/[^/"][^"]*"' | sort -u` → only icon/manifest `<link>`s (stripped later by the transform); kill the server.
- [ ] **Step 5: Commit** `feat(portal): bare-layout portal stats page with relative portal nav`

---

### Task 3: Stats publisher + portal.json `stats`

**Files:** Create `ui/src/lib/portal/statsPublish.ts`, `ui/src/lib/portal/statsPublish.test.ts`, `ui/src/lib/boarzStats/tabs.ts`; Modify `ui/src/lib/portal/portalJson.ts` (+ test), `ui/src/lib/components/boarzStats/StatsExplorer.svelte` (import `STATS_TABS` instead of its inline `TABS` — impact-check first; no behaviour change).

**Tab list extraction (do first):** move the inline `const TABS = [...] as const` from `StatsExplorer.svelte` verbatim into `ui/src/lib/boarzStats/tabs.ts` as `export const STATS_TABS = [...] as const; export type StatsTabId = (typeof STATS_TABS)[number]['id'];`, and have StatsExplorer use it (`const TABS = STATS_TABS`). The publisher computes per-season tab ids with `computeVisibleTabIds(STATS_TABS, { hasChat: snapshot.capabilities.chat, isAllSeasons: false, crossSeasonView: 'combined', omitTabs: [] })`. Confirm StatsExplorer selects its initial tab from the `tab` query param (it writes `tab` in `syncUrl`); if it doesn't read it on load, capture must instead click each tab button — say which in the report.

**Interfaces — Produces:**
```ts
export type StatsCapture = (urls: string[]) => Promise<{ html: Map<string, string>; assets: Map<string, Buffer> }>; // html keyed by url
export interface StatsSeasonResult { number: number; path: string; ok: boolean; error?: string }
export class StatsPublishBusyError extends Error {}
export function statsCaptureUrls(leagueId: number, season: number, depth: 2 | 3, tabIds: string[]): string[]
export async function publishLeagueStats(leagueId: number, deps?: { capture?: StatsCapture; digestsDir?: string; localizeFonts?: typeof localizeFonts }): Promise<{ updatedAt: string; seasons: StatsSeasonResult[] }>
```
- `statsCaptureUrls` → first the base `…/portal-stats/<id>?season=<n>&depth=<d>` (its HTML is the published `index.html`), then the same + `&tab=<id>` for each tab id. Tab ids = the explorer's tab ids filtered with `computeVisibleTabIds` for that snapshot (no chat tab when `capabilities.chat` is false).
- `publishLeagueStats`: throws `StatsPublishBusyError` if a publish is running (module-level flag, released in `finally`); 404-style `Error('no b-side site')` if no `dashboard_sites`. Seasons = `snapshot.league.seasons` numbers (from `buildSnapshotCached({ leagueSlug, seasons: 'all' })`); current = active else max. Targets: `{ season: current, depth: 2, dir: 'stats' }` plus `{ season: n, depth: 3, dir: 'stats/s<n>' }` for every season (including current). For each target: capture → base html → `localizeFonts` → `transformDigest2Html` → `findLeaks` (html + text assets incl. fonts.css; forbidden app host + internal host) → `missingAppAssets` → write into `<slug>/stats/.tmp-<dirname>` → `swapDirAtomically(tmp, final)`. A target failure records `{ ok: false, error }` and continues. After the loop, if ≥1 target ok: set `portal_stats_published:<leagueId>` = `JSON.stringify({ updatedAt, current, seasons: okSeasonNumbers })` and `await writePortalJson(db, leagueId).catch(warn)`.
- Default capture: one puppeteer browser (viewport 1280×900), each URL in a new page, same response-capture filter as `publish.ts` (GET, ok, same origin, `/_app/`), scroll to bottom + `waitForNetworkIdle({ idleTime: 500, timeout: 30000 })`, `Promise.allSettled` pending captures before close.
- `portalJson.ts`: `PortalJson` gains `stats: { updatedAt: string; current: number; seasons: number[] } | null` from the setting (invalid JSON → null).

- [ ] **Step 1: Failing tests** `statsPublish.test.ts` (in-memory DB via mocked `$lib/db/client.js`; mock `$lib/server/boarzStats/data.js` `buildSnapshotCached` → snapshot with `league.seasons [{number:1,status:'complete'},{number:2,status:'active'}]`, `capabilities.chat true`; temp `digestsDir`; fake capture returning per-URL HTML `<html><head></head><body><script src="../_app/x.js"></script>S<season></body></html>` and asset `/_app/x.js`; `localizeFonts` stub → null):
  - writes `<slug>/stats/index.html` (season 2), `<slug>/stats/s1/index.html`, `<slug>/stats/s2/index.html`; result all ok; setting recorded with `current: 2, seasons: [1, 2]` (order-insensitive); `portal.json` (written to the same temp dir) has `stats.current === 2`.
  - capture URLs include one `&tab=<id>` per visible tab, including `chat` (assert via a spy on the fake capture's argument).
  - season 1's HTML contains the app host → `s1` result `ok:false` with a leak error, `stats/s1/` NOT created (and a pre-existing `stats/s1/index.html` "OLD" stays "OLD"), other targets ok.
  - a second concurrent call while the first awaits a deferred capture → rejects `StatsPublishBusyError`.
  - league without `dashboard_sites` → rejects.
  Extend `portalJson.test.ts`: setting present → `stats` populated; absent/invalid → `null`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** `cd ui && npx vitest run src/lib/portal src/lib/digest2` PASS; `npm run check` 0 errors.
- [ ] **Step 5: Commit** `feat(portal): nightly-capable stats publisher (per-season, per-tab capture, leak-gated, atomic)`

---

### Task 4: Endpoints

**Files:** Create `ui/src/routes/api/portal/[leagueId]/stats/publish/+server.ts` (+ `server.test.ts`), `ui/src/routes/api/portal/stats/publish-all/+server.ts` (+ `server.test.ts`).

- Single: 400 bad id; 404 unknown league or no b-side site; 409 on `StatsPublishBusyError`; else 200 `{ updatedAt, seasons }` (partial failures included, still 200).
- All: for each `dashboard_sites.league_id` (sequential) call `publishLeagueStats`; collect `{ leagueId, ok, seasons?, error? }`; 200 with `{ results }`; if every league failed → 500 with the same body.
- [ ] **Step 1: Failing tests** with `publishLeagueStats` mocked (vi.hoisted): 400/404/409/200 for single; publish-all iterates exactly the leagues with sites (seed 2 sites + 1 site-less league) and returns 500 only when all fail.
- [ ] **Step 2–4:** Run FAIL → implement → PASS; `npm run check` 0 errors.
- [ ] **Step 5: Commit** `feat(portal): stats publish + publish-all endpoints`

---

### Task 5: b-side Stats tab

**Files:** Modify `bside/src/lib/portal.ts` (add `stats` to the `PortalJson` mirror — must match Task 3 exactly), `bside/src/lib/atoms/PortalNav.svelte`; Test: extend `ui/src/lib/portal/bsidePortal.test.ts` (`loadPortal`/types accept `stats`).

- PortalNav: a **Stats** tab between Digests and Season, shown when `portal?.stats` is non-null, rendered as a plain `<a href={statsHref}>` where `statsHref` is relative to the current SPA path: on `/<slug>/` → `stats/`; on `/<slug>/archive`, `/<slug>/season`, `/<slug>/p/<id>` → compute from `window.location.pathname` the path back to `/<slug>/` + `stats/` using relative segments (no root-relative href; add a tiny pure helper `statsHrefFor(pathname, slug)` in `portal.ts` with tests: `/s/`→`stats/`, `/s/archive`→`stats/`, `/s/p/12`→`../stats/`).
- [ ] Steps: failing helper tests → implement → `cd ui && npx vitest run src/lib/portal` PASS → `cd bside && npm run check` (no new errors) → `npm run build` → `grep -rE "mlb[0-9]+|192\.168\." bside/dist || echo clean` → commit `feat(bside): Stats tab in the portal nav`.

---

### Task 6: Nightly timer units (repo) + controller go-live

**Files:** Create `ops/systemd/mlb-portal-stats.service`, `ops/systemd/mlb-portal-stats.timer`.

```ini
# mlb-portal-stats.service
[Unit]
Description=Republish player-portal stats pages for every league (static, leak-gated)
After=default.target

[Service]
Type=oneshot
ExecStart=/usr/bin/curl -fsS -m 1200 -X POST http://localhost:3002/api/portal/stats/publish-all
StandardOutput=journal
StandardError=journal
```
```ini
# mlb-portal-stats.timer
[Unit]
Description=Nightly player-portal stats publish

[Timer]
OnCalendar=*-*-* 03:30:00
Persistent=true

[Install]
WantedBy=timers.target
```
- [ ] Implementer: create both files, commit `ops(portal): nightly stats publish timer units`.
- [ ] Controller (after final review): merge to master (check main-checkout state first); detect-changes; deploy bot-ui; deploy bside (`bside.js`/`bside.css` only, with `.bak`); `cp ops/systemd/mlb-portal-stats.* ~/.config/systemd/user/ && systemctl --user daemon-reload && systemctl --user enable --now mlb-portal-stats.timer`; run once `systemctl --user start mlb-portal-stats.service`; smoke per spec §4 (all tabs draw, request hosts, no `mlb13` in `digests/*/stats/**`, Stats tab visible in b-side); report; no push.
