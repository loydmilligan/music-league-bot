# Handoff: C3 — The Refine Grid ("the sudoku board")

> Spec §7.4 · music-league-bot UI (`ui/`) · Design settled with Matt, 2026-09-01
> Companion docs in this folder: **DECISIONS.md** (the D1–D6 log) · **TOKEN-MAP.md** (element → `app.css` token) · **reference/original-brief.md**.

## Overview

The refine grid is a per-round reasoning board where Matt works out **which player submitted which anonymous song**. Per song he names one or more **candidate players**; each becomes a **row** carrying a **state** (`possible → prime → locked`), a **certainty** (0–100), and free-text **factors** and **notes**. The point of the surface is *cross-song elimination*: marking a player **prime** dims them everywhere else (advisory); marking them **locked** removes them everywhere else (hard). A single song is usually ambiguous; the board resolves it by constraint satisfaction.

It renders inside the existing `GuessWorkspace.svelte` host, in the **Guess** tab of the round page, as the `phase === 'refine'` layer — directly below the shipped *gut* phase. **It must be indistinguishable from the gut phase.**

## About the design files

The files in this bundle are **design references built in HTML** — prototypes of look and behavior, **not production code to copy**. The task is to **recreate them in the existing `ui/` codebase** using its real environment: **Svelte 5 runes + Tailwind v4 utilities against `app.css` `@theme` tokens**. Do not port the inline styles or the `.dc.html` runtime; translate each element to the equivalent Tailwind utility / token named in **TOKEN-MAP.md**.

- **`Refine Grid — Full Design.dc.html`** — the comprehensive surface: the live board (9 songs, Boarz R148 shape) with the ledger, plus a reference gallery of the saving / rejected-write / unsatisfiable / fully-settled states. This is the build target.
- **`Refine Grid — Option Canvas.dc.html`** — the six decision points (D1–D6) with every option shown in context, and the reasoning on each. Read it to understand *why* the chosen option won; not needed to implement.

Open either by serving the folder (they load `support.js` from the same directory).

## Fidelity

**High-fidelity.** Final colors, type, spacing, density, copy register and interaction model are all intended as shown — every value maps to an existing `app.css` token (see TOKEN-MAP.md). Recreate pixel-faithfully using the codebase's utilities. The one deliberately non-final area: exact microcopy strings are in the app's register but Matt should confirm final wording.

## The design, in one screen

A two-column layout inside the existing workspace chrome:

```
tab strip (existing) ────────────────────────────────────────────
rehearsal banner (existing, conditional) ─────────────────────────
phase: gut  (existing, shown collapsed above) ────────────────────

phase: refine  ← eyebrow, mono, accent
<validation roll-up line>  ← one mono line (D5)
┌──────────────────────────────────────────┬───────────────────┐
│  BOARD (1fr)                              │  LEDGER (244px,    │
│  per song:                                │  sticky)  (D6)     │
│   #n  Title  Artist          gut · Name   │  availability of   │
│   ├ candidate row (resting)               │  all 9 players,    │
│   │   name · [state chip] · avail-tag ·   │  one row each,     │
│   │   fac/note dots · certainty · model│  free/dimmed/taken │
│   │   (expands on click → editor)         │  + legend + the    │
│   └ roster strip: click a name to add     │  reserved model    │
│  …                                        │  key               │
└──────────────────────────────────────────┴───────────────────┘
states gallery (reference only — not part of the shipped surface)
```

## Screens / views & components

### 1. Phase header + validation line (D5 — *inline markers + one roll-up line*)

- **Eyebrow:** `phase: refine` in mono uppercase, `--color-accent`, tracking-widest — same treatment as the shipped `phase: gut`. A muted mono sub-phrase follows: `build the case — name suspects, eliminate across the board`.
- **Validation roll-up:** one mono line, `text-xs`/`text-sm`. Three registers:
  - default (progress): `text-fg-dim` — e.g. `3 of 9 locked · 1 song no candidate (#9)`
  - conflict: `--color-ember` (`#e6566c`) — e.g. `1 conflict · Conor locked #3 & #6 — resolve before submit`
  - settled: `--color-moss` (`#3ec27a`) — `9 of 9 locked · no conflicts · ready to submit`
- This extends the gut phase's single-line idiom (`"validation: clean — …"`), does **not** replace it with a panel. In addition, each conflicting song shows a **quiet inline marker on both sides** (see song header, below) so Matt never hunts for the other half of a duplicate.

### 2. Song block

- **Header row:** `#n` (mono, accent) · title (`font-bold text-fg`) · artist (`text-fg-muted`) · right-aligned `gut · <Name>` marker (mono, `text-fg-faint`) — **the gut pick, non-editable** (see Decisions §gut-pick). If the song has a duplicate-lock conflict, an ember marker `⚠ <Name> locked twice` sits left of the gut marker.
- **Empty state** (no candidates): a dashed-border mono line `no candidates yet — add a suspect below`, `text-fg-faint`, with the same `border-l-2` rail in `--color-border-muted`.
- **Candidate rows** then the **roster strip**, described next.

### 3. Candidate row — resting (D4 — *summary at rest, expand on click* · D1 — *state chip*)

One line, `bg-surface` with a `border-l-2` rail (the app's signature list treatment). Left→right:

| Element | Detail |
|---|---|
| **Name** | fixed ~66px, `text-fg`; weight tracks state (400/600/700 for possible/prime/locked). When *taken* elsewhere: `line-through`, `text-fg-faint`. |
| **State chip** (the control) | mono uppercase pill; **shows the current state**, is itself the click target, **cycles on click** `possible → prime → locked → possible` and **fires immediately** (not debounced). Glyph + label + rail together carry state so it never relies on color: `○ possible` (border `--color-border`, `text-fg-dim`), `◐ prime` (amber border+fill+text), `● locked` (accent border+fill+text, rail thickens to 3px). |
| **Availability tag** (D3) | mono, only when committed elsewhere: `◐ prime · #n` (amber) or `● locked · #n` (dim). Names *where*, so Matt can jump to it. |
| **factors / notes dots** | two 6px squares; filled `--color-accent` when the field has content, else `--color-border-muted`. The at-rest signal that text exists without showing it. |
| **your certainty** | 26px mini-bar (accent fill on `--color-border-muted` track) + mono value; `—` when `null`. |
| **model slot** (reserved) | separated by a hairline; a dashed placeholder bar + `—` in `--color-border`. **Reserved for Project D** (AI likelihood %). Renders inert now; becomes a second mono value beside certainty when D lands. Do not remove — it holds the column so D drops in without a reflow. |

Clicking anywhere on the row (except the chip) toggles the editor. The chip `stopPropagation`s so cycling never expands.

### 4. Candidate row — expanded editor (D4)

Opens **in place** below the row (no modal, no navigation, scroll kept) on `--color-bg-elevated`, same rail. Stacked, each with a 58px mono label:
- **certainty** — native `<input type="range" min=0 max=100>`, `accent-accent`, live mono readout in `--color-accent`. **Do not build a custom slider.**
- **factors** — `<textarea rows=2>`, `rounded-lg`, placeholder `why them — the evidence`.
- **notes** — `<textarea rows=2>`, placeholder `loose thinking`.
- **model** (reserved, ~55% opacity) — dashed box reading `likelihood % + reasoning · reserved · Project D`. Inert.
- footer: a `remove` text button (mono, `text-fg-faint`), right-aligned. Calls shipped `removeCandidate`.

### 5. Candidate picker — roster strip (D2 — *always-visible roster strip*, chosen over the spec's typeahead)

Under each song's rows: an `add` mono label then the full eligible roster as click-to-add pills. **The strip is also the availability display** — each name shows its cross-song state right where you pick it:
- **free:** `--color-border` border, `text-fg-muted`, click adds.
- **dimmed** (prime elsewhere): amber border, `#n` tag, ~74% opacity, still addable.
- **taken** (locked elsewhere): `line-through`, faint, `#n` tag, ~50% opacity, **disabled**.
- **already a candidate here:** ~28% opacity, disabled.

Rationale for overriding the spec's typeahead: 9 local names don't warrant a keystroke + context-switch per add, and a typeahead hides availability until after you choose. See DECISIONS.md D2. (If the roster ever exceeds ~12, add a filter box above the strip — the D2d hybrid — but do not add remote search; `SearchBar.svelte`'s fetch plumbing is not warranted.)

### 6. Availability ledger (D6 — the claimed slot: *standing availability ledger*)

A **sticky 244px side rail**, `--color-bg-elevated` panel with `--color-border-muted` hairlines. Header: `availability ledger` + a live summary `N free · N dimmed · N taken`. Then one row per eligible player, each with the same `border-l-2` rail treatment as candidate rows: rail color and a mono label encode `free` / `prime #n` / `lock #n`; taken names go `line-through`+faint. A footer legend explains the three rails and the reserved `model % · Project D` key. This answers success-criterion #1 ("who's still free?") for the whole roster at once, and doubles as the songs-vs-players supply count that makes the unsatisfiable end-state legible.

## Interactions & behavior

- **State cycle:** immediate write (the exception to debouncing), `disabled` in flight, reflects the server's answer on re-read. Wraps at `locked → possible`.
- **Certainty / factors / notes:** **optimistic local edit + per-item 400ms debounced `PATCH`**, exactly per `VotingLab.svelte:75-113`. A `flushPendingSaves()` must clear and await all pending timers before any read-after-write (i.e. before re-reading availability) and on unmount / round change / phase change.
- **Availability propagation (the sudoku effect — success criterion #2):** availability is **derived server-side by `playerAvailability` and re-read after each status write** — it is *not* computed client-side. On the state change: write → re-read → re-render. The rows whose availability changed get a **one-shot ~700ms accent-tint flash** (`@keyframes`, no animation library) so the consequence is *felt*. In the prototype: cycle a player to `locked` and watch every other row and the ledger update, with the changed rows flashing. This moment is the point of the whole board — do not ship it as a silent swap.
- **Rejected-write / desync (required — a real prior bug here):** because Svelte 5 controlled inputs go stale when a write path doesn't end in a changed value (a 409, a rejected write, a blank), **every control needs a designed rejected state.** Design shown: the row keeps the attempted value, its rail turns `--color-ember`, and a single inline mono line appears near the control — `couldn't save — retrying · retry now` — matching the app's only error idiom (`font-mono text-sm text-red-400`, no toasts). After a successful re-read the DOM reconciles to the server's value. See brief §10 (commits `13f99a6`, `12680fb`) — do not assume the happy path.
- **Conflicts are non-blocking:** duplicates are permitted while editing and gated only at submit (spec §6). Feedback informs (roll-up line + inline markers), never blocks or nags.
- **Destructive actions:** inline confirm in place (swap the control for a warning + Confirm/Cancel pair), **never a modal** — per `GuessWorkspace.svelte:140-174`.
- **Locked → comment work (open area 2):** `locked` is the seam into §7.5 (not built). A locked song should visibly *settle*; leave a designed affordance (the settled row + an obvious way in) so C3 doesn't ship a dead end. Do not build §7.5.

## State management

- **Server-derived, nothing cached client-side** — the board survives a refresh / closed laptop. Local `$state` holds only in-flight edits and the debounce `Map<key, PendingSave>`; the source of truth is the DB via the shipped payload.
- **Data contracts are shipped and fixed** (`ui/src/lib/guessing/candidates.ts`, all tested — design *to* them, do not change):
  - `CandidateStatus = 'possible' | 'prime' | 'locked'`
  - `Candidate { songId, playerId, status, certainty: number|null, factors: string, notes: string }`
  - `Availability = 'free' | 'dimmed' | 'taken'` (locked outranks prime)
  - `setCandidate`, `removeCandidate`, `candidatesForSong` (returns `ORDER BY player_id` — arbitrary; see display order below), `playerAvailability(db, roundId, mePlayerId): Map<number, Availability>`
  - roster ships in `WorkspaceData.roster: {id,name}[]` — local, no fetch; gut pick in `WorkspaceData.songs[].gutPickPlayerId`.
- **Display order of rows within a song (UI choice, settled):** sort by **status (locked → prime → possible), then certainty descending.** `candidatesForSong`'s SQL order is arbitrary; apply this in the view.
- **Volume:** 9–13 players × 9–12 songs. No virtualization. Latency is not a concern; round-trip *correctness* is.

## Design tokens

Every element uses an existing `ui/src/app.css` `@theme` token — see **TOKEN-MAP.md** for the element-by-element map. **No new token is required.** The "prime suspect" hue reuses the existing `--color-amber` / `--color-warn` (`#e8a83a`); "conflict/hard" reuses `--color-ember` (`#e6566c`); "settled/good" reuses `--color-moss` (`#3ec27a`). If Matt later wants a *dedicated* prime hue distinct from warn, that is the one candidate token addition — propose explicitly, do not hard-code.

Do **not** use the competing `ui/src/lib/shortlist/colors_and_type.css` vocabulary (`.mash-btn`, `--fg-quiet`, `--surface-2`) — it is the wrong system for this surface (brief §2a).

## Constraints to honor (from the brief)

- Svelte 5 runes + Tailwind v4 against `app.css`. No CSS-in-JS, no styled-components.
- No icon library, no animation library, no toast system, no state-mgmt library — **none exist, do not add.** Iconography = unicode glyphs (`·`, `—`, `○ ◐ ●`, `⚠`) / CSS shapes / inline SVG.
- No shadows anywhere; depth via surface color + hairlines. `rounded-sm` buttons, `rounded-lg` inputs.
- Dark-only; no light theme.
- Logic in tested `.ts`, `.svelte` stays thin; no component test harness exists — don't design correctness that depends on untestable component-internal state machines.
- Do not touch: the tab strip, the round page, the other five tabs, the gut-phase UI, the rehearsal controls, or the data contracts.

## Files in this bundle

- `Refine Grid — Full Design.dc.html` — the build target (board + ledger + states gallery).
- `Refine Grid — Option Canvas.dc.html` — the D1–D6 options and rationale.
- `support.js` — runtime for the two `.dc.html` prototypes (reference only; not for production).
- `DECISIONS.md` — the decision log: what was chosen at each of D1–D6 and the two §13 unknowns, and why.
- `TOKEN-MAP.md` — element → `app.css` token map (requested in brief §12).
- `reference/original-brief.md` — the full design brief.
