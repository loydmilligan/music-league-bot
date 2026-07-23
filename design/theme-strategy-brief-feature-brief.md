# Feature Design Brief *(existing repo)*

> **For:** Claude Designer (CD) · **Written by:** Claude Code (CC) · **Product:** Music League Bot (bot-ui)
> **Feature:** Theme Strategy Brief — in-Research-tab panel · **Date:** 2026-07-23 · **Brief version:** 1
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

- **Product:** A private, single-owner web dashboard + bot for running Music League (a song-submission/voting game) across several friend-group leagues — importing rounds, researching candidate songs, generating recap "digests," and tracking taste.
- **The feature, in one sentence:** A **Theme Strategy Brief** — on the round-detail Research tab, a button that generates and reveals a styled, expandable panel showing how this round's theme (or similar themes) performed in prior runs across all leagues, what wins/loses, and audience-aware guidance on what to submit.
- **Why now:** The brief's backend + data model just shipped and is deployed/working (endpoint `/api/theme-brief/[roundId]`, live-validated on the upcoming "¡No Entiendo, Cabron!" round). The current front-end (`ThemeBriefView.svelte`) is a bare, functional stand-in; it needs to become a native, MLB-styled surface inside the round screen.
- **Who reviews / decides:** The owner (Matt / "Mashew") — sole user and decision-maker.
- **Deadline / milestone, if any:** No hard deadline. The upcoming Boarz II Men round "¡No Entiendo, Cabron!" (id 145) is the first real target and a natural demo.

---

## 2. Repo orientation  *(CC filled from the local checkout)*

- **What the codebase is:** SvelteKit (Svelte 5, runes mode) app in `ui/`, TypeScript + Tailwind v4, better-sqlite3. Server routes under `ui/src/routes`, shared UI/logic under `ui/src/lib`. A sibling `mcp-server/` exposes tools (incl. a new `get_theme_brief`). Runs in Docker (`bot-ui` container, port 3002).
- **How to run / view it:** `cd ui && npm run dev` (Vite). Prod is `https://mlb37.mattmariani.com`. Route of interest: **the round-detail screen** `ui/src/routes/league/[league]/season/[n]/round/[roundId]/+page.svelte` — e.g. `/league/boarz-ii-men/season/1/round/145`. Standalone brief route (bare, will be superseded/absorbed): `/theme-brief/[roundId]`.
- **Key directories:**
  - `ui/src/lib/theme-brief/` — the new feature's data + current bare view (`ThemeBriefView.svelte`, `exposureLabel.ts`, `types.ts`).
  - `ui/src/lib/song/` — the **universal song card** system (`SongCard.svelte`, `canonical.ts`, `SongList.svelte`, `adapters.ts`).
  - `ui/src/lib/components/` — shared components incl. `ResearchList.svelte` (the Research tab body), `PromoteActions.svelte` (shortlist/round/h2h picker), `HeadToHeadCard.svelte`, `SectionLabel.svelte`, chips.
  - `ui/src/app.css` — the design tokens (Tailwind v4 `@theme`).

### 2a. Design system, as implemented

- **System in use:** The **bot-ui house system** — a bespoke dark "pulp / sports-almanac" look. *(assumption: it descends from **Mashco** — there is a `mashco-design-handoff` under `docs/` and a `mash-co-design-system` bundle in `taste-waveform-package/`; treat `src/app.css` as the source of truth regardless of lineage. See D-note in §13.)*
- **Where tokens live:** `ui/src/app.css` — a Tailwind v4 `@theme { … }` block generating `bg-*`, `text-*`, `border-*`, `font-*` utilities.
- **Component library location & inventory:** `ui/src/lib/song/` (song cards + list + sheet), `ui/src/lib/components/` (chips: `DeadlineChip`, `StatusChip`, `SectionLabel`; `ResearchList`, `PromoteActions`, `HeadToHeadCard`, `SongRatingBars`, `RingGauge`), `ui/src/lib/song/RingGauge.svelte`, `ui/src/lib/digest/StandingsChart.svelte` / `StatStrip.svelte` / `AlbumPodium.svelte` (digest viz that may be reusable).
- **Icon set / illustration:** No formal icon library; inline emoji + unicode (🥇🔻🎵) and CSS shapes are used. Confirm before adding an icon dependency.
- **Fonts in use:** `--font-sans` **Inter Tight**, `--font-display` **Bricolage Grotesque**, `--font-mono` **JetBrains Mono**. Mono is used heavily for labels/section headers (uppercase, wide tracking).

### 2b. Existing visual & interaction vocabulary  *(actual values from `src/app.css` + components)*

- **Color palette (actual tokens):**
  - Surfaces: `--color-bg #07090c` (page), `--color-bg-elevated #0d1116`, `--color-surface #141921` (cards/panels), `--color-surface-hover #1d2128`, `--color-surface-strong #283039`.
  - Hairlines: `--color-border #3a4451`, `--color-border-muted #283039`.
  - Text: `--color-fg #f1f4f7`, `--color-fg-muted #c2cad3`, `--color-fg-dim #8b97a4`, `--color-fg-faint #5a6773`.
  - Accent (orange): `--color-accent #ff5b2e`, `--color-accent-strong #d94c23`, `--color-accent-deep #8a2d15`, `--color-accent-bg #221a14`.
  - Semantic: `--color-health #3ec27a` (green/ok), `--color-warn #e8a83a` (yellow).
  - **Research axes** (reused for ratings/gauges): `--color-sky #5aa3ff` (discovery), `--color-ember #e6566c` (theme fit), `--color-moss #3ec27a` (quality), `--color-amber #e8a83a` (replayability), each with a `-bg` surface variant.
- **Type scale & families:** Body Inter Tight; section labels are `font-mono text-xs tracking-widest uppercase text-fg-faint` (e.g. the "Search Spotify" header, `ResearchList.svelte:212`); display/headline uses Bricolage.
- **Spacing / density:** Compact, information-dense. Tailwind spacing; cards `rounded` with `1px` hairline borders; generous use of `text-xs`/`text-sm`; panels are `bg-surface` on `bg-bg`.
- **Signature components & behavior:**
  - **Tab strip** (round screen, `+page.svelte:393-406`): underline-style tabs; active = `border-accent text-accent font-bold`, inactive = `text-fg-muted border-transparent hover:text-fg`, each with a count.
  - **`SongCard`** (`src/lib/song/SongCard.svelte`): the universal, layered card. Config type `SongCardConfig` in `src/lib/song/canonical.ts` — `layers` (`state|rating|meta|tags|badges|corpus|chat|notes|analyze`) + `actions: ActionId[]` where `ActionId ∈ 'shortlist'|'research'|'h2h'|'assign'|'play'|'ytm'|'save'|'remove'`. Research tab wires `actions: ['play','ytm','save','remove']` (`ResearchList.svelte:28`).
  - **`PromoteActions`** (`src/lib/components/PromoteActions.svelte`): the shortlist / add-to-round / **add-to-h2h** picker (`pickerMode: 'shortlist'|'round'|'h2h'`) — this is the existing "add to head-to-head" mechanism.
  - **Chips**: `DeadlineChip`, `StatusChip`, `SectionLabel` — small mono uppercase pills.
- **Interaction patterns:** Fetch + `invalidateAll()` after mutations; inline async buttons flip to a "…ing" label while pending (e.g. `{searching ? 'Searching…' : 'Search'}`); lazy-load per tab on first activation (h2h tab, `+page.svelte:281-285`). Sections open/close inline (no heavy modals for content).
- **Tone of UI copy** *(real strings)*: terse, lower-drama, a little playful. E.g. "No research candidates yet. Search above to add some." · "Chat not linked for this league yet." · section labels like "Search Spotify", "ML Playlist", "Chat Songs".
- **Established states:** Empty → mono italic faint line ("No research candidates yet…"). Loading → inline button label swap / lazy panels. Error → short inline message. No skeletons currently for long ops.

### 2c. Current information architecture

- **Top-level nav / IA:** League → Season → Round. The **round-detail screen** is the deepest, most-used surface, with a tab strip: **ML Playlist · Chat Songs · Chat History · Research · Head-to-Head**.
- **Where the user is when this feature becomes relevant:** On the round-detail screen for an **upcoming** round, deciding what to submit — i.e. already on/near the **Research** tab, where they search Spotify and audition candidates.

---

## 3. The feature — what & why

- **What it does:** Generates (via 2 cheap LLM calls, ~15–20s, then cached) and displays a strategy brief for the round's theme: prior runs of the same/similar theme across all leagues (each with 🥇🥈🥉 podium + 🔻 cellar and its scoring type), a **Winner DNA** and **Cellar Traps** synthesis, a **familiarity→points** stat/chart, an **audience-aware "already-played"** list (which players in *this* league saw the owner's past picks), and **"What to submit"** taste guidance.
- **Core user value:** Turn "what should I submit for this theme?" from guesswork into an evidence-backed decision, using the group's own voting history.
- **The one outcome it must deliver:** The owner, standing on the Research tab of an upcoming round, can read the brief and walk away knowing the *type* of song to submit — and can push promising songs straight into their head-to-head shortlist without leaving the tab.
- **Scope — in / out / later:**

| In scope | Explicitly out | Later |
|---|---|---|
| The generate button + styled expandable brief panel on the Research tab | Changing the brief's *data/LLM* logic (shipped, frozen) | Auto-generate on tab open |
| Reusing the universal `SongCard` for song lists, incl. add-to-head-to-head | A new global nav item | Multi-theme trend dashboards |
| MLB-styled versions of the 7 report sections; generate/loading/cached/empty/error states | Editing rounds or votes | Per-player taste enrichment (separate "Feature B") |
| Making the audience-aware "already-played" recognition legible | Touching other tabs' behavior | Sharing/exporting the brief |

---

## 4. Where it lives — touchpoints & entry points

- **Screens/flows this touches:** The round-detail **Research** tab body, i.e. `ui/src/lib/components/ResearchList.svelte` (rendered at `+page.svelte:645-646`). The standalone `/theme-brief/[roundId]` route + `ThemeBriefView.svelte` exist but are a bare stand-in — CD's design supersedes/absorbs them.
- **New entry point (team's preferred):** A **large "Generate Theme Strategy Brief" button placed above the "Search Spotify" panel** inside the Research tab (`ResearchList.svelte:210-212` is that panel's top). Clicking it reveals an **MLB-styled expandable/collapsible section** with the brief.
- **How it fits the current IA:** As a section *within* the existing Research tab — not a new tab — so it sits in the exact context where the user is choosing what to submit. (An own-tab alternative is on the table — see D1.)
- **What it must not disrupt:** The existing Research search → candidate list → rating → promote/h2h flow must keep working unchanged; the brief section sits above it and collapses out of the way.

---

## 5. Users & jobs for this feature

- **Who uses it:** The single owner (Matt/"Mashew"). Personalized: the audience-aware layer compares *his* submission history to the target league's roster.
- **Jobs-to-be-done (priority):**
  1. See how this theme has performed before and what wins → decide the *type* of song to submit.
  2. Avoid resubmitting something the current league's players have already seen me play.
  3. Push candidate songs from the brief into my head-to-head shortlist to audition them.
- **Frequency & context:** Once per upcoming round (a handful of times a month), on the round-detail screen, while deciding a submission.
- **What they do today instead:** Nothing structured — memory + scrolling old rounds. The bare `ThemeBriefView` shows the data but isn't pleasant or native.

---

## 6. Ideas to flesh out  *(named by the team)*

### Idea A — Button-in-Research-tab → inline expandable brief  *(team's preferred)*
- **The idea:** A **large button above the Search Spotify panel** on the Research tab reading "Generate Theme Strategy Brief". On click it generates and reveals an **MLB-styled expandable/collapsible section** containing the report, better-styled than the current bare view.
- **Why the team is interested:** Puts the intelligence exactly where submission decisions happen, without a context switch; reuses the tab's existing song-research muscle memory.
- **Known constraints / behavior:** Must sit above the search panel; must not disturb the existing research list below; collapsible so it gets out of the way once read; generation is ~15–20s then cached (regenerate available).
- **Open questions:** How the 7 sections are arranged inside one collapsible container (§D3); how the long generation wait is presented (§D4).

### Idea B — Song lists use the universal `SongCard` with "add to head-to-head"
- **The idea:** The brief's song lists (podiums/cellars from prior runs, and/or the "already-played" list) render with the **same universal `SongCard`** used elsewhere in the Research tab, **including the ability to add a song to the head-to-head list**, just like other research songs.
- **Why the team is interested:** Consistency (one card everywhere) and a direct path from "this old winner is the vibe" → audition it in h2h.
- **Known constraints / behavior:** Reuse `SongCard` + `SongCardConfig`; `'h2h'` is already a first-class `ActionId` (via `PromoteActions`). **Data caveat CD must design around:** h2h/shortlist is **round-scoped to the current round**, but prior-run songs belong to *other* rounds/leagues — the design must make "add to *this* round's h2h" coherent for a song pulled from history (see §D2).
- **Open questions:** Which song lists get full cards vs. compact rows; which card actions to expose (`play`/`ytm`/`h2h`/`save`); whether every prior-run song is addable or only some.

### Idea C — Own top-level round tab (alternative placement the team floated)
- **The idea:** Instead of (or in addition to) the in-Research button, a **new "Theme Brief" tab** in the round-detail tab strip (alongside ML Playlist / Chat Songs / Chat History / Research / Head-to-Head).
- **Why the team is interested:** More room to breathe for a dense report; a clear home.
- **Known constraints / behavior:** Would follow the existing underline tab-strip pattern with a count/indicator; lazy-load on first open like the h2h tab.
- **Open questions:** Does a dedicated tab fragment the "decide what to submit" flow away from Research? (The team leans against a separate tab — see §D1.)

---

## 7. Open areas for CD to explore  *(CC-identified)*

### Open area 1 — The audience-aware "already-played" moment  *(proposed by CC)*
- **What it is & why it's worth a look:** The single most novel/valuable output is: *"you submitted Abissama in Second Best — **Jon Black (in this league) saw it**, so he'd recognize a resubmit."* vs. a muted "no one here saw this." This deserves a distinctive, glanceable treatment (recognition badge / warning accent / who-saw-it, possibly player avatars — an avatar system exists) rather than a plain list row. It's the "aha" of the feature.
- **How it relates:** It's report section #6; but it's the emotional hook and should probably read differently from the neutral prior-run standings.

### Open area 2 — Familiarity→points as a first-class visual  *(proposed by CC)*
- **What it is & why it's worth a look:** The core insight ("familiar songs win": mainstream 14.4 vs obscure 8.4 avg points) is currently a plain list. The repo already has `RingGauge`, `SongRatingBars`, and digest `StandingsChart` in the house style — a small, on-brand chart would make the pattern *shown*, not just stated, and keep dataviz consistent.
- **How it relates:** Report section #5; supports the "what to submit" recommendation.

---

## 8. Existing patterns to honor / reuse

- **Components to reuse as-is:** `SongCard` (`src/lib/song/SongCard.svelte`) + `SongCardConfig` (`canonical.ts`) for all song rows; `PromoteActions` for the add-to-h2h/shortlist picker; `SectionLabel`/chips for headers; `StatusChip`/`DeadlineChip` for scoring-type / exactness tags.
- **Patterns to follow:** The underline tab-strip (if D1 goes to a tab); the mono-uppercase section-label header pattern; inline "…ing" async button labels; empty state = mono italic faint line; fetch → `invalidateAll()` after mutations; lazy-load-on-first-open.
- **Things CD may extend, with care:** `SongCardConfig` (e.g. a new compact/history variant or a badge for "recognizable"); the digest viz components (`StandingsChart`, `RingGauge`) if repurposed for the familiarity chart.
- **Things CD should NOT touch/change:** The brief's data shape/`types.ts` and the `/api/theme-brief` contract; the existing Research search/rate/promote flow; global tokens in `app.css` (use them, don't redefine).

---

## 9. Decision points to game out  ⭐

---

### D1. Placement: in-Research expandable section vs. own tab · **[Required — from team]**

- **The decision / question:** Does the brief live as a button-triggered expandable section **inside the Research tab** (team's stated preference), get its **own round tab**, or both (a compact teaser in Research + a deep-dive tab)?
- **Why it matters:** Sets the whole layout budget and how the feature connects to the submission decision. In-Research keeps it in the decision context but competes for vertical space above the search panel; an own tab gives room but risks fragmenting the flow.
- **Options on the table:** (A) Button above Search Spotify → inline collapsible section *(preferred)*; (B) new "Theme Brief" tab in the strip; (C) hybrid — a slim summary card in Research that links/expands to a fuller tab.
- **Constraints from the existing system:** Must reuse the underline tab pattern if a tab; must not push the research search/list out of reach if inline.
- **What CD should put on the canvas:** In-context screens of the real round-detail page showing A vs. B (and optionally C), with the brief collapsed and expanded, so the space trade-off is visible.
- **How we'll decide:** Owner picks based on whether the collapsed-vs-expanded inline version stays out of the way while the research list is in use.

---

### D2. Song rows from history: which lists, which card, and how "add to h2h" works cross-round · **[Proposed by CC]**

- **The decision / question:** For prior-run songs (podium/cellar) and the "already-played" songs, which use a **full `SongCard`** vs. a **compact row**, which **actions** appear (`play`/`ytm`/`h2h`/`save`), and how is **"add to this round's head-to-head"** framed given those songs come from *other* rounds/leagues?
- **Why it matters:** The team explicitly wants universal cards + add-to-h2h, but h2h is round-scoped — a naïve "add to h2h" on a foreign-league winner is semantically odd. The answer shapes both the card config and the data flow (may need to add the song to *this* round's research/shortlist first).
- **Options on the table:** (A) Full `SongCard` with `['play','ytm','h2h']` on prior-run podiums, treating "add to h2h" as "add this track as a candidate for *this* round + into h2h"; (B) compact rows for standings, full cards only for the owner's "already-played" songs; (C) read-only rows for history, with a single "search this song for this round" affordance that hands off to the existing Search Spotify flow.
- **Constraints from the existing system:** `SongCard.actions` supports `'h2h'`; `PromoteActions` picker is round-scoped; adding a foreign song to the round likely reuses `addCandidate`/research POST.
- **What CD should put on the canvas:** The prior-run standings block rendered three ways (full-card, compact-row, read-only+search-handoff), each showing the add-to-h2h affordance and its microcopy.
- **How we'll decide:** Owner judges whether pushing a historical winner into the current h2h feels natural and useful vs. cluttered.

---

### D3. Anatomy of the expandable brief: how the 7 sections are arranged · **[Proposed by CC]**

- **The decision / question:** Inside one MLB-styled collapsible section, how are the 7 parts organized — header (“the Nth run of this theme”), per-run podium/cellar, Winner DNA, Cellar Traps, familiarity chart, already-played, what-to-submit? One long scroll, an inner accordion of sub-sections, or inner sub-tabs?
- **Why it matters:** It's a dense report in a space-constrained spot above the research list; scannability vs. completeness is the core tension.
- **Options on the table:** (A) Single scroll with strong section labels + a sticky mini-summary (runCount + top takeaway) at the top; (B) inner accordion (each of the 7 collapsible, "What to submit" open by default); (C) a compact always-visible summary (verdict + familiarity + what-to-submit) with a "full history" reveal for the per-run detail.
- **Constraints:** Reuse mono-uppercase section labels; keep it collapsible as a whole; degrade gracefully for the "first time / no prior runs" case.
- **What CD should put on the canvas:** The expanded panel in all three arrangements at realistic content length (3 prior runs, ~10 songs each), plus the collapsed state.
- **How we'll decide:** Owner reads a realistic brief and picks the layout that surfaces the verdict fastest without hiding the evidence.

---

### D4. Generate → wait → cached/regenerate → empty/error states · **[Proposed by CC]**

- **The decision / question:** How is the ~15–20s generation presented, and how do the cached, regenerate, first-time (no prior runs), and error states look?
- **Why it matters:** A 15–20s LLM wait with no feedback feels broken; and the button's meaning changes once a brief is cached (Generate → Regenerate/Refresh). This is the feature's first impression.
- **Options on the table:** (A) Button → inline progress with staged copy ("Finding prior runs… reading the votes… writing the brief") + a skeleton of the panel; (B) simple spinner + disabled button; (C) optimistic reveal of the deterministic parts (matches/podiums/familiarity, which are fast) while the LLM narrative streams/fills in.
- **Constraints:** No skeleton pattern exists yet (CD may introduce one, on-brand); the endpoint returns the whole brief at once (no streaming today) — option C implies a backend follow-up, flag it.
- **What CD should put on the canvas:** The button's three lives (Generate / Generating… / Regenerate), the loading state, and the "first time for this theme" empty state.
- **How we'll decide:** Owner picks the wait treatment that best fits the once-per-round cadence and the house tone.

---

### D5. Making the audience-aware "already-played" recognition pop · **[Proposed by CC]**

- **The decision / question:** How does a "recognizable" past pick (a current-league player saw it) look vs. a "safe" one, and how are the who-saw-it names/players shown?
- **Why it matters:** This is the feature's differentiator; a flat list buries it. It's also mildly sensitive (naming who'd "catch" a resubmit) so tone matters.
- **Options on the table:** (A) A warning-accent badge on recognizable rows ("👀 Jon Black would recognize this") + muted styling for safe ones; (B) player **avatars** of who saw it (an avatar system exists) as a small stack on the row; (C) a dedicated "watch-outs" callout summarizing recognizable picks separately from a neutral "your history" list.
- **Constraints:** Reuse accent/warn tokens and existing chip/avatar components; owner-only audience so tone can be candid but should stay light.
- **What CD should put on the canvas:** The already-played list with recognizable vs. safe treatments, in all three encodings.
- **How we'll decide:** Owner picks what makes the "don't get caught recycling" signal land at a glance.

---

### D6. The familiarity→points visual · **[Proposed by CC]**

- **The decision / question:** Show the familiarity-vs-points relationship as a reused house chart, a new small chart, or just styled stat tiles?
- **Why it matters:** It's the quantitative backbone of "familiar wins"; making it visual sells the recommendation, but a bespoke chart risks inconsistency with existing dataviz.
- **Options on the table:** (A) Reuse/adapt `StandingsChart`/`RingGauge`/`SongRatingBars` for a 3-bucket bar or gauge; (B) a new minimal bar (mainstream/mid/obscure → avg points) in house tokens; (C) three stat tiles (avg points per bucket) with a one-line caption, no chart.
- **Constraints:** Match existing dataviz color/scale conventions (the sky/ember/moss/amber axis palette exists); keep it small — it's one section of a dense panel.
- **What CD should put on the canvas:** The familiarity section in the chart vs. stat-tile treatments at real values (14.4 / 12.7 / 8.4).
- **How we'll decide:** Owner picks the lightest treatment that still makes the pattern obvious.

---

## 10. Constraints

- **Technical:** Svelte 5 runes, Tailwind v4 tokens from `app.css`, no new heavy deps without reason (no icon lib today; emoji/CSS in use). The `/api/theme-brief/[roundId]` contract and `theme-brief/types.ts` are fixed. h2h/shortlist is round-scoped (see D2). Generation is a single non-streaming response (~15–20s), cached in `theme_briefs`.
- **Brand & consistency:** Must read as the same product as the rest of the round screen — dark pulp surfaces, orange accent, mono uppercase labels, compact density. Reuse `SongCard` and chips.
- **Accessibility bar:** Match current app (functional dark-mode contrast). Note: the codebase already carries a few `a11y_consider_explicit_label` warnings — CD should give buttons/controls explicit labels and not regress contrast; keyboard-operable expand/collapse.
- **Risks / past problems:** This repo has a **Svelte `{#each}` key-duplicate hydration crash** history — any list CD specs must key on a stable unique field (song `spotifyUri`, run `roundId`, exposure `submissionId`). Song lists can tie on points (equal totals), so don't key on points.

---

## 11. Success criteria

- **How we'll judge it's good:** The owner opens an upcoming round's Research tab, taps Generate, and within one screen-read knows the theme's verdict and what to submit — then can audition a historical winner in h2h without leaving the tab. It looks indistinguishable in polish from the rest of the round screen.
- **Metrics it should move:** Qualitative (owner uses it each round instead of guessing); indirectly, better-placed submissions.
- **What "fits the product" means, concretely:** Uses `app.css` tokens only, reuses `SongCard`/chips, matches the tab strip + mono-label patterns, and the collapsed state is unobtrusive above the search panel.

---

## 12. Deliverables & logistics

- **Fidelity expected:** High-fidelity, in-context screens of the round-detail Research tab (collapsed + expanded), plus the key states (generate/loading/cached/empty/error) and the song-row/add-to-h2h treatments.
- **Variations wanted, and on what:** The D1 placement (in-Research vs. tab), the D3 panel anatomy, the D2 song-row/add-to-h2h treatment, and the D5 recognition encoding.
- **Deliverable format:** Handoff packet per `Handoff-Packet-Manifest.md` (zip) + a kickoff prompt for CC. Additions: a mapping of each designed section to the `ThemeBrief` fields it renders (`matches[].podium/cellar`, `winnerDna`, `cellarTraps`, `familiarity[]`, `alreadyPlayed[]`, `whatToSubmit`, `songLanguages`).
- **Review cadence:** Single owner-reviewer; expect one joint pass over the canvas to settle D1–D6, then the full design.

---

## 13. Open questions & unknowns

- **Scope ambition (assumption):** Treat this as a **focused first pass that leans on existing components** (SongCard, chips, existing viz) rather than inventing new visual language — the backend just shipped and the owner wants it native fast. CD should bias options toward the simplest viable choice and defer speculative richness. *(Confirm with owner.)*
- **Design-system lineage (unknown — needs decision):** Is the house system formally "Mashco," and should CD load a Mashco skill/asset, or just work from `app.css`? Default: work from `app.css` as source of truth. *(D-note referenced in §2a.)*
- **Add-to-h2h semantics for foreign songs (unknown — needs decision):** Confirm whether a prior-run song, when "added to h2h," should first be added as a candidate for *this* round (reusing the research add flow) — this affects D2 and may need a tiny backend/data step.
- **Avatars in the already-played list (unknown):** Player avatars exist — confirm whether to use them for "who saw it" (D5) or keep to names/chips.
- **Loading richness (unknown):** Is the staged/optimistic loading (D4 option C) worth a small backend follow-up (partial/streamed response), or is a simple skeleton fine for a once-per-round action?
- **Compact vs. full history (unknown):** How much prior-run detail does the owner actually want inline vs. behind a reveal (D3)?

---

## Appendix — file map & references

- **Design tokens:** `ui/src/app.css` (`@theme` block — colors, fonts).
- **Component library:** `ui/src/lib/song/SongCard.svelte`, `ui/src/lib/song/canonical.ts` (`SongCardConfig`, `ActionId`, `LayerId`), `ui/src/lib/song/SongList.svelte`; `ui/src/lib/components/ResearchList.svelte`, `PromoteActions.svelte`, `HeadToHeadCard.svelte`, `SectionLabel.svelte`, `RingGauge.svelte`, `SongRatingBars.svelte`; digest viz `ui/src/lib/digest/StandingsChart.svelte`, `StatStrip.svelte`, `AlbumPodium.svelte`.
- **Screens the feature touches:** `ui/src/routes/league/[league]/season/[n]/round/[roundId]/+page.svelte` (tab host; Research at :645), `ui/src/lib/components/ResearchList.svelte` (target surface; Search-Spotify panel at :210-212).
- **The feature's current (bare) UI + data:** `ui/src/lib/theme-brief/ThemeBriefView.svelte`, `exposureLabel.ts`, `types.ts` (`ThemeBrief`, `MatchedRun`, `SongStanding`, `Exposure`, `Bucket`), `assemble.ts`; endpoint `ui/src/routes/api/theme-brief/[roundId]/+server.ts`.
- **Other references:** Design spec `docs/superpowers/specs/2026-07-23-theme-strategy-brief-design.md`; plan `docs/superpowers/plans/2026-07-23-theme-strategy-brief.md`; possible design-system lineage `docs/mashco-design-handoff*`, `taste-waveform-package/.../mash-co-design-system-*`.
