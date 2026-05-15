---
project: music-league-bot
sprint: sprint-2
created: 2026-05-14T20:35:00.000Z
updated: 2026-05-14T20:35:00.000Z
---

# music-league-bot — coordination doc (sprint-2)

> Strict template per Session O2=B / seed §12 Phase 8. The dashboard
> reads this as the canonical substrate (seed §3.7); orc emits
> `coord-doc-stale` cards when drift is detected (§3.8 / O7=A).
>
> Section headings are load-bearing — keep them as-is so the parser can
> find them. Section bodies are markdown-flexible.

## Plan Source

- Type: inline
- Path: this document (`## Active Sprint Plan` section)
- Active unit: sprint-2

## Sprint Goals

- Re-skin the dashboard in the prototype design system
- Same features as sprint-1; pulp wordmark, dot scoring, accent orange.

## Active Initiatives

- _None — sprint-2 is design-system reskin only, no new features._

## Active Sprint Plan

<!-- Lightweight task list for the current sprint when `methodology.
     planning: inline` is configured. orc-tower's InlineArtifactSource
     parses this section. Format:

       - [ ] {agent: backend, id: my-task} Body of the task
       - [-] {agent: frontend, depends: my-task} Another task
       - [x] {agent: docs} A done task

     Status:
       - [ ]   pending
       - [-]   in-progress
       - [x]   done
       - [!]   blocked

     Metadata in `{...}` is optional and precedes the body:
       - agent     — must match an entry in `## Agent Roster`
       - depends   — comma-separated; numeric (1-indexed within this
                     section) or slug (matches another task's `id:`)
       - id        — optional slug; makes the task referenceable

     Edit this section directly to add/remove/reorder tasks. orc-tower
     never writes to it; ratification cards propose entries elsewhere
     (Activity Log, Decision Log) but plan changes are author-driven.

     When every task reaches [x], SprintHeader surfaces kickoff buttons
     ("Run sprint review →" / "Plan next sprint →") that pre-fill
     SendPromptModal with the relevant template. The warren never
     auto-sends — the confirmation gate is sacred (CLAUDE.md §3.6).
     See: docs/design/2026-05-05-sprint-kickoff-flow.md -->

- [x] {agent: infra, id: design-tokens} Wire the prototype design system foundations into `ui/`: install Inter Tight (body), Bricolage Grotesque (display/wordmark), JetBrains Mono (mono badges) via Google Fonts; update Tailwind v4 theme tokens with the prototype palette (near-black bg, dark blue-grey panels, accent orange ~`#f04` family, mono green for health chip); update `app.html` font preconnect and `app.css` globals.
  - **Acceptance:** Visiting `/` renders all three font families without FOUT (network panel shows preloaded woff2 files); Tailwind utilities resolve to the prototype's accent orange and near-black bg; a side-by-side screenshot of an unstyled page chrome vs prototype A's chrome shows the palette + type-scale match within a few px.

- [x] {agent: frontend, id: chip-badge-component, depends: design-tokens} Build the reusable chip/badge components from the prototypes: `DeadlineChip` (e.g. "SUBMISSIONS · 3D 14H"), `StatusChip` (e.g. "2 OPEN"), section header label (uppercase letterspaced), dot-prefix status indicator (colored dot + label). Export from `ui/src/lib/components/`.
  - **Acceptance:** `<DeadlineChip phase="submissions" duration="3D 14H" />` renders visually identical to the prototype's deadline chip (orange border + mono + ` · ` separator); `<StatusChip label="2 OPEN" tone="accent" />` matches; `<DotIndicator status="active" />` renders the orange dot. All three components live under `ui/src/lib/components/` and have at least one usage example committed alongside them.

- [x] {agent: frontend, id: layout-shell, depends: design-tokens} Re-skin `+layout.svelte` to match prototype A's left rail: pulp wordmark header at top (from variant B's hero treatment, scaled to fit the rail width — "music-league-bot" in Bricolage italic orange + the `m/l` mark), nav items (Active round, Shortlist, Chat watcher, Link converter, Digest preview, Round history, Setup), Leagues list with colored dot prefixes and member-count subtitles, "Cross-league next" section, footer health badge ("watcher live · Xd uptime") in mono green.
  - **Acceptance:** Side-by-side screenshot of live `/` vs prototype A shows left rail matches in structure, typography, spacing; pulp wordmark visible at top of rail with the correct typeface; footer health badge renders mono + green-tinted background; nav items in the prototype's order.

- [ ] {agent: frontend, id: home-page, depends: layout-shell, chip-badge-component} Re-skin the home page (`/` route): two-section split — "Needs you this week" card with thick orange left border listing leagues with active rounds, followed by "All leagues" card listing every adopted league sorted by next action. Reuse `DeadlineChip` for "SUBMISSIONS · 3D 14H" / "VOTING · 1D 22H" labels and `DotIndicator` for status dots.
  - **Acceptance:** `/` renders the two-section split matching prototype A; "Needs you this week" contains only leagues with an active round (`status='active'`); "All leagues" lists every league with member count + slug; deadline chips show real countdowns from the round table; "+ Adopt league" placeholder CTA visible on the All-leagues card (no-op for now is OK).

- [ ] {agent: frontend, id: season-page, depends: layout-shell, chip-badge-component} Re-skin the season detail page (`/league/[league]/season/[n]`): rounds list as a card grid matching prototype A's card shape, with deadline chip + member count + dot status per round.
  - **Acceptance:** `/league/hip-jammers/season/3` (or any populated season) renders rounds as cards with theme name, member count, deadline chip; clicking a round navigates to the round page; visual styling consistent with home page card surfaces.

- [ ] {agent: frontend, id: round-page, depends: layout-shell, chip-badge-component} Re-skin the round detail page (`/league/[league]/season/[n]/round/[roundId]`): apply the design tokens to the ML / Chat / Research tab strip, song-list rows (with dot scoring 1–5), and update the existing `ResearchList` component (Spotify search box, candidate cards, rating dots, notes, weighted score) to match. The whole page should read in the same visual language as prototype C without implementing head-to-head.
  - **Acceptance:** `/league/.../round/...` renders in prototype style; tab navigation preserves the design language; song rows use orange dot scoring (1–5 dots indicating rating/score); `ResearchList` Spotify search, rating, notes, and weighted-score controls all use the new tokens; YTM deep-link buttons styled.

- [ ] {agent: frontend, id: settings-page, depends: layout-shell, chip-badge-component} Re-skin `/settings`: weights, import/rescan, deadlines, queue status — all wrapped in the design system's card surfaces and chip badges. Match the visual hierarchy of prototype A's content cards.
  - **Acceptance:** `/settings` visually consistent with home/season/round; rating-weight inputs styled in design system; import/rescan button uses the accent button style; queue status section uses `StatusChip` for queue depth and worker state.

- [x] {agent: backend, id: verify-sprint-1} Verify sprint-1's two unverified items end-to-end and fix anything that breaks: (a) populated round-detail render works with real ZIP data after the `.gitkeep` fix; (b) the docker container reads host `./data` and serves a populated round page. Document the smoke-test command + URL + verified output for each in the sprint-2 Activity Log.
  - **Acceptance:** `curl http://localhost:3002/league/hip-jammers/season/3/round/<real-roundId>` returns HTTP 200 with at least one real artist+title pair present in the response body (grep for a known submission string); `docker compose logs bot-ui` shows no errors during startup ZIP import (or shows clean "already imported" lines); both smoke-test commands + verification output appended under a `### 2026-05-XX — backend — sprint-1 verification` entry in this doc's Activity Log.

## Agent Roster

| Agent | Owns | Does not touch |
|---|---|---|
| infra | `ui/package.json`, `ui/svelte.config.js`, `ui/vite.config.ts`, `ui/tsconfig.json`, `ui/src/app.html`, `ui/src/app.css`, `Dockerfile.ui`, `docker-compose.yml`, `.env.example` | `ui/src/**` (after design-tokens lands) |
| backend | `ui/src/lib/**` (except `lib/components/**`), `ui/src/hooks.server.ts`, `ui/src/routes/**/+page.server.ts`, `ui/src/routes/api/**` | `ui/src/routes/**/+page.svelte`, `ui/src/lib/components/**`, infra files |
| frontend | `ui/src/routes/**/+page.svelte`, `ui/src/routes/+layout.svelte`, `ui/src/lib/components/**` | `ui/src/lib/db/**`, `ui/src/lib/import/**`, `ui/src/routes/**/+page.server.ts`, `ui/src/routes/api/**`, infra files |

- **infra** — design-tokens (font installs, Tailwind theme, app.html/app.css).
- **frontend** — chip-badge-component, layout-shell, home-page, season-page, round-page, settings-page (all `+page.svelte` and `lib/components/**` work).
- **backend** — verify-sprint-1 (loaders + import path, fully parallel with reskin work since they don't touch each other's files).

## Decision Log

_No decisions yet._

## Ratification Log

_Sprint-1 review ratification `rn-760a2713` (checkbox-in-the-landing-commit rule) is pending in the inbox; if accepted, it applies to sprint-2 and onward — each agent flips its `[x]` in the same commit (or immediate doc commit) that lands the task._

## Contract Changes

_No contract changes yet — design-tokens introduces new Tailwind utility names; if those names ship, infra should append a contract-change entry here so agents in later sprints know which utilities are canonical._

## Blockers

- **[frontend → backend]** Layout left rail's `LEAGUES` and `CROSS-LEAGUE NEXT` sections need a dedicated `+layout.server.ts` loader so every route — not just `/` — can populate them. Layout currently opportunistically reads `page.data.activeSeasons` from the home loader, which means non-home routes render an empty leagues list. Cross-league-next is a static placeholder ("No upcoming actions.") for the same reason. Proposed loader shape: `getAllAdoptedLeagues()` returning `{ slug, name, status: 'active'|'voting'|'open'|'idle', currentRoundId, currentRoundLabel }[]` and `getCrossLeagueUpcoming()` returning `{ leagueSlug, roundName, phase, deadline }[]`. Frontend ownership stops at `+page.svelte`/`+layout.svelte`/`components/**` so this needs a backend agent — flagged for the next planning cycle, not blocking the rest of sprint-2 (home/season/round/settings reskins can land on top of the placeholder behavior).

## Activity Log

### 2026-05-14 — frontend — layout-shell landed
- `ui/src/routes/+layout.svelte` rewritten as the prototype A left-rail shell + main column.
- **Wordmark:** `MASH CO.` SectionLabel, then `m/l` in `font-display italic text-accent` (Bricolage Grotesque) + `music-league-bot` in `font-mono text-fg-muted` on one baseline, linked to `/`.
- **Primary nav:** seven items in prototype order — Active round (/), Shortlist (/shortlist), Chat watcher (/chat), Link converter (/link), Digest preview (/digest), Round history (/history), Setup (/settings). Each row: ▸ glyph + label + optional right-aligned `<StatusChip tone="muted">` counter (`r-14`, `11`, `3 new`, `13` are visual placeholders — TODO when those routes exist). Current item gets `border-l-2 border-accent` + `bg-accent-bg` + `text-accent`; matches via `page.url.pathname` from `$app/state`.
- **Leagues section:** uses `<SectionLabel>Leagues</SectionLabel>` + `<DotIndicator>` + league name + `r-{roundId} · {status}` sub-line. Data source: opportunistic read of `page.data.activeSeasons` (from the existing home `+page.server.ts` loader — fields `{ league: { slug, name }, seasonNumber, currentRound: { id, submissionDeadline, votingDeadline }, researchCount }`). On `/` this populates correctly (hip-jammers shown active orange + r-102, nostalgia-pit shown idle grey, per verification screenshot). On non-home routes the list is empty — placeholder `_No active leagues._` shows the structure.
- **Cross-league next:** `SectionLabel` + static placeholder `No upcoming actions.` — no loader available yet, flagged in Blockers.
- **Footer health:** `<StatusChip tone="health">WATCHER LIVE · 4D UPTIME</StatusChip>` + mono `sqlite ml-bot.db · 12.4 MB` + mono faint `last poll 6:32:14 PM`. All three values are hardcoded placeholders with TODOs — real watcher uptime / DB size / poll timestamp need a backend loader (same Blocker as leagues).
- **Main column:** `<main class="flex-1 min-w-0 px-6 md:px-10 py-8">` wrapping `<div class="max-w-5xl mx-auto">{@render children?.()}</div>`. The breadcrumb row stays page-level, not layout-level, per the brief.
- **Verification:** `npm run dev` → `curl /` returns HTTP 200 (284kb), `curl /_examples` returns HTTP 200. Playwright screenshot at `docs/screenshots/2026-05-14-sprint2-layout-shell.png` confirms the rail matches prototype A: pulp wordmark scaled to rail width, nav items in order with the right counter chips, Hip Jammers row with orange dot + `r-102 · active`, Nostalgia Pit row with idle grey dot, footer green health chip + mono diagnostics. svelte-check clean on the new file (only pre-existing `vite.config.ts` error remains).
- **Tokens consumed (all from cf5985d):** `bg-bg`, `bg-bg-elevated`, `bg-surface`, `bg-accent-bg`, `border-border-muted`, `border-accent`, `text-fg`, `text-fg-muted`, `text-fg-dim`, `text-fg-faint`, `text-accent`, `text-accent-strong`, `font-sans` (inherited), `font-display`, `font-mono`. Atoms consumed: `SectionLabel`, `StatusChip` (muted + health tones), `DotIndicator` (active + idle).
- commit: 3290265

### 2026-05-14 — frontend — chip-badge-component landed
- Four reusable atoms under `ui/src/lib/components/`:
  - `DeadlineChip.svelte` — props `phase: 'submissions' | 'voting' | 'review' | 'archived'`, `duration: string`. Uses `border-accent-deep` + `text-accent` + `font-mono` + `tracking-widest` + uppercase, with a `·` separator between phase label and duration.
  - `StatusChip.svelte` — props `label: string`, `tone: 'accent' | 'health' | 'muted' | 'warn'`. Tone palette: `bg-accent-bg`/`text-accent`/`border-accent-deep` (accent); `bg-health-bg`/`text-health`/`border-health/40` (health); `bg-surface`/`text-fg-dim`/`border-border-muted` (muted); `bg-warn/15`/`text-warn`/`border-warn/40` (warn — derived via Tailwind v4 alpha modifier since no dedicated `warn-bg` token exists yet).
  - `SectionLabel.svelte` — slot via `children` snippet. Uses `text-fg-faint` + `font-mono` + `text-xs` + `tracking-widest` + `font-bold` + uppercase.
  - `DotIndicator.svelte` — props `status: 'active' | 'voting' | 'open' | 'idle'`, optional `size: 'sm' | 'md'`. Maps active→`bg-accent`, voting→`bg-warn`, open→`bg-health`, idle→`bg-fg-faint`.
- Usage example: `ui/src/routes/_examples/+page.svelte` (not navigation-linked — visit `/_examples` to eyeball). Sections per atom plus a composed "leagues list row" using all four together.
- Verified: `npm run dev` → `curl /_examples` returns HTTP 200; visual screenshot via Playwright matches prototype A — orange-bordered mono `SUBMISSIONS · 3D 14H` / `VOTING · 1D 22H` chips, green health chip for `WATCHER LIVE`, muted `IDLE` chip, yellow `STALE` warn chip, dot indicators in the correct hues. `svelte-check` clean on all four files + the showcase route (only the pre-existing `vite.config.ts` error remains).
- Tokens consumed (all from design-tokens at `cf5985d`): `bg-accent-bg`, `text-accent`, `border-accent-deep`, `bg-health-bg`, `text-health`, `bg-surface`, `text-fg-dim`, `border-border-muted`, `text-warn`, `bg-warn`, `text-fg-faint`, `bg-accent`, `bg-health`, `bg-fg-faint`, `font-mono`.
- commit: 29cd253

### 2026-05-14 — infra — design-tokens landed
- `ui/src/app.html`: preconnect to `fonts.googleapis.com` + `fonts.gstatic.com`; preload + stylesheet `<link>` loading **Inter Tight** (300–700, italic), **Bricolage Grotesque** (12–96 opsz, 300–800), **JetBrains Mono** (400–700) from Google Fonts (`display=swap`). Body wears `class="bg-bg text-fg font-sans antialiased"` so the dark theme is the SSR default before any route mounts.
- `ui/src/app.css`: Tailwind v4 `@theme { … }` block defines the prototype palette and font stack. Tokens (with rationale):
  - **Type:** `--font-sans` = `"Inter Tight"`, `--font-display` = `"Bricolage Grotesque"`, `--font-mono` = `"JetBrains Mono"` — matches the three families found across every prototype HTML's `font-family:` declarations.
  - **Surfaces:** `--color-bg` `#07090c`, `--color-bg-elevated` `#0d1116`, `--color-surface` `#141921`, `--color-surface-hover` `#1d2128`, `--color-surface-strong` `#283039`. Hex values come from prototype A's `background-color: rgb(...)` set — `rgb(7,9,12)` for page, `rgb(20,25,33)` for cards.
  - **Borders:** `--color-border` `#3a4451` (= `rgb(58,68,81)`), `--color-border-muted` `#283039`.
  - **Text:** `--color-fg` `#f1f4f7` (primary), `--color-fg-warm` `#faf7f2` (warm white reserved for the pulp wordmark — observed in prototype B), `--color-fg-muted` `#c2cad3`, `--color-fg-dim` `#8b97a4`, `--color-fg-faint` `#5a6773`.
  - **Accent orange:** `--color-accent` `#ff5b2e` (= `rgb(255,91,46)` — the primary accent in every prototype), `--color-accent-strong` `#d94c23` (hover/pressed), `--color-accent-deep` `#8a2d15` (deep border tone, observed on chip outlines), `--color-accent-bg` `#221a14` (tinted card surface), `--color-accent-bg-strong` `#3a2e15`.
  - **Health green (footer / status chips):** `--color-health` `#3ec27a` = `rgb(62,194,122)`, `--color-health-bg` `#1d3a2a`, `--color-health-bg-strong` `#1e4d33`.
  - **Secondary accents (used sparingly):** `--color-warn` `#e8a83a` (yellow), `--color-rose-bg` `#3b1a22`.
  - Globals: `color-scheme: dark`, `html/body { background-color: var(--color-bg); color: var(--color-fg); font-family: var(--font-sans); }`, font-feature-settings tuned, `::selection` uses the accent orange.
- **Choice notes:** the accent orange family was unambiguous (`rgb(255,91,46)` for fill, `rgb(217,76,35)` for hover, `rgb(138,45,21)` for borders) — picked `#ff5b2e` as the base since it's the dominant fill in prototype A's section indicators. The brief mentioned `#f04` as a hint, but the prototypes consistently use `#ff5b2e` (a redder, brighter orange), so the prototypes win.
- **Verified:** `DATA_DIR=…/data npm run dev` boots clean (port 5174), `/` returns HTTP 200, response body contains all three `fonts.googleapis.com` links (preconnect + preload + stylesheet) and `Inter+Tight`, `Bricolage+Grotesque`, `JetBrains+Mono` family params. Body element renders with `class="bg-bg text-fg font-sans antialiased"`. Tailwind-compiled CSS contains `--font-sans: "Inter Tight"` and `--color-bg: #07090c` (so the `bg-bg` / `font-sans` utilities resolve correctly).
- **Contract change:** new Tailwind utilities exposed for downstream agents — `bg-bg`, `bg-bg-elevated`, `bg-surface`, `bg-surface-hover`, `bg-surface-strong`, `border-border`, `border-border-muted`, `text-fg`, `text-fg-warm`, `text-fg-muted`, `text-fg-dim`, `text-fg-faint`, `bg-accent`/`text-accent`/`border-accent` (+ `-strong`, `-deep`, `-bg`, `-bg-strong`), `bg-health`/`text-health` (+ `-bg`, `-bg-strong`), `bg-warn`/`text-warn`, `font-sans`, `font-display`, `font-mono`. Will mirror under Contract Changes in a follow-up doc commit if other agents start referencing them.
- commit: `cf5985d`

### 2026-05-14 — backend — sprint-1 verification
- **Round picked:** `second-best` / season 1 / round 97 ("New Shit") — 12 ml_submissions
- **(a) Local dev — populated round render:** PASS after a loader fix
  - Command: `cd ui && npm run dev` then `curl -s http://localhost:5174/league/second-best/season/1/round/97`
  - First run returned HTTP 500 — `getDb()` opened `data/league.db` relative to cwd (`ui/`) which doesn't exist. hooks.server.ts had a correct DATA_DIR default but never exported it. Fix: set `process.env.DATA_DIR` before `getDb()` so loaders see the same path the startup scan uses. Docker is unaffected because compose already sets `DATA_DIR=/app/data`. Commit: `1997f14`.
  - After fix: HTTP 200, 33892 bytes; grep finds real artists/titles: `100 gecs`, `Hollywood Baby`, `Kevin Morby`, `LCD Soundsystem`, `New Shit` (round name). Server-rendered payload includes 12 ml_submissions with totalPoints/rank.
- **(b) Docker container — populated round on :3002:** PASS
  - Command: `curl -s http://localhost:3002/league/second-best/season/1/round/97`
  - HTTP 200, 12119 bytes (smaller because prod build, no Vite client). Grep matches the same artist+title strings.
  - `docker compose logs bot-ui` clean — no startup errors, no ENOTDIR from the previously-stuck `.gitkeep` path (sprint-1 commit `32544a4` is in the running image), just `Listening on http://0.0.0.0:3002` plus favicon 404s.
- **Result:** both sprint-1 carryover items closed. No blockers surfaced.
- commits: `1997f14` (loader DATA_DIR fix), this doc commit (flip `[x]` + log).

### 2026-05-14 — docs — Sprint plan refresh: prototype design system reskin
- replaced `## Active Sprint Plan` body with 8 tasks for the prototype design system reskin (1 infra / 6 frontend / 1 backend)
- scope intentionally narrow per user direction: re-skin only, no new features (no head-to-head, no new pages, no schema changes)
- design system inputs: prototype A (Picker / Orc Tower-style) layout + prototype B (Hero with pulp wordmark) wordmark + the prototype design tokens visible across all 9 files in `docs/prototype/` — Inter Tight body / Bricolage Grotesque display / JetBrains Mono badges, near-black bg with orange accent, card surfaces with mono chip badges
- carries forward sprint-1's two unverified items (round-render with real data, docker against host volume) as `verify-sprint-1`
- depends graph: `design-tokens` first (infra), then `layout-shell` + `chip-badge-component` in parallel (frontend), then four page reskins in parallel (frontend); `verify-sprint-1` runs in parallel from sprint start (backend)
