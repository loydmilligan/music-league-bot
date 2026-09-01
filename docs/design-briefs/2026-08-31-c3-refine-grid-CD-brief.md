# Feature Design Brief *(existing repo)*

> **For:** Claude Designer (CD) · **Written by:** Claude Code (CC) · **Product:** music-league-bot UI
> **Feature:** C3 — the Refine Grid ("the sudoku grid"), spec §7.4 · **Date:** 2026-08-31 · **Brief version:** 1
> **Repo (local checkout):** `/home/loydmilligan/Projects/music-league-bot` (UI in `ui/`)

---

## 0. How CD will use this brief *(fixed — do not edit)*

CD will: (1) read this brief and load/observe the design system as it's actually
implemented; (2) confirm and, if needed, top up the decision points to 4–6 total;
(3) build a pannable **canvas** of options with visual aids — both for the ideas you named
and for the open areas CD is invited to explore; (4) iterate in chat to settle each
decision; (5) produce the **full design** for the feature, fitted to the existing product;
(6) write a process summary and decision log; (7) assemble a **handoff packet** (see
`Handoff-Packet-Manifest.md`); (8) return a **kickoff prompt** for CC to implement.

---

## 1. Product & feature snapshot

- **Product:** A private single-operator web app around Music League — a song-submission
  game played in a WhatsApp group. It ingests league data, chat history and Spotify
  metadata, and produces research surfaces, editorial "digests", and voting tools. One
  user: Matt (the owner/commissioner). Not multi-tenant, not public.
- **The feature, in one sentence:** A per-round reasoning board where Matt works out **which
  player submitted which anonymous song**, by naming candidates per song, rating his
  certainty, recording why, and progressively eliminating players across the whole round.
- **Why now:** Projects **A** (data spine), **C1** (evidence horizon) and **C2** (workspace
  shell + gut phase) shipped today, all reviewed and merged. The workspace tab exists and
  renders the *gut* phase. §7.4 is the next phase in the same tab, and the spec explicitly
  reserves it for a design brief: *"The heart of the tool, and the piece that gets a Claude
  Design brief."*
- **Who reviews / decides:** Matt, solely.
- **Deadline / milestone, if any:** None hard. Build order after C3 is C2b → B → D → E → F.
  Live rounds run roughly weekly, so a usable grid before the next voting window is the
  practical target, not a commitment.

---

## 2. Repo orientation  *(CC filled from the local checkout)*

- **What the codebase is:** **SvelteKit 2 / Svelte 5 (runes)** + **Tailwind v4** + TypeScript,
  server-rendered, backed by a local **SQLite** file (`better-sqlite3`) at `data/league.db`.
  The UI app is the `ui/` directory; a separate Node bot process writes some of the same
  tables. Deployed as a Docker container behind Caddy at `mlbot2.mattmariani.com`.
- **How to run / view it:** ⚠️ **`npm run dev` is not usable for this surface** — the digest
  page hydration crashes under dev (a `node:crypto` import via `llm.ts`). Verify with a
  production build against a **copy** of the DB:
  ```
  cd ui && npm run build
  DATA_DIR=<scratch-copy-dir> PORT=5199 node build
  ```
  Route of interest: `/league/[league]/season/[n]/round/[roundId]` → the **Guess** tab.
  Real data to look at: Boarz round 148 (10 songs, 9 eligible players).
- **Key directories CD should know about:**
  - `ui/src/lib/guessing/` — **all the feature's logic**, pure TS, fully tested (91/91).
  - `ui/src/lib/components/GuessWorkspace.svelte` — the host component this feature extends.
  - `ui/src/routes/league/[league]/season/[n]/round/[roundId]/+page.svelte` — the tab strip.
  - `ui/src/routes/api/guess/[roundId]/` — the API routes (`+server.ts`, `gut/`, `rehearsal/`).
  - `ui/src/app.css` — the design tokens.

### 2a. Design system, as implemented

- **System in use:** **Mashco**, as implemented in `ui/src/app.css`. The token block is
  commented *"Design tokens — sourced from docs/prototype/ (A: Picker · Orc-Tower-style and
  B: Hero with pulp wordmark)"*; an archived copy of the system sits at
  `docs/Mash-Co-Design-System-archive.zip`. Treat the **code** as authoritative.
- ⚠️ **Correction to a prior research note.** `.superpowers/research/c3-grid-ui-patterns.md`
  §5 recommends the *other* styling system in this repo (`ui/src/lib/shortlist/colors_and_type.css`'s
  `--fg-quiet` / `--surface-2` / `.mash-btn` / `.ml-*` vocabulary, used by
  `lib/digest/*`, `RolloutTab.svelte`, `ModelsScreen.svelte`). That recommendation was made
  before the host component existed. **It is now wrong.** `GuessWorkspace.svelte` is
  written in **pure Tailwind-utility style against the `app.css` `@theme` tokens** —
  `bg-surface`, `text-fg-muted`, `border-border-muted`, `text-accent`, `text-warn`,
  `font-mono`. **CD must use that system.** The two vocabularies coexist in this repo and
  mixing them inside one component looks visibly wrong.
- **Where tokens live:** `ui/src/app.css`, in an `@theme { }` block. Tailwind v4 auto-generates
  the utilities from these (`--color-surface` → `bg-surface`, `--font-mono` → `font-mono`).
- **Component library location & inventory:** `ui/src/lib/components/`. Relevant to CD:
  | Component | What it is |
  |---|---|
  | `GuessWorkspace.svelte` | **The host.** Owns load/error/phase/rehearsal chrome. |
  | `VotingLabSongRow.svelte` | **The closest analogue** — dense per-song row, many independent controls. |
  | `VotingLab.svelte` | Its parent; owns the debounced-persistence pattern (§8). |
  | `CollapsiblePanel.svelte`, `SectionLabel.svelte`, `StatusChip.svelte`, `DotIndicator.svelte`, `BadgeStrip.svelte`, `DeadlineChip.svelte` | Small shared chrome. |
  | `ui/src/lib/shortlist/AssignPopover.svelte` | Filter-and-toggle popover over a **local** list — the nearest thing to a roster picker. |
  | `ui/src/lib/shortlist/SearchBar.svelte` | Debounced remote-search typeahead with real keyboard nav. |
- **Icon set / illustration system:** None. No icon library is installed. The app uses text
  labels, unicode glyphs (·, —, ✓), and CSS shapes. **Do not introduce an icon dependency**;
  if CD needs iconography, inline SVG or glyphs.
- **Fonts in use:** `Inter Tight` (sans/body), `Bricolage Grotesque` (display),
  `JetBrains Mono` (mono — used heavily for labels, values, and all UI chrome).

### 2b. Existing visual & interaction vocabulary

- **Color palette (actual values, `ui/src/app.css`):**
  | Token | Hex | Role |
  |---|---|---|
  | `--color-bg` | `#07090c` | page background |
  | `--color-bg-elevated` | `#0d1116` | secondary surface |
  | `--color-surface` | `#141921` | card / panel / row |
  | `--color-surface-hover` | `#1d2128` | row hover |
  | `--color-surface-strong` | `#283039` | pressed / strong panel |
  | `--color-border` | `#3a4451` | hairlines |
  | `--color-border-muted` | `#283039` | dimmer hairlines |
  | `--color-fg` | `#f1f4f7` | primary text |
  | `--color-fg-muted` | `#c2cad3` | secondary text |
  | `--color-fg-dim` | `#8b97a4` | caption / hint |
  | `--color-fg-faint` | `#5a6773` | very dim |
  | `--color-accent` | `#ff5b2e` | **primary accent (orange)** |
  | `--color-accent-strong` | `#d94c23` | hover / pressed |
  | `--color-accent-deep` | `#8a2d15` | deep / borders |
  | `--color-accent-bg` | `#221a14` | tinted accent surface |
  | `--color-health` / `-bg` | `#3ec27a` / `#1d3a2a` | positive / good |
  | `--color-warn` | `#e8a83a` | warning (used for destructive-confirm) |
  | `--color-sky` / `-ember` / `-moss` / `-amber` | `#5aa3ff` / `#e6566c` / `#3ec27a` / `#e8a83a` | semantic axis colors |
  **Dark-only.** There is no light theme on this surface.
- **Type scale & families:** Tailwind defaults (`text-xs` → `text-2xl`). The house style is
  **mono for all chrome** — labels, buttons, values, status lines — in
  `font-mono text-xs tracking-widest uppercase`. Body/content text is sans. Song titles are
  `font-bold text-fg`; artists are `text-fg-muted`; submitter comments are
  `text-fg-faint text-sm italic`.
- **Spacing / layout grid / density:** Dense and flat. Rows are
  `pl-3 pr-4 py-2.5` with `gap-2` between them; sections separate with `mb-4`/`mb-6`.
  Radius is small — `rounded-sm` for buttons, `rounded-lg` for inputs. **No shadows
  anywhere.** Depth is expressed by surface color and hairlines, not elevation.
- **Signature components & how they behave:**
  - **Rows, not tables.** The gut slate is an `<ol>` of `<li>`s with a **2px left accent
    border** (`border-l-2 border-border-muted`) on `bg-surface`. This left-border-rail is
    the app's signature list treatment — reuse it.
  - **Buttons:** `bg-accent hover:bg-accent-strong text-bg-elevated font-mono text-xs
    tracking-widest uppercase px-3 py-1.5 rounded-sm transition-colors`, always with
    `disabled:opacity-60 disabled:cursor-not-allowed`.
  - **Destructive actions use inline confirm, never a modal dialog.** The archive-rehearsal
    control swaps itself for a warning sentence + "Confirm archive" / "Cancel" pair in place.
  - **Tab strip:** bottom-border tabs; active = `border-accent text-accent font-bold`,
    inactive = `border-transparent text-fg-muted hover:text-fg`; disabled =
    `opacity-50 cursor-not-allowed`.
  - **Sliders:** always native `<input type="range">`, colored with `accent-accent` /
    `accent-[var(--color-accent)]`, with a live numeric readout in `font-mono` beside or
    above it. **There is no custom slider component in this repo and CD should not design
    one** (`ui/src/routes/settings/+page.svelte:977`, `ui/src/lib/debug/ValueScoreDock.svelte:104`).
- **Interaction patterns:**
  - **Optimistic local edit + debounced server write.** `VotingLab.svelte:90-113` updates
    local state on every keystroke, then sets a **per-item 400ms** `setTimeout` in a
    `Map<key, PendingSave>` before firing a `PATCH`. A `flushPendingSaves()` clears and
    awaits all timers before any read-after-write action, and on unmount/round-change.
  - Errors surface as a **single inline string** near the control, in
    `font-mono text-sm text-red-400` — no toasts, no notification system exists.
  - After a write the component **reloads from the server** and re-derives its DOM
    (`GuessWorkspace.svelte:70-74`). This is deliberate — see §10 risks.
- **Tone of UI copy:** lowercase, terse, mono, faintly technical; em-dashes; states the fact
  rather than instructing. Real strings from `GuessWorkspace.svelte`:
  - `"phase: gut"` · `"rehearsal · as of 2026-08-24"`
  - `"validation: clean — every song has a unique pick"`
  - `"3 songs missing a pick · duplicate: Conor, Jon"`
  - `"This deletes every guess for this round — not undoable. Confirm?"`
  - `"No guesser set for this league yet — set which competitor is you before using the workspace."`
  - `"— pick a player —"` (select placeholder)
  **Match this register.** No exclamation marks, no encouragement, no "Oops!".
- **Established states:** Loading = `<p class="font-mono text-sm text-fg-muted">Loading…</p>`.
  Error = inline red mono line. Empty/unconfigured = an explanatory mono sentence in
  `text-fg-muted` naming the missing prerequisite. There are **no skeletons and no spinners**
  in this app.

### 2c. Current information architecture

- **Top-level navigation / IA:** Home (cross-league dashboard) → league → season → **round
  page**. The round page carries a tab strip:
  `ml · chat · history · research · h2h · guess`
  (`.../round/[roundId]/+page.svelte:143,326`).
- **Where the user is when this feature becomes relevant:** On the round page, **Guess** tab,
  during the voting window of a live round — or replaying a past round in *rehearsal* mode.
  The tab is disabled until the round's playlist has been ingested
  (`guessTabDisabled = data.mlSubmissions.length === 0`, spec §4).

---

## 3. The feature — what & why

- **What it does:** For one round, shows every anonymous song and lets Matt build a case for
  who submitted each. Per song he names one or more **candidate players**; each named player
  becomes a **row** under that song carrying **factors**, a **certainty slider**, freeform
  **notes**, and a **state control** that cycles `Possible → Prime Suspect → Locked`.
  Marking someone **Prime Suspect** dims that player everywhere else in the round; marking
  them **Locked** removes them from every other song outright and opens comment work for that
  song.
- **Core user value:** The elimination *across* songs is the whole point. Any single song is
  usually ambiguous — but a player who is plausible on 2–3 songs becomes decidable once
  neighbours are locked. This is a constraint-satisfaction workspace, not a form.
- **The one outcome it must deliver:** Matt can see the whole round's state of play at a
  glance and feel the consequence of a decision propagate — locking one player visibly
  changes what's possible everywhere else, *immediately*.
- **Scope — in / out / later:**

| In scope | Explicitly out | Later |
|---|---|---|
| The refine board: per-song candidate rows | The *gut* phase UI (shipped, C2) | §7.5 comment drafting (opens on Locked) |
| Roster candidate picker (add/remove a candidate) | Rehearsal chrome (shipped, C2) | §7.6 vote phase (C2b transplant) |
| Certainty slider (0–100) | AI likelihood %/reasoning (Project **D**) | §7.7 output / submission |
| Factors + notes fields | Scraped submitter comments (Project **B**) | §9 scorecard (Project **E**) |
| The state-cycle control | Any change to the tab strip or round page | |
| Cross-song dimming / taken treatment | Auth, multi-user, mobile-first | |
| Conflict + validation display for refine | A light theme | |
| Empty / loading / error / locked states | | |

---

## 4. Where it lives — touchpoints & entry points

- **Existing screens/flows this feature touches or modifies:**
  - `ui/src/lib/components/GuessWorkspace.svelte` — **the only component that changes.**
    Today it renders phase chrome, rehearsal controls, a validation line, a "Lock gut slate"
    button, and the gut slate `<ol>`. C3 adds the **refine** phase rendering to the same
    component (or to a child component it mounts).
  - `ui/src/routes/api/guess/[roundId]/` — new route(s) for candidate writes. Not a design
    concern beyond latency expectations.
- **New entry points:** None. The user arrives via the existing **Guess** tab. The transition
  gut → refine is driven by state (`gutLockedAt` being stamped), not by navigation.
- **How it fits the current IA:** Same tab, next phase. `data.phase` already carries the
  phase; the component branches on it.
- **What it must not disrupt:** The gut phase and rehearsal controls must keep working
  exactly as they do. The round page's other five tabs are untouched. The home page's
  `VotingLab` embeds are untouched.

---

## 5. Users & jobs for this feature

- **Who uses this feature:** Matt. One person. No sharing, no permissions, no onboarding
  path. **Design for a power user who will use this every week and wants density over
  hand-holding.**
- **Jobs-to-be-done**, priority order:
  1. *"Show me the whole board so I can reason across songs."* — see every song and its
     candidates at once, and see which players are still available.
  2. *"Let me commit a decision and feel it propagate."* — lock a player; watch them vanish
     as an option elsewhere.
  3. *"Let me record why, while I'm thinking it."* — factors, notes, certainty, without
     losing my place or my scroll position.
  4. *"Tell me when I've contradicted myself."* — surface conflicts (a player locked twice;
     a song with no candidate) without blocking mid-thought editing.
  5. *"Survive a closed laptop."* — state is in SQLite, queried not cached; the board must
     come back exactly as left.
- **Frequency & context:** Roughly weekly, during a round's voting window — a focused
  sitting of maybe 20–45 minutes at a desktop, with the Music League voting page and the
  WhatsApp chat open alongside. Also used out-of-band in *rehearsal* mode to replay a past
  round.
- **What they do today instead:** Holds it in his head, plus the shipped **gut** phase — one
  `<select>` per song, one pass, then locked. The gut slate is a first instinct, deliberately
  captured before any analysis. The refine grid is where the actual reasoning happens, and
  it currently does not exist anywhere.

---

## 6. Ideas to flesh out  *(named by the team)*

### Idea A — The state-cycle control (`Possible → Prime Suspect → Locked`)

- **The idea:** A single control on each candidate row that advances through three named
  states. Per Matt's decision: **it wraps** — a fourth click returns to `Possible`.
- **Why the team is interested:** This is the primary verb of the whole tool. It has to be
  fast (used dozens of times a sitting), unambiguous at a glance across ~30 rows, and it
  carries consequence — `Locked` is load-bearing: it removes the player grid-wide and opens
  comment work for that song.
- **Known constraints / how it should behave:**
  - Data contract is shipped and fixed: `CandidateStatus = 'possible' | 'prime' | 'locked'`
    (`ui/src/lib/guessing/candidates.ts:4`).
  - Cycle order `possible → prime → locked → possible`, wrapping. **(Matt's call, 2026-08-31.)**
  - It fires **immediately** on click — not debounced — because it's a discrete decision, not
    typed text, and because it has grid-wide consequences that must not lag.
  - The nearest existing precedent is `flipSeasonStatus`
    (`ui/src/routes/settings/setup/+page.svelte:68-76,769-776`): a **2-state** flip whose
    button label names the **next** action, is `disabled` while its request is in flight, and
    round-trips through the server before the label updates. **Nothing in this codebase
    cycles 3+ states.** This is new construction.
  - Three states must be distinguishable **without relying on color alone** across a dense
    board — see §10 accessibility.
- **Open questions about it:** Does the wrap need a guard, given `Locked` is consequential and
  a stray click demotes it? (Matt chose wrapping knowingly; CD may still propose a
  friction treatment — e.g. the wrap step reading differently from the advance steps.)
  Should the control show its *current* state, its *next* action, or both?

### Idea B — Cross-song dimming (the sudoku effect)

- **The idea:** A candidate row's state changes the appearance of **that same player on every
  other song**. `prime` somewhere → the player reads *dimmed* (advisory) elsewhere.
  `locked` somewhere → the player reads *taken* (hard) elsewhere.
- **Why the team is interested:** This is the mechanic that makes the board a board rather
  than 10 independent forms. The spec: *"with 2–3 plausible songs per player, elimination
  across the grid resolves assignments that no single song resolves alone."*
- **Known constraints / how it should behave:**
  - ⭐ **The data layer is already built, tested, and has ZERO UI consumers.**
    `playerAvailability(db, roundId, mePlayerId): Map<number, 'free' | 'dimmed' | 'taken'>`
    (`ui/src/lib/guessing/candidates.ts:83-101`). Locked outranks prime: a player who is
    prime on one song and locked on another reads `taken`. CD is designing the *visual* side
    of a function that already returns exactly the right answer.
  - It is **derived at read time**, not cached client-side. So the natural implementation is:
    a status change writes, then the board re-reads availability and re-renders.
  - Nothing in this codebase does cross-row reactive dimming today. The only stylistic
    precedent for "dimmed" is `disabled:opacity-30` on `VotingLabSongRow`'s stepper buttons,
    and `disabled:opacity-60 disabled:cursor-not-allowed` throughout `GuessWorkspace`.
- **Open questions about it:** Does `dimmed`/`taken` apply to a player who is *already an
  added candidate row* on another song, to the *roster picker* when adding a new candidate,
  or both? (CC's read: both, and they may want different treatments — an existing row can't
  simply be hidden.) Does `taken` make the other row non-interactive, or just visually
  demoted-but-editable? Should there be an at-a-glance **roster ledger** showing all players'
  availability in one place?

### Idea C — The candidate picker (roster → rows)

- **The idea:** Spec §7.4 says *"Per song, **not a select**. A typeahead pill input over the
  roster; each named player becomes a **row**."*
- **Why the team is interested:** The gut phase's single `<select>` per song is the thing
  being replaced. Refine is multi-candidate — a song can carry several suspects at once.
- **Known constraints / how it should behave:**
  - The roster is **small (9–13 players), local, and already loaded** in the workspace
    payload (`WorkspaceData.roster: { id, name }[]`). **No remote search is needed** —
    `SearchBar.svelte`'s debounce/fetch plumbing is not warranted here.
  - `AssignPopover.svelte` is the closer template: a plain `<input>` + client-side `.filter()`
    + toggle-rows-in-a-`Set` with a checkmark, plus quick-filter pill buttons
    (`AssignPopover.svelte:43-52,81-96`). It has **no keyboard navigation at all**;
    `SearchBar.svelte:33-39` has the arrow/Enter/Escape plumbing worth borrowing.
  - **No chip/tag input exists anywhere in this repo.** If CD designs one, it is built from
    nothing.
- **Open questions about it:** With a 9–13 name roster, is a typeahead actually the right
  affordance versus a compact always-visible roster strip Matt clicks to add a candidate?
  The spec's "typeahead pill input" was written before the roster's small size was
  confirmed. **CD should feel free to challenge it** — see D2.

### Idea D — Dense per-row editing (factors · certainty · notes)

- **The idea:** Each candidate row carries three editable fields plus the state control,
  without the board becoming unreadable.
- **Why the team is interested:** ~30 candidate rows across a round; if each row is a tall
  form, the board stops being a board.
- **Known constraints / how it should behave:**
  - Field contract is shipped: `certainty: number | null` (0–100, schema `CHECK`),
    `factors: string`, `notes: string` (`candidates.ts:8-14`). `factors` and `notes` are both
    free text today — the spec calls factors "factors for that person"; nothing constrains
    them to a fixed vocabulary.
  - `VotingLabSongRow.svelte` is the proven analogue: a fully-controlled row owning no
    persistent state, firing a single `onchange(next)` callback prop; text areas fire on
    every `oninput`, not on blur.
  - Persistence must follow §2b: optimistic local update + **per-item 400ms debounced**
    server write, with a flush before any read-after-write.
- **Open questions about it:** Are all three fields always visible, or is the row
  progressively disclosed (collapsed by default, expanding on focus/selection)? Does
  certainty deserve a compact non-slider representation at rest so 30 rows stay scannable?

---

## 7. Open areas for CD to explore  *(CC-identified)*

### Open area 1 — Conflict and completeness feedback for the refine phase *(proposed by CC)*

- **What it is & why it's worth a look:** The gut phase has exactly one validation line
  (`"validation: clean — every song has a unique pick"` / `"3 songs missing a pick · duplicate:
  Conor, Jon"`, `GuessWorkspace.svelte:181-195`). The refine phase has a **richer and
  genuinely different** notion of "not done yet": a song with no candidates at all; a song
  with candidates but nothing locked; a player locked on two songs; a player nobody has
  considered anywhere; more songs remaining than available players (an unsatisfiable
  end-state, which is real — Boarz R148 is 10 songs / 9 players before Matt marks his own).
  Per spec §6, **duplicates are permitted while editing and shown as a conflict; the gate is
  evaluated at submit.** So this is *informative*, not blocking — which is a design problem,
  not a validation rule.
- **How it relates to the named feature:** It's the board's status readout. Get it right and
  the elimination reasoning becomes visible; get it wrong and it's noise on top of a dense
  grid. Worth its own options on the canvas.

### Open area 2 — The handoff from Locked into comment work *(proposed by CC)*

- **What it is & why it's worth a look:** Spec §7.4's last clause — *"Locked ... opens comment
  work for that song"* — is the seam between C3 and §7.5, which is **not built**. CD does not
  need to design §7.5, but the board should have a designed **affordance** for that transition
  (a settled song reading differently from an open one, and an obvious way in), so C3 doesn't
  ship a dead end that gets retrofitted badly later.
- **How it relates to the named feature:** It's the reward for the primary verb. A locked
  song should visibly *settle*, and that settling is part of the satisfaction of the board.

---

## 8. Existing patterns to honor / reuse

- **Components to reuse as-is:**
  - Native `<input type="range">` for certainty, `accent-accent`, live `font-mono` numeric
    readout. **Do not design a custom slider.**
  - `SectionLabel.svelte`, `CollapsiblePanel.svelte`, `StatusChip.svelte`,
    `DotIndicator.svelte` where they fit.
  - The button recipe and the inline-confirm-instead-of-modal pattern from
    `GuessWorkspace.svelte:140-174`.
  - The left-accent-border row rail (`bg-surface border-l-2 border-border-muted`,
    `GuessWorkspace.svelte:207`).
- **Patterns to follow:**
  - **Persistence:** optimistic local + per-item 400ms debounced `PATCH` + flush-before-read
    (`VotingLab.svelte:75-113`). The **state control is the exception — fire it immediately.**
  - **Errors:** one inline mono red line near the control. No toasts.
  - **Copy register:** lowercase, terse, factual (§2b).
  - **Controlled child rows:** the row component owns no persistent state; edits go up through
    one callback prop (`VotingLabSongRow.svelte:5-18`).
- **Things CD may extend, with care:** `GuessWorkspace.svelte` itself — it's the host, and
  splitting the refine board into child components is expected and welcome. The `app.css`
  token set may gain a token if a genuinely new semantic is needed (e.g. a distinct
  "prime suspect" hue) — but propose it explicitly rather than hard-coding a hex.
- **Things CD should NOT touch / change:**
  - The tab strip, the round page, or any of the other five tabs.
  - The gut-phase UI and the rehearsal controls (shipped and reviewed today).
  - The `guess_candidates` data contract or `playerAvailability`'s semantics — design **to**
    them.
  - The dark-only palette. **No light theme.**
  - Do not introduce an icon library, an animation library, a component framework, or a
    toast/notification system. None exist here.

---

## 9. Decision points to game out  ⭐

---

### D1. How the three states read at a glance across a dense board · **[Required — from team]**

- **The decision / question:** What is the visual system for `Possible` / `Prime Suspect` /
  `Locked` on a candidate row, and what does the control that advances them look like?
- **Why it matters:** It's the primary verb, used dozens of times a sitting, and it must be
  parseable across ~30 rows without reading labels. It also has to *feel* like `Locked` is
  consequential — because it is (removes the player grid-wide, opens comment work).
- **Options on the table:** a next-action-labeled cycling button (the `flipSeasonStatus`
  shape, generalized to 3); a segmented 3-position control showing all states with the
  current one active; a compact status chip that is itself the click target; a row-level
  treatment (border weight / rail color / background) carrying the state with a small
  control as the mechanism.
- **Constraints from the existing system:** Must cycle and **wrap** (`possible → prime →
  locked → possible`, Matt's call). Must fire immediately, be `disabled` in flight, and
  reflect the server's answer. Must not rely on color alone (§10). Uses `app.css` tokens.
- **What CD should put on the canvas:** 3–4 options, each shown **in context** on a real
  board of ~4 songs × 2–3 candidate rows with a realistic mix of all three states — not as
  isolated control specimens. The comparison that matters is scannability at board density.
- **How we'll decide:** Matt picks on scannability at density first, then on how much the
  `Locked` step feels like a commitment.

---

### D2. The candidate picker: typeahead pill input, or something better for a 9–13 name roster? · **[Required — from team]**

- **The decision / question:** Spec §7.4 says "a typeahead pill input over the roster." Is that
  right, given the roster is 9–13 names, local, and already loaded — and given no chip/tag
  input exists in this codebase to copy?
- **Why it matters:** Adding candidates is the second-most-frequent action. A typeahead costs
  a keystroke and a mental context switch per add; an always-visible roster strip costs
  vertical space on every song. It also determines where cross-song availability (D3) gets
  shown at the moment of choosing.
- **Options on the table:** (a) the spec's typeahead pill input, built from nothing;
  (b) an `AssignPopover`-style filter-and-toggle popover over the local roster
  (`AssignPopover.svelte:43-52`); (c) an always-visible compact roster strip per song where
  each name is a click-to-add target, doubling as the availability display; (d) a hybrid —
  strip for the common case, filter box appearing above ~12 names.
- **Constraints from the existing system:** Roster ships in `WorkspaceData.roster` — local,
  no fetch. Keyboard nav plumbing exists to borrow (`SearchBar.svelte:33-39`). A candidate row
  must also be **removable** (`removeCandidate` is shipped, `candidates.ts:52`).
- **What CD should put on the canvas:** 3 options at real roster size (use 9 names), each
  showing the add interaction and the resulting rows, plus the availability treatment from D3
  applied at the point of choosing.
- **How we'll decide:** Speed of adding a second/third candidate to a song, and whether the
  option makes availability visible *while choosing* rather than only after.

---

### D3. What "dimmed" and "taken" actually look like — and where they appear · **[Required — from team]**

- **The decision / question:** How does a player's grid-wide availability render? And does it
  apply to existing candidate rows, to the picker, or both?
- **Why it matters:** This is the sudoku mechanic. It's also the highest-risk piece: `dimmed`
  is *advisory* (prime elsewhere — Matt might still be wrong) while `taken` is a *hard*
  consequence (locked elsewhere). If the two read the same, the board lies about how settled
  a decision is. If dimming is too subtle, the mechanic is invisible; too strong, and the
  board looks broken.
- **Options on the table:** opacity ladder (`free` 100% / `dimmed` ~60% / `taken` ~30%, per
  the `disabled:opacity-30` precedent); a marker/badge naming *where* the player is committed
  ("locked on #4") rather than only dimming; strikethrough or rail-color change for `taken`;
  interactive-vs-inert (does `taken` disable the row, or just demote it?); plus **whether a
  standing roster ledger** — all players and their availability in one place — earns its
  space on the board.
- **Constraints from the existing system:** Semantics are fixed by
  `playerAvailability` (`candidates.ts:83-101`): locked outranks prime. Availability is
  **derived server-side and re-read after each status change** — so the visual change is a
  re-render, and CD should say what that transition looks like (instant? a brief highlight?).
  Must not rely on opacity alone for the advisory/hard distinction.
- **What CD should put on the canvas:** 3–4 options on a **full realistic board** (9 songs ×
  9 players, Boarz R148 shape) mid-session — some free, some dimmed, some taken — plus a
  before/after pair showing the moment a lock lands and propagates.
- **How we'll decide:** Can you tell advisory from hard at a glance, and does locking one
  player make the consequence obvious across the board?

---

### D4. Board density: how much of a candidate row is visible at rest? · **[Proposed by CC]**

- **The decision / question:** Factors, certainty, and notes are three editable fields per
  candidate row, and there may be ~30 rows. Are they always visible, progressively disclosed,
  or summarized-at-rest / expanded-on-focus?
- **Why it matters:** Matt's hard requirement is that **every song and its candidate rows are
  reachable without navigation** (§10). That is in direct tension with three text fields and a
  slider per row. This tension is the central layout problem of the feature, and how it's
  resolved determines whether the board is usable at all.
- **Options on the table:** all fields always visible in a wide dense row (needs a real
  column layout); collapsed rows showing only name + state + certainty value, expanding the
  editor on click/focus; a two-pane board (board left, editor for the selected candidate
  right); notes/factors behind a subtle affordance with a filled/empty indicator.
- **Constraints from the existing system:** No modals for editing (the app's only modal-ish
  pattern is an inline confirm). No accordion component exists — `CollapsiblePanel.svelte`
  exists but is panel-scale, not row-scale. Desktop-first; mobile is not a requirement here.
- **What CD should put on the canvas:** 3 options at **true full-round scale** — 9 songs with
  a realistic candidate distribution (some songs 1 candidate, some 3), so the vertical cost is
  honest rather than demoed on a flattering subset.
- **How we'll decide:** Whether the whole round is genuinely comprehensible on screen while
  still being editable in place.

---

### D5. How conflicts and incompleteness are surfaced without blocking editing · **[Proposed by CC]**

- **The decision / question:** Where and how does the board report its own problems —
  duplicate locks, songs with no candidates, unsatisfiable player supply — given §6 says
  duplicates are **permitted while editing** and gated only at submit?
- **Why it matters:** The board is a reasoning space where being temporarily wrong is part of
  the process. Feedback that blocks or nags defeats it; feedback that's absent lets a
  contradiction sit unnoticed for twenty minutes.
- **Options on the table:** extend the existing single mono status line (§2b's
  `"validation: clean — …"` register); a persistent board-level summary panel; per-row
  inline conflict markers on both sides of a duplicate; a combination — quiet inline markers
  plus one roll-up line.
- **Constraints from the existing system:** Copy register is set (§2b). No toasts. The gut
  phase's one-line treatment is the incumbent and the thing to beat.
- **What CD should put on the canvas:** 2–3 options on a board that is deliberately in a
  **messy mid-session state** (one duplicate lock, two songs with no candidates).
- **How we'll decide:** Does it inform without interrupting, and does it read as the same app?

---

### D6. *(open stub — CD to propose)*

> CC has no sixth. If CD spots a higher-value choice than one above — particularly around the
> §7 open areas (the Locked → comment-work handoff, or the availability ledger) — claim this
> slot.

---

## 10. Constraints

- **Technical:**
  - Svelte 5 runes (`$state`, `$derived`, `$props`, `$effect`) + Tailwind v4 utilities against
    `app.css` `@theme` tokens. No CSS-in-JS, no styled-components.
  - ⚠️ **No Svelte component or route test harness exists in this repo.** Established
    convention: **logic lives in `.ts` (tested), `.svelte` stays thin** (verified by
    `svelte-check` + manual browser). CD should not design something whose correctness
    depends on untestable component-internal state machines. **Do not propose inventing a
    test harness.**
  - Data contracts are **shipped and fixed**: `CandidateStatus`, `Candidate`,
    `CandidatePatch`, `Availability`, `setCandidate`, `removeCandidate`, `candidatesForSong`,
    `playerAvailability` — all in `ui/src/lib/guessing/candidates.ts`, all tested. Design to
    them; a design needing a different data shape must say so loudly.
  - Volume is small: 9–13 players × 9–12 songs. **No virtualization needed.** Everything can
    be rendered.
  - Local SQLite, single user — writes are sub-millisecond. Latency is not a design concern;
    round-trip *correctness* is (see risks).
  - No icon library, no animation library, no toast system, no state-management library.
- **Brand & consistency:** It must be indistinguishable from the gut phase directly above it
  in the same tab. Dark-only, mono chrome, flat surfaces, orange accent, no shadows.
- **Accessibility bar:** Single known user, no formal WCAG commitment — but two things are
  **functional** requirements, not compliance ones: (1) the three states must be
  distinguishable without color alone (shape/weight/label/position), because they'll be
  scanned at speed across a dense board; (2) `dimmed` vs `taken` must be distinguishable by
  something other than opacity magnitude, because they mean *advisory* vs *hard*. Keyboard
  operation of the picker is desirable (the plumbing exists to borrow) but not mandatory.
- **Risks / past problems with this area:**
  - ⚠️ **Controlled-input desync is a real, already-experienced bug here.** In Svelte 5 a
    `<select>` (or any controlled input) goes stale after user edit: `value={expr}` only
    re-renders when *that expression* changes, so any path **not** ending in a changed value —
    a rejected write, a 409, a blank selection — leaves the DOM showing what the user did
    rather than what the server holds. This cost two fix commits today (`13f99a6`, `12680fb`)
    and is documented at length in `GuessWorkspace.svelte:31-39`. **Every C3 control needs a
    designed answer for "the write failed / was rejected — what does the user see?"** Design
    the rejected state, don't assume the happy path.
  - The gut phase is **hard-locked**: once `gut_locked_at` is stamped, gut picks are immutable
    (spec §7.1). The refine board must make clear it is a *different, still-editable* layer,
    not an unlock of the gut slate. Showing the gut pick alongside candidates is likely
    valuable — but it must not look editable.
  - **Rehearsal mode** replays a past round with an evidence horizon (`asOf`). The board may
    be viewed in rehearsal, and the existing chrome already says so
    (`"rehearsal · as of …"`). Whatever CD designs must sit under that banner without
    conflicting with it.
  - The board is **derived from the DB on every read** — nothing is cached client-side, by
    design ("the grid survives a refresh or a closed laptop mid-round"). Designs depending on
    client-only ephemeral state should be flagged.

---

## 11. Success criteria

- **How we'll judge the design is good:**
  1. The whole round is comprehensible **without navigating** — Matt's hard requirement.
  2. Locking a player produces an obvious, immediate, board-wide consequence. If the sudoku
     effect isn't *felt*, the design has failed its main job.
  3. `dimmed` (advisory) and `taken` (hard) are never confused for each other.
  4. Adding a candidate and cycling its state are fast enough to do dozens of times without
     friction.
  5. It looks like it was always part of the app — same tab, no seam against the gut phase.
- **Metrics it should move:** No analytics exist in this app. The real measure is whether the
  refined slate beats the gut slate on the §9 scorecard once Project E lands — i.e. whether
  the board actually improves Matt's guesses over his first instinct.
- **What "fits the product" means, concretely:** Tokens from `ui/src/app.css`; mono uppercase
  chrome; `bg-surface` rows with a `border-l-2` rail; `rounded-sm` buttons; no shadows; inline
  mono error lines; lowercase terse copy; native range inputs; no new dependencies.

---

## 12. Deliverables & logistics

- **Fidelity expected:** High. **Comprehensive build** (Matt's explicit call): the complete
  §7.4 surface — all three candidate states, all three availability states, empty board,
  loading, error, rejected-write, conflict/duplicate, unsatisfiable-slate, fully-locked/settled,
  and the rehearsal-banner variant. Include the transitions, especially the lock-propagation
  moment.
- **Variations wanted, and on what:** Per the decision points — D1 (state control), D2
  (picker), D3 (availability treatment), D4 (row density), D5 (conflict surfacing). All
  in-context on a realistic board, never as isolated specimens.
- **Deliverable format:** Handoff packet per `Handoff-Packet-Manifest.md` (zip) + kickoff
  prompt for CC. Additions: an explicit **token map** naming which `app.css` token each
  element uses, and a flag on any token CD proposes adding.
- **Review cadence:** Matt reviews the option canvas in one pass, settles the decisions in
  chat, then reviews the full design once. He is the only reviewer and is fast — optimize for
  a decisive canvas over many small check-ins.

---

## 13. Open questions & unknowns

- **(unknown — needs decision)** Is `factors` a free-text field or should it become a
  structured/chip vocabulary? Schema says free text (`factors: string`), and the spec doesn't
  constrain it. A structured vocabulary would materially change the row design and would need
  a data-layer change — flag it rather than assuming it.
- **(unknown — needs decision)** Should the **gut pick** be visible on the refine board? It's
  in `WorkspaceData.songs[].gutPickPlayerId` and it's the thing the refined answer will be
  scored against. CC's instinct is yes, as a non-editable marker — but showing it risks
  anchoring the refined reasoning to the first instinct, which is the exact contamination
  §7.1's hard gate was designed to prevent.
- **(unknown — needs decision)** Does a song need a "no idea / skip" state distinct from
  "no candidates yet"? §6 requires every song to have exactly one guess at submit, but the
  refine phase is mid-process.
- **(assumption)** Every song's candidate list is independent; there is no per-song ordering
  or ranking of candidates beyond `certainty`. `candidatesForSong` returns `ORDER BY player_id`
  — arbitrary. CD may propose a display ordering (by certainty? by status?); it's a UI choice,
  not a data one.
- **(assumption)** The refine board replaces the gut slate `<ol>` in the tab when
  `phase === 'refine'`, rather than appearing below it. Not stated in the spec.
- **(assumption)** Desktop-only. The app has mobile-friendly surfaces elsewhere (the digest),
  but this is a desk tool and no mobile requirement was stated.
- **(known gap, not blocking)** Submitter comments (`WorkspaceSong.comment`) are the richest
  evidence and are rendered today in the gut slate as `text-fg-faint text-sm italic`, but
  Project **B** (the scrape that actually populates them for live rounds) is **not built**.
  They will often be `null` at C3 time. Design for both.
- **(known gap, not blocking)** AI likelihood percentages and reasoning (Project **D**, §7.3)
  are **out of scope for C3** but will land in this same board later — roughly one
  percentage + reasoning per player per song. CD does not design it, but should not paint the
  layout into a corner that has no room for it.

---

## Appendix — file map & references

- **Design tokens:** `ui/src/app.css` (`@theme` block, lines ~15-65). ⚠️ Note the competing
  system at `ui/src/lib/shortlist/colors_and_type.css` — **do not use it here** (§2a).
- **Component library:** `ui/src/lib/components/` — especially `GuessWorkspace.svelte` (the
  host), `VotingLabSongRow.svelte` + `VotingLab.svelte` (dense-row + persistence analogue),
  `SectionLabel.svelte`, `StatusChip.svelte`, `CollapsiblePanel.svelte`.
  Also `ui/src/lib/shortlist/AssignPopover.svelte` and `ui/src/lib/shortlist/SearchBar.svelte`.
- **Feature logic (shipped, tested — design to these):** `ui/src/lib/guessing/candidates.ts`
  (candidate CRUD + `playerAvailability`), `workspaceData.ts` (the payload the UI renders),
  `assignment.ts` (`eligiblePlayers`, `eligibleSongs`, `validateGutSlate`), `state.ts`
  (phase/mode/`gutLockedAt`), `horizon.ts` (rehearsal evidence horizon).
- **Screens the feature touches:**
  `ui/src/routes/league/[league]/season/[n]/round/[roundId]/+page.svelte` (tab strip at :326,
  Guess tab mount at :804), `ui/src/lib/components/GuessWorkspace.svelte`.
- **Slider convention:** `ui/src/routes/settings/+page.svelte:977-989`,
  `ui/src/lib/debug/ValueScoreDock.svelte:104-114`.
- **2-state flip precedent for the state control:**
  `ui/src/routes/settings/setup/+page.svelte:68-76,769-776`.
- **Other references:**
  - Spec: `docs/superpowers/specs/2026-08-31-submitter-guessing-design.md` — §4/§4a
    (placement), §5 (anonymity), §6 (assignment rules), **§7.4 (this feature)**, §7.5
    (comment work), §14 (rehearsal).
  - Prior research: `.superpowers/research/c3-grid-ui-patterns.md` — the existing-code
    inventory this brief draws on. **Its §5 styling recommendation is superseded** (see §2a).
  - Build ledgers: `.superpowers/sdd/2026-08-31-guess-{spine,horizon,workspace-shell}/progress.md`.
