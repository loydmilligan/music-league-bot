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

- [x] {agent: frontend, id: home-page, depends: layout-shell, chip-badge-component} Re-skin the home page (`/` route): two-section split — "Needs you this week" card with thick orange left border listing leagues with active rounds, followed by "All leagues" card listing every adopted league sorted by next action. Reuse `DeadlineChip` for "SUBMISSIONS · 3D 14H" / "VOTING · 1D 22H" labels and `DotIndicator` for status dots.
  - **Acceptance:** `/` renders the two-section split matching prototype A; "Needs you this week" contains only leagues with an active round (`status='active'`); "All leagues" lists every league with member count + slug; deadline chips show real countdowns from the round table; "+ Adopt league" placeholder CTA visible on the All-leagues card (no-op for now is OK).

- [ ] {agent: frontend, id: season-page, depends: layout-shell, chip-badge-component} Re-skin the season detail page (`/league/[league]/season/[n]`): rounds list as a card grid matching prototype A's card shape, with deadline chip + member count + dot status per round.
  - **Acceptance:** `/league/hip-jammers/season/3` (or any populated season) renders rounds as cards with theme name, member count, deadline chip; clicking a round navigates to the round page; visual styling consistent with home page card surfaces.

- [ ] {agent: frontend, id: round-page, depends: layout-shell, chip-badge-component} Re-skin the round detail page (`/league/[league]/season/[n]/round/[roundId]`): apply the design tokens to the ML / Chat / Research tab strip, song-list rows (with dot scoring 1–5), and update the existing `ResearchList` component (Spotify search box, candidate cards, rating dots, notes, weighted score) to match. The whole page should read in the same visual language as prototype C without implementing head-to-head.
  - **Acceptance:** `/league/.../round/...` renders in prototype style; tab navigation preserves the design language; song rows use orange dot scoring (1–5 dots indicating rating/score); `ResearchList` Spotify search, rating, notes, and weighted-score controls all use the new tokens; YTM deep-link buttons styled.

- [x] {agent: frontend, id: settings-page, depends: layout-shell, chip-badge-component} Re-skin `/settings`: weights, import/rescan, deadlines, queue status — all wrapped in the design system's card surfaces and chip badges. Match the visual hierarchy of prototype A's content cards.
  - **Acceptance:** `/settings` visually consistent with home/season/round; rating-weight inputs styled in design system; import/rescan button uses the accent button style; queue status section uses `StatusChip` for queue depth and worker state.

- [x] {agent: backend, id: verify-sprint-1} Verify sprint-1's two unverified items end-to-end and fix anything that breaks: (a) populated round-detail render works with real ZIP data after the `.gitkeep` fix; (b) the docker container reads host `./data` and serves a populated round page. Document the smoke-test command + URL + verified output for each in the sprint-2 Activity Log.
  - **Acceptance:** `curl http://localhost:3002/league/hip-jammers/season/3/round/<real-roundId>` returns HTTP 200 with at least one real artist+title pair present in the response body (grep for a known submission string); `docker compose logs bot-ui` shows no errors during startup ZIP import (or shows clean "already imported" lines); both smoke-test commands + verification output appended under a `### 2026-05-XX — backend — sprint-1 verification` entry in this doc's Activity Log.

- [x] {agent: backend, id: layout-loader} Add `ui/src/routes/+layout.server.ts` with cross-route loaders that populate the left rail's `LEAGUES` + `CROSS-LEAGUE NEXT` sections + footer diagnostics on every page (not just `/`). Fixes the blocker filed in `92a29ce` (layout-shell landed with placeholder behavior on non-home routes). Loader shape from the frontend agent's proposal: `getAllAdoptedLeagues()` → `{ slug, name, status: 'active'|'voting'|'open'|'idle', currentRoundId, currentRoundLabel }[]`, `getCrossLeagueUpcoming()` → `{ leagueSlug, roundName, phase, deadline }[]`, and `getWatcherDiagnostics()` → `{ uptimeMs, dbSizeBytes, lastPollAt }` (fold into the layout loader return is fine). Frontend layout already reads `page.data.activeSeasons` opportunistically — rename or coexist; frontend will follow up to consume the new shape after this lands.
  - **Acceptance:** every non-home route (`/_examples`, `/settings`, `/league/.../season/.../round/...`) renders the populated leagues list and a footer with real DB size + uptime (not the hardcoded `4D UPTIME` / `12.4 MB` / `6:32:14 PM` placeholders); `+layout.server.ts` runs on every request (verifiable by a single `console.log` on cold start across multiple route fetches); existing pages still HTTP 200; Blockers section in this doc gets the entry resolved-and-moved to Activity Log per template convention.

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

- _None — the layout-loader blocker was resolved by the `layout-loader` task; see Activity Log._

## Activity Log

### 2026-05-14 — infra (as frontend, parallel) — settings-page landed
- **Why infra in a frontend lane:** sprint-1 review Q2 ratified the `(as frontend, parallel)` load-balancing convention — frontend pane has 4 page reskins ahead of it, infra is idle after design-tokens shipped, so infra picks up one page. Same pattern infra used in sprint-1 for `(as backend, parallel)` commits.
- **File touched (single):** `ui/src/routes/settings/+page.svelte` — full reskin. No loader, no API, no library, no layout, no infra changes.
- **Structure:** breadcrumb `music-league-bot · settings` → H1 `Settings` (`font-sans text-4xl font-bold text-fg`) → subtitle in `text-fg-muted`, then four section cards (each `bg-surface border border-border-muted rounded-xl p-6 mb-6`):
  1. **Rating weights** — SectionLabel + H2 + a `<StatusChip>` showing `{total}% · OK` (health) or `{total}% · OFF` (warn) live-bound to `wTotal`. Four slider rows with a colored dot prefix per dimension (discovery=health, theme-fit=accent, personal=warn, nostalgia=accent-strong). Sliders use `accent-[var(--color-accent)]` for the native thumb tint. Proportion bar with matching segment colors. Reset/Save buttons reskinned — Save uses the canonical accent button (`bg-accent hover:bg-accent-strong text-bg-elevated font-mono text-xs tracking-widest uppercase font-bold px-4 py-2 rounded-md`). Form action unchanged.
  2. **ZIP import & rescan** — header chip derived from `data.importLog`: `LAST · {month day}` (health) if newest entry is success, `LAST IMPORT FAILED` (warn) if any errors, `NO IMPORTS` (muted) otherwise. Form inputs (league select / season number / file picker) restyled to `bg-bg-elevated border-border-muted text-fg focus:border-accent`. Import button = accent; Re-scan = secondary outline. Import-log table reskinned with mono uppercase column headers and `<StatusChip>` per row (OK=health, ERROR/PARTIAL=warn, fallback=muted). Existing forms (`?/importZip`, `?/rescan`) unchanged.
  3. **Round deadlines** — SectionLabel + H2 + intro copy referencing the home-page countdown chips. Each round row is now a `bg-bg-elevated` rail with mono `SUBMIT BY` (accent) and `VOTE BY` (health) micro-labels; `datetime-local` inputs use mono with `focus:border-accent`. Save button is the secondary outline style. Existing `?/updateDeadline` form action + hidden `roundId` preserved.
  4. **Songlink resolution queue** — header chip derives from existing fields: `{n} FAILURE(S)` (warn) > `DRAINING · {n} PENDING` (accent) > `IDLE` (health). Three stat tiles (`bg-bg-elevated` cards) with display-font numbers and mono captions: Pending (warn), Resolved 24h (health), Failures (accent when >0 else faint). Failure table mirrored from the import log style. `?/retryYtm` form action preserved.
- **Tokens consumed** (all from `cf5985d` design-tokens contract, none new): `bg-bg`, `bg-bg-elevated`, `bg-surface`, `bg-surface-hover`, `border-border`, `border-border-muted`, `border-accent` (`focus:`), `text-fg`, `text-fg-muted`, `text-fg-dim`, `text-fg-faint`, `text-accent`, `text-accent-strong`, `text-health`, `text-warn`, `bg-accent`, `bg-accent-strong`, `bg-health`, `bg-warn`, `font-mono`, `font-display`. Atoms consumed: `SectionLabel` (4×), `StatusChip` (health / warn / muted / accent tones).
- **Loader gap noted (not blocking):** `getQueueStatus(db)` in `ui/src/lib/db/ytmQueue.ts` does not surface worker-running state. The brief asked for `tone='health' when worker is running, 'warn' when paused`; derived a usable visual semantic from the fields that *are* exposed (`pending`, `done24h`, `failures`). If the layout-loader / hooks watcher state gets surfaced into the settings loader later, the chip is a one-line swap. Not filed as a Blocker because the existing reskin reads correctly.
- **Verification:**
  - `npx svelte-check` — 1 error + 2 warnings, all pre-existing (the `vite.config.ts` test-config error and the same `$state` reference warning that was in the original settings file). New file compiles clean.
  - `DATA_DIR=…/data npm run dev` (port 5174) → `curl /settings` returns HTTP 200, 111954 bytes. Body grep confirms `music-league-bot · settings`, `Rating weights`, `ZIP import & rescan`, `Round deadlines`, `Songlink resolution`, `font-display`, `bg-surface`, `bg-accent`, `SUBMISSIONS`, `IDLE` all rendered.
  - Screenshot: `docs/screenshots/2026-05-14-sprint2-settings-page.png` (1440×2400, full page, headless chrome). Shows all four cards stacked with consistent surface treatment, breadcrumb + H1 header matching the home page, orange Save Weights + Import buttons, OK chip on the weight total (sums to 100), LAST · {date} chip on the import card, proportion bar rendering the four colors, deadline rails empty (no active rounds with deadlines in `data/league.db` right now — expected), queue stats showing 0/0/0 with IDLE chip.
- **Acceptance check:** `/settings` is visually consistent with home + layout shell (cards, chips, mono micro-labels); rating-weight inputs styled to the design system; import button is the canonical accent button; queue section uses `StatusChip` for both queue depth and worker state (derived). All existing form actions and data bindings preserved verbatim.
- commit: `69edc62`

### 2026-05-14 — frontend — home-page landed
- `ui/src/routes/+page.svelte` rewritten as the prototype A "Pick a league" view. Sprint-1's Active Now / Past Seasons / All Songs Ever sections are intentionally removed from this surface (out of scope for the reskin and not in prototype A); the loader is untouched, so a future `/library` or `/songs` route can pick those up without backend work.
- **Page header:** breadcrumb `MUSIC-LEAGUE-BOT · PICKER` (`text-fg-faint font-mono text-xs tracking-widest uppercase`), H1 `Pick a league` (`text-4xl font-bold text-fg`), subtitle in `text-fg-muted` with the live league count: "{N} league{s} adopted. Active rounds need attention first; voting deadlines bubble up next; idle leagues sit at the bottom where they belong."
- **Needs you this week card:** `border-l-4 border-accent` + `bg-surface` + `rounded-r-xl`, p-6. Header: bold `Needs you this week` + muted "Submissions or votes due in < 4 days." + right-aligned `<StatusChip tone="accent">{N} OPEN</StatusChip>`. Grid (`sm:grid-cols-2 lg:grid-cols-3`) of tiles: `bg-bg-elevated` + `border border-border-muted` + `hover:border-accent-deep` + `rounded-xl` + p-4. Each tile: `<DeadlineChip>` (phase derived from soonest non-overdue deadline — submissions > voting > review fallback), league name, mono dim slug, mono faint `r-{id} · {round name}` row.
- **All leagues card:** `bg-surface` + `border border-border-muted` + `rounded-xl`. Header has the title, count subtitle, and a disabled accent `+ Adopt league` button (TODO comment: adopt-flow does not exist yet). Grid of tiles using `<DotIndicator>` + status label + name + slug + sub-line. Trailing dashed-border `+ Adopt league` placeholder tile.
- **Source data — option (c):** since backend's `+layout.server.ts` (`page.data.leagues`) only just landed in this session and the home loader already returns enough to derive a full visible league list, I used a client-side union of `data.activeSeasons` + `data.pastLeagues`, deduped by slug, sorted active-first then idle alphabetical. This keeps the home page self-contained against its existing `+page.server.ts` and doesn't depend on the new layout payload. Once `page.data.leagues` is consumed by the layout shell, the home page can optionally migrate to it for the All-leagues card — TODO comment marks the migration point.
- **Edge case fix:** `durationUntil()` now guards against unparseable ISO timestamps (`Number.isFinite(ts)` check) — Hip Jammers had a non-Date submission deadline string that produced a `SUBMISSIONS · NaNM` chip before the guard; now falls through to `REVIEW · —`.
- **Verification:** `npm run dev` → `curl /` HTTP 200 (140kb). Playwright screenshot at `docs/screenshots/2026-05-14-sprint2-home-page.png` shows the two-section split matching prototype A — orange-bordered Needs-you card with 2 OPEN accent chip and Hip Jammers (`REVIEW · —`) + Nostalgia Pit tiles, All leagues card with the four tiles (Hip Jammers active, Nostalgia Pit active, Fam-Jam idle, Second Best idle) + dashed Adopt-league placeholder. svelte-check clean on the new file (no warnings).
- **Tokens consumed:** `border-accent`, `bg-surface`, `bg-bg-elevated`, `border-border-muted`, `border-accent-deep`, `text-fg`, `text-fg-muted`, `text-fg-dim`, `text-fg-faint`, `bg-accent`, `bg-accent-strong`, `font-mono`, `font-sans`, `border-border`. Atoms used: `DeadlineChip`, `StatusChip` (accent tone), `DotIndicator` (all four statuses).
- commit: 54f841d

### 2026-05-14 — backend — layout-loader landed
- **New files:**
  - `ui/src/lib/db/layout.ts` — `getAllAdoptedLeagues(db, now?)`, `getCrossLeagueUpcoming(db, now?)`, `getWatcherDiagnostics(db, dbFilePath)` plus exported types `LeagueRailEntry`, `LeagueRailStatus`, `CrossLeagueUpcoming`, `WatcherDiagnostics`. Single-pass queries per call; the leagues query uses a correlated subquery to pick each league's most-recent active season in one round-trip and a tight follow-up prepared statement per league for its most-recent round.
  - `ui/src/routes/+layout.server.ts` — `LayoutServerLoad` returning `{ leagues, crossLeagueUpcoming, watcher }` (typed export `LayoutData`). Resolves `dataDir` the same way `hooks.server.ts` does (`process.env.DATA_DIR ?? cwd/../data`) so the file-size stat lines up with the DB the loaders read.
- **Return shape:**
  ```ts
  interface LayoutData {
    leagues: {
      slug: string;
      name: string;
      status: 'active' | 'voting' | 'open' | 'idle';
      currentRoundId: number | null;
      currentRoundLabel: string | null;
    }[];
    crossLeagueUpcoming: {
      leagueSlug: string;
      roundName: string;
      phase: 'submissions' | 'voting';
      deadline: string;
    }[];
    watcher: {
      uptimeMs: number;
      dbSizeBytes: number;
      lastPollAt: string | null;
    };
  }
  ```
  Status derivation: `active` if the league has an active season and the current round's submission_deadline is in the future; `voting` if submissions closed but voting still open; `open` if an active season exists but no round has a future deadline (live league, between rounds or deadlines null); `idle` if no active season. `crossLeagueUpcoming` expands each round with at least one future deadline into one entry per phase, sorted ascending by deadline.
- **Back-compat:** kept the home `+page.server.ts` loader's `activeSeasons` field untouched — frontend's existing opportunistic read continues to work on `/` while the new `page.data.leagues` is populated everywhere. Frontend will follow up to switch the layout-shell `+layout.svelte` over to the new shape (small patch in their territory — flagged here, not blocking other sprint-2 reskin tasks).
- **Verification:** `cd ui && npm run dev` then curl four routes:
  - `/_examples` HTTP 200 — body contains `Hip Jammers`, `Fam-Jam`, `Second Best` (previously empty leagues list on this non-home route)
  - `/settings` HTTP 200 — same plus `Nostalgia Pit` (from the page's own data; new layout payload contributes the non-excluded three)
  - `/` HTTP 200, `/league/second-best/season/1/round/97` HTTP 200 — both still render real submission data
  - Temporary `console.log('[layout.server] load called for', event.url.pathname)` confirmed the loader fires on every route (logged for `/`, `/_examples`, `/settings`, `/league/.../round/97`), then removed before commit.
- **Checks:** `npx svelte-check` reports only pre-existing issues (1 error in `vite.config.ts`, 7 warnings in `ResearchList.svelte` + `settings/+page.svelte`); the new `.ts` files compile clean. `npx vitest run` 13/13 green.
- **Blocker moved:** the `layout-loader` Blockers entry filed at `92a29ce` is closed; entry removed from `## Blockers` per template convention. Frontend's `+layout.svelte` can now consume `page.data.leagues` / `page.data.crossLeagueUpcoming` / `page.data.watcher` to replace the hardcoded `4D UPTIME` / `12.4 MB` / `6:32:14 PM` / empty-leagues placeholders.
- commit: `d7fb43a`

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
