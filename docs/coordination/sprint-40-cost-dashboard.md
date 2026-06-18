---
status: planned
campaign: openrouter-cost-management
sprint: sprint-40-cost-dashboard
version: v1.8.0
created: 2026-06-17
depends_on: sprint-39-cost-ledger
---

# music-league-bot — coordination doc (sprint-40-cost-dashboard)

> **Sprint:** OpenRouter Cost Management — debug-mode toggle on Settings + a cost dashboard (today's spend by category, individual call drilldown, 2-week stacked-bar chart with per-call shading and hover tooltips).
> Spec: `~/.config/taw/wiki/Projects/music-league-bot/sprint-40-cost-dashboard-spec.md`.
> Depends on sprint-39 (`sprint-39-cost-ledger`) for the `llm_cost_log` table + three read endpoints; builds to contract with local mocks if sprint-39 is not yet merged.
> Realizes roadmap card `settings-debug-mode-cost-dashboard`.

> **AMENDED 2026-06-18 (build-from-prototype; sprint-39 landed):**
> - sprint-39 shipped v1.6.0 — `/api/cost/{summary,daily,calls}` are **LIVE** over the `llm_calls`
>   view. So `a2-cost-endpoints` is **verify-and-smoke only**, not a fallback build; the `calls`
>   endpoint also returns `latency_ms` (a 2nd KPI), not just cost.
> - **The design is the CD handoff prototype**, not a from-scratch mock. Translate the desktop
>   "Cost & routing" view (React→Svelte) from
>   `docs/design/cost-management/_unzip/cost-handoff/reference/cost-dashboard/`: `cost-author.jsx`
>   (task→model layout + decision-dock shell), `cost-q1.jsx` (stacked-bar category colors),
>   `cost-q2.jsx` (cost×latency scatter), `cost-q3.jsx` (weighted value-score sliders),
>   `cost-data2.jsx` (`recommend()` + `SURFACE_STAKES` engines). **Lift the `cost-*.css` wholesale**
>   (Mash Co tokens only). `b0-design-mock` becomes "study the prototype" — do NOT invent a new mock.
> - **SCOPE EXPANDED** to the full prototype dashboard: beyond today's-split + drilldown + 2-week
>   chart, also build the **cost×latency scatter (Q2)** and the **weighted value-score decision dock
>   (Q3, live sliders, lower-is-better normalization)**. Quality axis stays an empty slot (future).
> - Version target → **v1.8.0** (sprint-41 took v1.7.0, shipping ahead of this).
> - A thin first-gen styling may later be restyled by CD's in-flight whole-site alignment pass — acceptable.

## Sprint Goals

Ship a debug-mode toggle in App Settings wired to a new `debug_mode` DB key, a `/settings/debug` tab and page, and three dashboard widgets: today's cost summary (digest / archive / predict split), a call drilldown table, and a 2-week CSS stacked-bar chart (token-derived colors, per-call opacity shading, hover tooltips). No new charting libraries. Build-to-contract against the sprint-39 read API; integrate at the gate.

## Agent Roster — 2 file-disjoint lanes

| Agent | Lane / Owns | Does not touch |
|---|---|---|
| backend (pane 1.2) | **Lane A:** `debug_mode` settings key + migration if needed; `GET /api/settings/debug-mode` + `PUT /api/settings/debug-mode`; the three cost aggregation endpoints (`/api/cost/summary`, `/api/cost/daily`, `/api/cost/calls`) if sprint-39 has not delivered them; route tests | `ui/src/`, `lib/debug/*`, chart components |
| frontend (pane 1.3) | **Lane B:** `ui/src/lib/debug/` (CostBarChart.svelte, CostSummaryCard.svelte, CostCallDrilldown.svelte, costApi.ts, costApi.mock.ts); `/settings/debug/+page.svelte` + `+page.server.ts`; add debug tab to `SettingsTabs.svelte`; debug-mode toggle card on `/settings/+page.svelte`; static HTML mock (task b0) | backend src, `lib/models/*`, `lib/digest/*` |

## Cross-lane CONTRACTS (pinned — no renegotiation)

**1. Settings API (Lane A = source of truth):**
```
GET  /api/settings/debug-mode  → { enabled: boolean }
PUT  /api/settings/debug-mode  body { enabled: boolean } → { enabled: boolean }
```
DB key: `debug_mode` ('true' / 'false'); default 'false'. Same settings table pattern as `predict_model`.

**2. Cost read API (sprint-39 source of truth; Lane A provides if sprint-39 not merged):**
```
GET /api/cost/summary?date=YYYY-MM-DD
  → { digest: number, archive: number, predict: number, total: number }

GET /api/cost/daily?days=14
  → [{ date: string, digest: number, archive: number, predict: number }]

GET /api/cost/calls?date=YYYY-MM-DD
  → [{ ts: string, model: string, category: 'digest'|'archive'|'predict',
       label: string, cost_usd: number,
       prompt_tokens: number, completion_tokens: number }]
```
Lane B builds against the mock at `lib/debug/costApi.mock.ts`; `costApi.ts` swaps to real endpoints at integration. The mock module shape must exactly match the real endpoint response shapes.

**3. Component exports (Lane B = source of truth for all debug UI):**
- `$lib/debug/CostBarChart.svelte` — accepts `days: DailyCost[]` + `callsByDate: Record<string, CostCall[]>`.
- `$lib/debug/CostSummaryCard.svelte` — accepts `summary: DaySummary | null`.
- `$lib/debug/CostCallDrilldown.svelte` — accepts `calls: CostCall[]`.
- `/settings/debug/+page.svelte` — thin page shell; fetches data via `costApi.ts`.

## Working agreements (sprint-40)

- **Lanes are file-disjoint — stay in your lane.** Path-scoped commits; **never `git commit --amend`** on shared HEAD.
- **Build-to-contract:** Lane B does not block on Lane A or sprint-39 — build against the pinned contract with local mocks; integrate at the gate.
- **Design mock first:** Lane B task `b0-design-mock` produces a static HTML mock of the dashboard (summary + drilldown + chart) before any Svelte implementation. Owner review of mock is a soft gate before `b2-widgets` proceeds.
- **No new charting dependencies.** The 2-week bar chart uses the same CSS-bar approach as `StandingsChart.svelte` (flex tracks, style:height, token colors).
- **CSS tokens only** — no raw hex. Colors: `--mash-pulp` (digest), `--moss` (archive), `--ember` or `--fg-quiet` (predict — frontend agent checks full token set; use `--fg-quiet` if `--ember` semantic conflicts). Per-call shades: opacity stepping `1.0 - (index / count) * 0.45`.
- **No emoji** — functional Unicode glyphs only (`⚙ ∑ ◷`). **No raw hex.**
- Svelte 5 runes (`$state`, `$props`, `$derived`).
- Scoped tests per task; the full `cd ui && npm run check` + `vitest run` are the orc gate.
- Sonnet workers. Log each task to the Activity Log with its commit hash.

## Active Sprint Plan

- [ ] {agent: backend, id: a1-debug-setting} **`debug_mode` settings key + API.** Add `debug_mode` key to settings table (default 'false'); `GET /api/settings/debug-mode → { enabled: boolean }`; `PUT /api/settings/debug-mode` body `{ enabled: boolean }`. **Acceptance:** key persists across requests; GET returns `false` before any PUT; route tests for get + set.

- [ ] {agent: backend, id: a2-cost-endpoints, depends: a1-debug-setting} **Cost aggregation endpoints (sprint-39 fallback).** If sprint-39 endpoints are not yet merged: implement `/api/cost/summary`, `/api/cost/daily`, `/api/cost/calls` reading from `llm_cost_log` (sprint-39 schema). If sprint-39 is already merged: verify the three endpoints match the pinned contract shapes and add a smoke test. **Acceptance:** all three endpoints return contract-shaped JSON; empty ledger returns zeros / empty arrays (no 500); route tests green.

- [ ] {agent: frontend, id: b0-design-mock} **Static HTML mock.** Single self-contained HTML file at `docs/design/debug/cost-dashboard-mock.html`: debug tab in the tab row, "Debug mode" toggle card on App Settings, the three dashboard widgets (summary card, drilldown table stub, 2-week chart using inline CSS bars). Demonstrates the color/shade/tooltip concept. **Acceptance:** file opens in browser; owner reviews and says "looks right"; no Svelte required.

- [ ] {agent: frontend, id: b1-tab-and-toggle, depends: b0-design-mock} **Debug tab + toggle wiring.** Add `{ href: '/settings/debug', label: 'Debug', glyph: '⚙' }` to `SettingsTabs.svelte` tabs array; update `isOn` guard so `/settings` does not activate for `/settings/debug`. Add "Debug mode" toggle card to `/settings/+page.svelte` (labeled checkbox + description text); wire to `GET/PUT /api/settings/debug-mode` via a small `$state` reactive fetch (mock until a2 lands). `/settings/debug/+page.svelte` + `+page.server.ts` scaffolded (empty shell with placeholder "Debug mode is off" when not enabled). **Acceptance:** tab renders at 412 + desktop; toggle saves and reloads state; `npm run check` 0 errors.

- [ ] {agent: frontend, id: b2-widgets, depends: b1-tab-and-toggle} **Dashboard widgets.** `lib/debug/costApi.ts` (real endpoint calls + the mock swap); `CostSummaryCard.svelte` (today's totals by category, empty state); `CostCallDrilldown.svelte` (table: time / category / label / model / tokens / cost; sorted newest-first; mobile collapses model column); `CostBarChart.svelte` (2-week vertical stacked-bar, CSS-bar, token colors + opacity shading, hover tooltip per segment, date labels, max-scale, empty states). Wire all three into `/settings/debug/+page.svelte`. **Acceptance:** all three widgets render with mock data; empty states render correctly; `npm run check` 0 errors; scoped component tests for CostBarChart scale + empty branch.

- [ ] {agent: frontend, id: b3-integration, depends: b2-widgets} **Sprint-39 integration + polish.** Swap `costApi.mock.ts` for real endpoint calls once a2 is confirmed green; remove `[MOCK DATA]` badge. Verify tooltip positioning at 412px; verify bar chart at min-width. Add Vitest route test for `debug-mode` toggle (mock fetch). **Acceptance:** widgets render against real API (or sprint-39's merged endpoints); `npm run check` 0; `vitest run` green.

- [ ] {agent: orc, id: gate, depends: a2-cost-endpoints,b3-integration} **Gate.** Cross-check path-scoped commits; `cd ui && npm run check` (0) + `npx vitest run` (green); **owner UAT**: toggle debug ON (App Settings); visit /settings/debug; confirm today's cost split renders (or "(no calls today)"); drilldown table lists calls with labels; 2-week chart shows bars + hover tooltips; toggle debug OFF → placeholder; screenshots 412 + desktop 1280. On sign-off: v-bump to 1.8.0 + CHANGELOG + cached deploy to :3002 + assert live; sprint status → shipped; close.

## v1 scope guardrails

- **No budget alerts** — observability only; no threshold notifications.
- **Global cost totals only** — no per-league, per-round breakdown.
- **No date picker** — today's drilldown + last-14-days chart, fixed.
- **No export** — call log is read-only display.
- **No admin gating on debug mode** — single-user app; the toggle is sufficient.
- **No new charting library** — CSS-bar only.

## Decision Log

### 2026-06-17 — spec authored
- Dashboard as a new `/settings/debug` tab (fourth tab in SettingsTabs, glyph `⚙`) rather than a conditional panel on App Settings — cleaner tab pattern, bookmarkable URL.
- `predict` cost surfaced as a third row/segment rather than collapsed; color = `--ember` (check token set before committing; fall back to `--fg-quiet` if semantic conflict).
- Per-call bar shading = opacity stepping (CSS `opacity`, no raw hex); Option A (14 parallel daily-calls fetches) preferred over a new batch endpoint.
- Static HTML mock (b0) is a soft gate before widget implementation — lightweight "looks right" review, not a formal ratification card.

## Ratification Log

_(none yet)_

## Blockers

- ~~sprint-39-cost-ledger must land before gate~~ — RESOLVED 2026-06-18: sprint-39 shipped v1.6.0; endpoints live over the `llm_calls` view.

## Activity Log

### 2026-06-17 — orc — sprint-40 coord-doc + spec authored
- Spec written to `~/.config/taw/wiki/Projects/music-league-bot/sprint-40-cost-dashboard-spec.md`.
- Two file-disjoint lanes: backend (debug-mode setting + cost endpoint fallback) / frontend (mock → toggle/tab → widgets → integration).
- Ledger read API pinned from sprint-39 contract; mock layer encoded as b0 + costApi.mock.ts.
- Chart color scheme: `--mash-pulp` (digest) / `--moss` (archive) / `--ember` or `--fg-quiet` (predict); opacity-step shading per call within each category.
- Open question logged: predict color semantic conflict check (frontend agent to verify at b2 time).
- Status: planned. Awaiting sprint-39 completion before dispatch.
