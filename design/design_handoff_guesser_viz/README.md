# Handoff: Guess-the-Submitter — season visual ("The Guessers")

## Overview
This is the season-scale visualisation that replaces / absorbs the plain table at the
bottom of the digest's **Guesser** section. It makes the whole room's guessing legible
at a glance — **who plays, how often, and how well** — without letting a 100%-on-one-guess
outrank a 47%-on-38.

It ships as **one tabbed panel** (four tabs) that reads as the section widening from one
person (Matt, the single-player ledger above it) to the whole room. It sits as the **last
block** inside the existing Guesser section — same `DigestSection` shell, same
`.dg-section-wrap` / `data-section-kind` export contract.

## About the design files
The files in `design/` are **design references authored in HTML** (a Design-Component
prototype), showing intended look and behaviour — **not** production code to paste in.
The task is to **recreate this in the real app**: SvelteKit 2 / Svelte 5 (runes),
scoped `<style>` in `GuesserLeaderboard.svelte` (`.gsl-*` prefix), hand-rolled SVG/CSS
(no chart library), server-rendered. Use the repo's existing tokens
(`ui/src/lib/shortlist/colors_and_type.css`) — never hard-code a hex.

- `design/Guesser Season Panel.dc.html` — **the design.** The four tabs.
- `design/Guesser Viz Options (explorations).dc.html` — the option canvas from the review
  (plot / bars / small-multiples / editorial / beeswarm / tangle). Context only, for
  understanding why the final encodings were chosen.
- `data/guesser-viz-data.json` — the real R150 data every mock was built against.
- `reference/guesser-viz-brief.md` — the original feature brief.
- `visuals/` — rendered PNG of each tab.

> The `.dc.html` files reference the design-system bundle by relative path; opened outside
> this project they won't fetch those styles. Read them for structure and exact values;
> the `visuals/` PNGs are the source of truth for appearance.

## Fidelity
**High-fidelity.** Final colours, type, spacing, copy, and interaction are all intended as
shown. Recreate pixel-close using the repo's tokens and the `.gsl-*` scoped stylesheet.
Target width is **~400px (phone)**; it must also render at the wide/export size.

---

## The core visual language (applies across all four tabs)
Two directions are deliberately separated everywhere:

- **▶ Guessing** — how well a player guesses others. Encoded **bright / solid**.
- **⊙ Guessed (target)** — how well others guess *them*. Encoded **pastel fill + a
  coloured ring**, where the **ring colour = who did the guessing** (guesser identity).

Each tab header states which mode it is in plain English ("Guessing skill." / "Being
guessed.") so the reader never has to infer it. Correctness is always **moss = right,
ember = wrong, amber = middling / special, hollow ring = sat out** — colour is never the
only channel (figures and tooltips carry the same fact).

### Guesser identity palette (ring colours on ⊙ target pips)
| Player | Hue | Token |
|---|---|---|
| Matt | `#ff5b2e` | `--mash-pulp` |
| Conor | `#5aa3ff` | `--sky` |
| Jensen | `#e8a83a` | `--amber` |
| Jon | `#3ec27a` | `--moss` |
| Clements | `#e6566c` | `--ember` |
| Steingart | `#a98bff` | **⚠ derived — no matching token.** Needs a real token added, or reassign. |

> ⚠ Only six players have ever guessed, so only six identity hues are needed. Note four of
> them (Conor/Jensen/Jon/Clements) reuse the semantic status hues; that's tolerable because
> on a ⊙ pip the *fill* already carries right/wrong and the ring only carries *who*. If it
> reads ambiguous in-app, swap the identity palette to six purpose-built tints.

---

## Screens / Views (the four tabs)

### Tab 1 — "By player" *(default tab)*
- **Purpose:** find yourself; see both how you guess and how you're guessed, per round.
- **Layout:** intro line → a legend card (`--ink-1` fill, `--line` border, radius `--r-4`)
  → a **2-column grid** (`gap:10px`) of **10 cards**, one per roster player.
- **Card** (`--surface-2` fill, 1px `--line`, radius `--r-4`/10px, padding 11–12px):
  - Header row: player short name (`--font-display` 700, 14px, `--fg`) + season figure
    right-aligned (`--font-mono` 10px). Figure text: `18/38 · 47%` when ≥3 attempts,
    `1/2` when <3 (no % — small sample), `never guessed` when 0.
  - **▶ GUESSING** micro-label (`--font-mono` 7.5px, `.12em`, uppercase, `--fg-muted`).
  - Guessing pip row: **8 pips**, one per round, `flex; gap:3px`. Each pip 9px circle:
    moss (rate ≥ .5), amber (>0), ember (0), hollow 1px `--line-strong` ring (sat out).
    The one override cell (Jensen R6 `1/∞`) is amber with a `--amber-soft` halo.
    `title` = `R{n}: {correct}/{attempts} right` (or `no guess`). Never-guessers show
    `didn't play` here instead of pips.
  - **⊙ GUESSED** micro-label, then a wrapping pip row: **one pip per incoming guess**
    (10px circle), `flex-wrap`. Fill `--moss-soft` (they were named right) or `--ember-soft`
    (wrong), 2px ring in the guesser's identity hue. `title` =
    `R{n}: {guesser} guessed you → ✓ nailed you` / `✗ thought you were {name}`.
- **Content note:** all ten players appear — the four never-guessers (Paletz, Grant, Jimmy,
  Shane) have an empty guessing row (`didn't play`) but a full ⊙ row. An empty card is a
  finding, not a hole.

### Tab 2 — "Field" (volume × accuracy quadrant)
- **Purpose:** who's actually good vs who just plays a lot vs who got lucky once.
- **Layout:** a `position:relative` plot box, height 290px, left axis margin 26px.
  X = guesses made (√-scaled so the lone 38 doesn't crush everyone), Y = hit rate 0–100%.
  Dashed vertical midline at √(6 attempts) ≈ 38% width; dashed horizontal at 50%.
  Left column (low volume) has a faint `rgba(230,86,108,.06)` shade = **small-sample zone**.
- **Four corner labels** (`--font-mono` 8px, `.1em`, uppercase): TL `lucky? / small sample`
  (ember), TR `sharp eye` (moss), BL `dabblers` (quiet), BR `puts in reps` (muted).
- **Dots** (14px for high-volume, 12px, 10px dimmed for the two n=2 players), with
  `box-shadow:0 0 0 3px {soft}` halos: Matt (95%, 47% → amber, BR), Conor (49%, 60% → moss,
  TR), Jensen (41%, 29% → ember), Jon (34%, 0% → ember, BL), Clements & Steingart both at
  ~(22%, 50%) dimmed grey in the small-sample shade. Labels sit beside each dot.
- **Takeaway line** below reinforces: Conor alone in *sharp eye*; the 50%-ers quarantined.

### Tab 3 — "Carrot box"
- **Purpose:** who best throws the room off their scent (and — later — makes it cost votes).
- **Concept line** defines carrot boxing (misdirection in comments/chat so people misID your
  song and vote it down).
- **Two award cards side by side:** **The Ghost** (`.bs-acc-amber`, Steingart — vanishes by
  silence, 0/6 spotted) and **The Decoy** (`--sky` framed, Conor — easy to spot unless he
  plants a fake).
- **Decoy evidence pull-quote** (left border 3px `--sky`, `--ink-1` fill): the real Johnny
  Cash submission comment written from someone else's POV with Conor's **own name
  misspelled** ("Connor"), + a caption. **Flagged "needs a comment-flag field in the feed"**
  — see Data dependencies.
- **Throw-off bars:** per submitter, bar length = times misidentified (real). A **hatched
  inner segment = the throw-off "landed" (they also voted it down)** — **illustrative only**,
  labelled as needing the ballot join.
- **Two confusion motifs** ("why the throws land"), hand-placed SVG:
  1. *The interchangeables* — Paletz at a hub with two 7px pulp arcs to Steingart and
     Clements, each labelled `4×`. Caption notes all three barely post in chat.
  2. *The default guess* — 8 thin pulp lines converging on a big Conor node (`8×`). Caption
     clarifies this is Conor's name blurted on **others'** songs (distinct from the Targets
     tab's "how often his own songs get pegged").

### Tab 4 — "Targets"
- **Purpose:** how identifiable each player is — the inverse of guessing skill.
- **Layout:** headline question → "Being guessed." sub-line → **9 rows** sorted
  anonymous-first. Each row: name (66px, `--font-display` 700 13px) → a meter track
  (`--surface-2`, 9px, radius 5px) filled to the spot-rate % in ember (<34) / amber (34–59)
  / moss (≥60), with `mistaken for {name}` under it → right: `{rate}%` + `{c}/{t}` mono.
- Matt is omitted (only 2 of his songs were ever guessed at — noted in the footer).

---

## Interactions & Behavior
- **Tabs:** four top-level tabs, first ("By player") default. In the prototype these are
  CSS `:checked` radio tabs (no JS). **In the digest, the section is exported as a static
  PNG** (`renderDigestSectionPngs()`), which captures only the default tab. See D5 below —
  for export the four panels should **stack vertically** rather than hide behind tabs.
- **Tooltips:** detail-on-demand is the native `title` attribute only (the digest house
  rule — degrades to nothing in print, never to a broken control). Every ▶ and ⊙ pip has a
  `title`. No custom popovers.
- **No hover/loading/error states** beyond `title`; server-rendered, no client fetch.
- **Empty states:** italic parentheticals in `--fg-quiet` (e.g. `didn't play`,
  `no one's guessed at you yet`), matching the section's existing convention. The whole
  section self-hides when there's no data.

## State Management
None client-side (server-rendered). The only interactive state is the active tab (local UI
toggle). Everything is available at render time from `getGuesserData(db, roundId)`.

## Design Tokens (all from `colors_and_type.css`)
- **Backgrounds:** `--ink-0` `#07090c` · `--ink-1` `#0d1116` · `--ink-2` `#141921`.
- **Lines:** `--line` `#283039` · `--line-strong` `#3a4451`.
- **Text:** `--fg` `#f1f4f7` · `--fg-2` `#c2cad3` · `--fg-muted` `#8b97a4` · `--fg-quiet` `#5a6773`.
- **Accent / status:** `--mash-pulp` `#ff5b2e` (+ `-deep` `#d94c23`, `-edge` `#8a2d15`,
  `-soft` `#ff5b2e22`) · `--moss` `#3ec27a` / `--moss-soft` `#1d3a2a` · `--amber` `#e8a83a`
  / `--amber-soft` `#3a2e15` · `--ember` `#e6566c` / `--ember-soft` `#3b1a22` · `--sky`
  `#5aa3ff` / `--sky-soft` `#16263f` · `--bone` `#faf7f2`.
- **Type:** `--font-display` (Bricolage Grotesque, headings/names) · `--font-body`
  (Inter Tight) · `--font-mono` (JetBrains Mono, figures/labels; always `tabular-nums`).
  Sizes used: 23px title, 16–17px motif headlines, 13–14px names, 11–12.5px body,
  9–10px figures, 7.5–9px micro-labels (`.12–.16em` tracking, uppercase).
- **Radius:** cards `--r-4`/10px · pips full · meters 5px.
- **One derived value:** Steingart identity hue `#a98bff` (not a token — flag above).

## Assets
No images or icon fonts. All marks are CSS/SVG. Glyphs used: `◆` (zine stamp / award / note
marker), `▶` `⊙` (mode markers), `✓` `✗` (tooltip text), `→`/`↑` (axis captions). The `◆`
zine stamp and the "single-player ledger ↑ unchanged" stub reuse the existing section chrome.

## Data contract
Built entirely from `getGuesserData(db, roundId).seasonGrid` (`rounds[]`, `rows[]` with
`cells[]` and `guesses[]`), exactly as in `data/guesser-viz-data.json` → `live_round150`.
`thin_earlySeason` in that file is the sparse early-season state to test against.
Derived structures the tabs need (all computable from `seasonGrid.rows[].guesses`):
- **Per-target incoming guesses** (Tab 1 ⊙ row, Tab 4): group every `guesses[]` entry by
  `actualName`, tagging the guesser = the row it came from.
- **Confusion pairs** (Tab 3 motif 1): unordered `{guessed, actual}` counts on wrong guesses.
- **"Default guess" count** (Tab 3 motif 2): count of wrong guesses per `guessedName`.
- **Throw-off count** (Tab 3 bars): per `actualName`, wrong guesses aimed at them.

---

## Decision log
- **D1 — primary encoding:** not one chart but a **four-tab panel** consolidating the
  encodings that survived review — By-player small-multiples (default), the Field quadrant,
  Carrot box, and Targets. Rejected: single-bar-only and pure editorial board (kept as
  exploration).
- **D2 — stop small samples lying:** solved three ways at once — the Field **small-sample
  shade** boxes the two n=2 players; By-player shows a bare `1/2` with **no %** under 3
  attempts; every count is visible beside every rate.
- **D3 — absence:** **full roster.** All ten players get a By-player card; never-guessers
  are `didn't play` on ▶ but still carry a ⊙ story. The four-man silence lands as a finding.
- **D4 — round axis:** **kept, per player,** as the 8-pip ▶ row (shows Matt's 3→3→5→7 arc)
  rather than a shared matrix of mostly-empty cells.
- **D5 — static vs interactive:** interactive tabs for web; **for the export PNG the four
  panels stack vertically** (not yet built — see next steps). Tooltips are `title`-only so
  they vanish cleanly in the flatten.
- **D6 — the guesser/guessee axis:** the added decision. Every view is explicitly labelled
  and encoded as *guessing* (bright/solid) or *being guessed* (pastel + guesser-coloured
  ring), so the two "Conor" numbers can't be read as contradictory.

## Data dependencies & follow-ups (noted for CC)
1. **Comment-flag field — required to make the Decoy real.** The Carrot-box decoy detection
   is currently **hand-flagged** (the JC pull-quote is authored, not computed). Add a
   per-submission boolean + the quote — the existing `guesser_content_json.gridNotes`
   override mechanism (keyed `"<playerId>:<roundId>"`) is the natural home. Until then the
   Decoy card and pull-quote are curated, like the `1/∞` cell.
2. **Ballot join — required to make "landed" real.** The hatched bar segment ("threw them
   off AND they voted it down") is **illustrative**. Computing it needs each guess joined to
   that guesser's ballot score for the song. Until the join exists, render the throw-off bars
   only (real) and drop or clearly-mark the hatched overlay.
3. **Chat-frequency signal — v2 idea, not in v1.** The passive carrot-boxers (Steingart,
   Paletz, Clements) vanish largely because they **post the least in WhatsApp**, giving the
   room fewer tells — the inverse of Conor's active decoys. If per-player chat-message counts
   become available, a "clues given" measure would let the Ghost/Decoy split be computed
   rather than judged. Explicitly **out of scope for v1.**

## Files
- `design/Guesser Season Panel.dc.html` — the design (four tabs).
- `design/Guesser Viz Options (explorations).dc.html` — the review option canvas.
- `data/guesser-viz-data.json` — real R150 + thin early-season data.
- `reference/guesser-viz-brief.md` — original brief.
- `visuals/01-by-player.png` · `02-field.png` · `03-carrot-box.png` · `04-targets.png`.
- `KICKOFF-PROMPT.md` — paste-in prompt to start the CC implementation.
