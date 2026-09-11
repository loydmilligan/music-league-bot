# Feature Design Brief *(existing repo)*

> **For:** Claude Designer (CD) · **Written by:** Claude Code (CC) · **Product:** Music League Bot — the weekly digest
> **Feature:** "Guess the Submitter" — a season-scale visualisation of who guesses, how often, and how well
> **Date:** 2026-09-10 · **Brief version:** 1
> **Repo (local checkout):** `/home/loydmilligan/Projects/music-league-bot`

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

- **Product:** A private weekly digest for a 10-person Music League (Boarz II Men) — a long,
  scrolling, dark, zine-flavoured recap of each round, generated from real vote and chat data
  and hand-punched-up before it's shared to the group's WhatsApp.
- **The feature, in one sentence:** Replace the Guesser section's plain season table with a
  visualisation that makes the whole room's guessing legible at a glance — who plays, how
  often, and how well — without letting a 100%-on-one-guess outrank a 47%-on-38.
- **Why now:** The section historically showed **one** player (Matt, the self-appointed
  Guesser). It was just widened to the whole league and the data turned out to be more
  interesting than expected — Conor guesses a quarter as often as Matt and hits more. The
  current presentation is an honest table, but it is a table.
- **Who reviews / decides:** Matt Mariani (owner, commissioner, sole reviewer).
- **Deadline / milestone:** None. R150 has already shipped with the table version; this is
  for R151 onward.

---

## 2. Repo orientation

- **What the codebase is:** SvelteKit 2 / **Svelte 5 (runes:** `$state`, `$derived`,
  `$derived.by`**)**, TypeScript, better-sqlite3. The admin+digest UI lives in `ui/`. A
  separate production app, **b/side**, lives in `bside/` and is the source of the design
  system. Not a monorepo tool — two apps in one repo.
- **How to run / view it:** `cd ui && npm run dev` (port 5173). ⚠️ **The digest page crashes
  under `npm run dev`** (a `node:crypto` import via `llm.ts` breaks hydration) — verify the
  digest with a **production build** instead: `npm run build`, or hit the running container at
  `http://localhost:3002/digest/150`. Add `?export=1` to see the static export rendering.
- **Key directories:**
  - `ui/src/routes/digest/[roundId]/+page.svelte` — the digest page; assembles all sections
  - `ui/src/lib/digest/` — every digest section component + `digest.css`
  - `ui/src/lib/db/guesserInsights.ts` — **all** the data for this feature
  - `ui/src/lib/shortlist/colors_and_type.css` — the token source of truth
  - `.design-sync/` — the synced CD project bundle

### 2a. Design system, as implemented

- **System in use:** **Music League — Current System** — a live, styles-only CD project.
  - **CD project id:** `29b5b2e4-906a-4e5b-ad92-8e2ccab617e1`
  - It mirrors what the production b/side app actually ships, and is **dark-first**, built on
    the **Mash Co.** brand (the "pulp" orange accent). Per its own README: *"Design against
    these real tokens and classes so every screen maps 1:1 onto code the engineers already
    have."*
  - There is **no React component bundle** — it is a **CSS-class + token vocabulary**. Build
    your own markup, apply the real `.bs-*` classes, and use `--*` tokens for anything custom.
    Never hard-code a hex, size, radius or duration.
- **Where tokens live:** `ui/src/lib/shortlist/colors_and_type.css` (mirrored into the CD
  project as `colors_and_type.css`).
- **Component library location & inventory:** `.bs-*` classes in `dashboard-styles.css`
  (from `bside/src`). The digest's own vocabulary is `.dg-*` in
  `ui/src/lib/digest/digest.css` (2,195 lines), and each section component carries scoped
  styles of its own.
- **Icon set / illustration system:** None. The digest uses text, emoji glyphs, and
  hand-placed imagery in `digests/_media/`. No icon font, no SVG icon set.
- **Fonts in use:** **Bricolage Grotesque** (`--font-display`), **Inter Tight**
  (`--font-body`), **JetBrains Mono** (`--font-mono`). Loaded by `@import` inside
  `colors_and_type.css` — no extra setup.

> ⚠️ **Honesty note — the synced system does NOT contain this feature's current styles.**
> The Guesser's markup and CSS live in the component's own scoped `<style>` block
> (`ui/src/lib/digest/GuesserLeaderboard.svelte`, ~700 lines, `.gsl-*` prefix). Neither
> `.design-sync/bundle/surfaces/digest/digest.css` nor the repo's `digest.css` contains any
> `gsl-*` rule. The synced `digest.css` is also **stale** relative to the repo. CD should read
> the component file directly, not rely on the bundle for this surface.

### 2b. Existing visual & interaction vocabulary

**Colour (actual values, all from `colors_and_type.css`):**

| Token | Value | Use |
|---|---|---|
| `--ink-0` / `--bg` | `#07090c` | page background |
| `--ink-1` / `--surface` | `#0d1116` | panel |
| `--ink-2` / `--surface-2` | `#141921` | card |
| `--line` | `#283039` | hairline |
| `--fg` | `#f1f4f7` | bright text |
| `--fg-2` | `#c2cad3` | body |
| `--fg-muted` | `#8b97a4` | secondary |
| `--fg-quiet` | `#5a6773` | faint |
| `--mash-pulp` | `#ff5b2e` | brand accent — the orange |
| `--moss` | `#3ec27a` | good / up |
| `--amber` | `#e8a83a` | featured / warning |
| `--ember` | `#e6566c` | bad / down / divisive |
| `--sky` | `#5aa3ff` | analytical |

**Accent flavours:** wrap a component in `.bs-acc-pulp` `.bs-acc-amber` `.bs-acc-sky`
`.bs-acc-moss` `.bs-acc-ember` to set local `--acc` / `--acc-2` / `--acc-soft`. Semantics
are fixed: **pulp**=brand, **amber**=featured, **sky**=analytical, **moss**=good/up,
**ember**=bad/down.

**Type scale:** `--fs-xs` 12 · `--fs-sm` 13 · `--fs-md` 15 (base) · `--fs-lg` 17 ·
`--fs-xl` 20 · `--fs-2xl` 26 · `--fs-3xl` 34 · `--fs-4xl` 46 · `--fs-5xl` 62 · `--fs-6xl` 84.
Weights 400–800. `--tracking-caps: 0.08em` for all-caps eyebrows.

**Spacing / radius:** `--s-1` 4px → `--s-11` 96px. `--r-1` 4 → `--r-6` 20, `--r-full` pill.

**Density in this section, as built:** very tight. Grid body text is 12px with
`font-variant-numeric: tabular-nums`; column headers are 10px uppercase at `0.04em`; the
archetype labels in the neighbouring Regulars section are 12px mono uppercase at `0.1em`.
The digest reads as a dense zine page, not an airy dashboard.

**Signature components & behaviour:**
- `DigestSection` shell wraps every section; each renders inside `.dg-section-wrap` carrying
  `data-section-kind="…"`.
- `GuesserLeaderboard.svelte` currently renders, top to bottom: a "◆ back of the zine" stamp
  → a legend epigraph → this round's record + season average → season hit-rate sparkbars with
  a dashed average line → a play-order strip with landmark annotations mined from real vote
  comments → "eludes him" + "littermates" mini-cards → **the new season grid**.
- Sibling sections for tone: `StorylinesCast.svelte` (the Regulars), `DigestInsights.svelte`
  (stats + the Coinage dictionary card), `ChatMoments.svelte`.

**Interaction patterns:** the digest is **almost entirely non-interactive by design**. The
established affordance for detail-on-demand is a **native `title` tooltip** — no JS, no
popover. The component's own comment says it "degrades to nothing in print rather than to a
broken control."

**Tone of UI copy** (real strings from this section): *"eludes him"* · *"players he's guessed
the most times and **never once** gotten right — all season"* · *"littermates"* · *"the two
players he most often **mixes up for each other**"* · *"everyone who has ever guessed"* ·
*"never once guessed, all season:"* · *"this round · by play order"*. Lower-case, dry,
declarative, slightly arch. Never chirpy, never instructional.

**Established states:** no loading state (server-rendered). Empty states are plain italic
parentheticals in `--fg-quiet`: *"(nobody's fully eluded him yet)"*, *"(no recurring mix-up
this season)"*. The whole section self-hides when there's no data.

### 2c. Current information architecture

- **Top-level:** the digest is one long vertical scroll of independent sections. Order is
  data-driven; for R150 it runs podium → guesser → villain → regulars → flow → stats →
  consensus → chat → quotes → standings → discoverability → next round.
- **Where the user is:** reading the weekly recap, on a phone, in or just after the WhatsApp
  thread where the digest link was posted.

---

## 3. The feature — what & why

- **What it does:** Shows every player's guessing across the season — volume and accuracy
  together — in one visual, replacing (or absorbing) the current table.
- **Core user value:** Settles an argument the group actually has. The league's designated
  Guesser is being out-shot by someone who barely plays, and four people have never guessed
  once. Right now you have to read a grid of fractions to see that.
- **The one outcome it must deliver:** A reader glancing for three seconds should come away
  knowing **who the serious guessers are and who is actually good** — and should not be able
  to mistake a 1-for-1 for a good record.
- **Scope:**

| In scope | Explicitly out | Later |
|---|---|---|
| The season-scale, all-players visual | Redesigning the rest of the Guesser section (sparkbars, play-order strip, eludes/littermates) | Cross-league version (Second Best, sssc) |
| How it degrades in the static PNG export | The single-player weekly ledger above it | Animated/interactive web-only version |
| Phone rendering at ~400px | Changing what counts as a "guess" (the matcher) | Per-player drill-down pages |

---

## 4. Where it lives — touchpoints & entry points

- **Screens it touches:** one — the digest page,
  `ui/src/routes/digest/[roundId]/+page.svelte`, inside the synthetic `guesser` section.
- **New entry points:** none. It is not navigable; it appears in the scroll.
- **How it fits the IA:** it is the **last block** inside the existing Guesser section, after
  the single-player material. It must read as the section widening from one person to the
  room, not as a separate feature.
- **What it must not disrupt:** the section's export path. `renderDigestSectionPngs()`
  (`ui/src/lib/digest/export.ts:152`) screenshots each `.dg-section-wrap` by kind — the
  Guesser already exports as a standalone shareable PNG (1284 × 4548 for R150) and that
  must keep working.

---

## 5. Users & jobs for this feature

- **Who uses it:** ten players in a private league, all men who have known each other for
  years. One of them (Matt) also builds the product.
- **Jobs-to-be-done:**
  1. *"Am I good at this?"* — find myself, see my record.
  2. *"Who's actually good?"* — compare across the room fairly.
  3. *"Is Matt really the Guesser?"* — test the section's own premise.
  4. *"Show the group"* — screenshot one block into WhatsApp as an argument-ender.
- **Frequency & context:** once a week, on a phone, in a group chat, slightly drunk, for
  about fifteen seconds unless something is surprising.
- **What they do today instead:** read the fractions in the grid, or argue from memory.

---

## 6. Ideas to flesh out

> The team did **not** prescribe an approach — the ask is explicitly *"several options for how
> we might use the data to create a stunning and understandable visual."* The four below are
> **CC-proposed starting points**, not team mandates. CD should feel free to discard any of
> them for something better.

### Idea A — Volume × accuracy plot *(proposed by CC)*
- **The idea:** Two-axis plot — guesses made on one axis, hit rate on the other. Each player
  is a labelled mark.
- **Why it's interesting:** It is the only form where the small-sample problem solves itself
  visually. Conor sits high and far left; Matt lower and far right; Steingart's 100% sits at
  x=1 where it obviously means nothing.
- **Known constraints:** must be legible at ~400px with 6–10 labelled points, several of
  which collide near the origin. No hover to fall back on.
- **Open questions:** how to label without overlap; whether to draw a league-average line;
  whether never-guessed players appear at all.

### Idea B — Volume-as-length bars *(proposed by CC — currently shipped)*
- **The idea:** One horizontal bar per player; total length = guesses made, filled portion =
  hits. Already built inside the grid's season column.
- **Why it's interesting:** Encodes both variables in one mark with zero chart apparatus, and
  reads instantly.
- **Known constraints:** currently squeezed into a 27%-wide table cell.
- **Open questions:** does it deserve to be the main event rather than a column?

### Idea C — Small multiples *(proposed by CC)*
- **The idea:** A tiny per-player card or sparkline strip, one per person, in a grid.
- **Why it's interesting:** Handles sparsity gracefully — an empty card is a legitimate
  statement about a player, not a hole in a chart.
- **Open questions:** ten cards may be too much page for the payload.

### Idea D — Editorial scoreboard *(proposed by CC)*
- **The idea:** Abandon chart conventions; treat it as a zine-page standings board with type
  doing the ranking work and only small visual accents.
- **Why it's interesting:** Most native to the digest's actual voice, and the most likely to
  look designed rather than generated.
- **Open questions:** can it carry the volume-vs-accuracy nuance without a chart?

---

## 7. Open areas for CD to explore

### Open area 1 — How to render absence *(proposed by CC)*
- **What it is:** **Four of ten players have never guessed once** — Paletz, Grant, Jimmy,
  Shane. Currently they're a sentence under the table: *"never once guessed, all season:"*.
  Two rounds also have no guesses from anyone.
- **Why it's worth a look:** In this dataset absence is a finding, not missing data. A chart
  that simply omits them tells a different (wrong) story than one that shows four empty rows.
  This is the single most-likely-to-be-fumbled part of the design.
- **How it relates:** it determines whether the visual is "the guessers" or "the league".

### Open area 2 — The annotated outlier *(proposed by CC)*
- **What it is:** One cell is hand-authored rather than computed. In R149 Jensen guessed
  "Conor" on all nine songs in nine different spellings (`Conr?` · `Cnr?` · `Cronar?` · `C`),
  so the matcher can only see three of them. The cell is overridden to read **1/∞** with a
  footnote.
- **Why it's worth a look:** the system needs a way for a human-written cell to sit
  legitimately beside computed ones without looking like a bug — and the footnote currently
  dangles below the table with no visual tie to its cell.
- **How it relates:** it will recur. The override mechanism
  (`guesser_content_json.gridNotes`, keyed `"<playerId>:<roundId>"`) is built and will be
  used again.

---

## 8. Existing patterns to honor / reuse

- **Reuse as-is:** the `DigestSection` shell and its `.dg-section-wrap` /
  `data-section-kind` contract (the export depends on it); the section's existing header,
  legend epigraph and sub-head; `--font-mono` + `tabular-nums` for all figures.
- **Patterns to follow:** accent semantics are **fixed** — `--moss` for hits, `--ember` for
  misses/zero-for, `--mash-pulp` for brand emphasis only. Lower-case dry copy. Detail-on-
  demand via native `title`, never a custom popover.
- **May extend with care:** the `.gsl-*` scoped stylesheet inside
  `GuesserLeaderboard.svelte`; the grid's data shape (`GuesserGrid` in
  `guesserInsights.ts`) if a new encoding needs another field.
- **Do NOT touch:** the matcher and what counts as a guess (`guessResolver.ts`); the
  single-player weekly ledger above; the export pipeline; any token values.

---

## 9. Decision points to game out ⭐

---

### D1. What is the primary encoding? · **[Required — from team]**

- **The decision:** Which visual form carries the headline — plot (A), bars (B), small
  multiples (C), or editorial board (D)?
- **Why it matters:** Everything else follows. It also decides whether this reads as a
  *chart* inside a zine, or as *page furniture* that happens to be quantitative — and the
  digest has so far contained no charts at all.
- **Options on the table:** the four in §6, plus anything CD prefers.
- **Constraints:** dark only; ~400px phone width; no hover in the exported PNG; 6 populated
  rows and 4 empty ones; most populated rows have 1–2 data points.
- **What CD should put on the canvas:** 3–4 options, each shown **in context** — inside the
  real digest page, directly under the existing single-player ledger, at phone width. An
  out-of-context chart will mislead here, because the surrounding page is very dense and very
  dark.
- **How we'll decide:** which one makes "Conor is better than Matt, on a quarter of the
  attempts" obvious in three seconds.

---

### D2. How do we stop small samples from lying? · **[Required — from team]**

- **The decision:** What visual device prevents 1/1 = 100% from outranking 18/38 = 47%?
- **Why it matters:** This is the feature's core honesty problem. Two players sit at 100% and
  50% on a single guess each; the section's premise (that Matt is *the* Guesser) is only
  testable if volume is visible alongside rate.
- **Options on the table:** encode volume as length/size/opacity; sort by volume rather than
  rate; a minimum-attempts threshold with the rest in a "not enough data" band; confidence
  bands; simply never showing a percentage below N attempts.
- **Constraints:** must work without interaction; must not imply statistical machinery the
  data can't support (n=38 is the *largest* sample here).
- **What CD should put on the canvas:** 2–3 treatments applied to the same real numbers, so
  they can be compared on the actual distribution rather than on dummy data.
- **How we'll decide:** show it to someone who hasn't seen the data and ask who's best.

---

### D3. How is absence rendered? · **[Proposed by CC]**

- **The decision:** Do never-guessed players appear as empty rows, a separate list, a
  footnote, or not at all?
- **Why it matters:** See §7 open area 1 — absence is a finding here. It also changes the
  visual's shape: 10 rows with 4 empty looks very different from 6 rows.
- **Options:** full roster with empty rows · guessers only + a named footnote (current) ·
  a two-band layout (played / never played) · ghosted rows at low opacity.
- **Constraints:** the copy convention for empties is an italic parenthetical in
  `--fg-quiet`; don't invent a heavier empty-state pattern.
- **What CD should put on the canvas:** the chosen primary encoding from D1 shown twice —
  once roster-complete, once guessers-only — so the difference in *story* is visible.
- **How we'll decide:** does the four-man silence land as a joke, or as a rendering bug?

---

### D4. Does the round axis stay? · **[Proposed by CC]**

- **The decision:** Keep a per-round breakdown (8 columns, currently numbered 1–8) or
  collapse to season totals only?
- **Why it matters:** The per-round grid is where the sparsity is worst — most cells are
  empty dots — but it's also the only place trend is visible (Matt: 3/9 → 3/9 → 5/9 → 7/9,
  a real improvement arc).
- **Options:** keep the full matrix · season totals only · totals + a per-player sparkline ·
  a small-multiple strip per player.
- **Constraints:** round columns must **not** be labelled with round ids (135, 145, 148…) —
  they're meaningless to readers and were a live bug; they're now sequential 1–N.
- **What CD should put on the canvas:** the matrix and the collapsed form side by side at
  phone width, using the real (sparse) data.
- **How we'll decide:** is Matt's improvement arc worth the empty cells?

---

### D5. Static-first, or interactive with a static fallback? · **[Proposed by CC]**

- **The decision:** Is this designed as a static image that happens to live on a web page, or
  as a web component that degrades for export?
- **Why it matters:** The section is regularly exported as a standalone PNG and shared to
  WhatsApp — that's a primary use, not an edge case. The current hover history is invisible
  in that PNG by design.
- **Options:** static-first (everything on the surface) · layered (static reads fully, hover
  adds detail — current approach) · two distinct treatments for web and export.
- **Constraints:** export is a Puppeteer screenshot at `?export=1`; no JS interaction is
  captured; the digest's house rule is that interactivity must degrade to *nothing*, never to
  a broken control.
- **What CD should put on the canvas:** the chosen design rendered as it appears on the web
  **and** as the flattened PNG.
- **How we'll decide:** does the PNG alone still answer "who's actually good?"

---

### D6. *(open stub — CD to top up)*

---

## 10. Constraints

- **Technical:** Svelte 5 runes; scoped `<style>` per component; **no charting library is
  installed** and adding one is undesirable — assume hand-rolled SVG/CSS. Server-rendered,
  so all data is available at render time. The export is a real browser screenshot, so
  webfonts and CSS work but JS interaction does not.
- **Brand & consistency:** must read as the same page as the sections above and below it.
  Tokens only — no new hexes. Accent semantics are fixed (moss=good, ember=bad, pulp=brand).
- **Accessibility bar:** *(unknown — needs decision)* Nothing formal is documented. The
  practical floor: legible at 400px, and **colour must not be the only channel** — the
  current grid pairs red with the literal string "0/1".
- **Risks / past problems:** this section has a history of small correctness bugs that
  design can help prevent — columns once labelled with meaningless round ids; red once
  applied to *successes* rather than failures; a percentage shown for a one-guess sample.
  A design that makes the underlying quantity obvious is doing correctness work too.

---

## 11. Success criteria

- **How we'll judge it:** a reader who has never seen it can answer "who is the best guesser,
  and who just got lucky once?" in one glance, on a phone, without a legend.
- **Metrics it should move:** none instrumented — this is a private digest with ten readers
  and no analytics. Judgement is the owner's, plus whether the block gets screenshotted into
  the group chat on its own.
- **What "fits the product" means:** if it were dropped between the Regulars and the villain
  section with no heading, a reader should not be able to tell it was designed separately.

---

## 12. Deliverables & logistics

- **Fidelity expected:** high — this is the visual centrepiece of the section.
- **Variations wanted:** phone (~400px) and the wide/export rendering; the populated state
  and the thin-data state (an early-season round where only one or two people have guessed).
- **Deliverable format:** handoff packet per `Handoff-Packet-Manifest.md` + a kickoff prompt
  for CC.
- **Review cadence:** single reviewer, async, fast.

---

## 13. Open questions & unknowns

- **Scope ambition — conservative first pass or comprehensive build?** *(unknown — needs
  decision)* The ask says "stunning", which points comprehensive, but the underlying data is
  still settling (the matcher gained three aliases and a false-positive fix today). CC's
  instinct: **design comprehensively, ship the simplest option that survives D2.**
- **Does this replace the grid or sit alongside it?** *(unknown — needs decision)* The table
  is accurate and dense; a chart may complement rather than replace it.
- **Should the single-player ledger above be re-thought at the same time?** Marked out of
  scope (§3), but the two now overlap in what they say. *(assumption: keep them separate for
  this pass.)*
- **Accessibility bar** — see §10.
- **Cross-league reuse** — Second Best and sssc have the same data shape but different
  rosters and much more history. *(assumption: design for Boarz, don't over-generalise.)*

---

## Appendix — file map & references

- **Design tokens:** `ui/src/lib/shortlist/colors_and_type.css` · synced to CD project
  `29b5b2e4-906a-4e5b-ad92-8e2ccab617e1` ("Music League — Current System")
- **Design system bundle:** `.design-sync/bundle/` (`README.md` = conventions header,
  `styles.css` = entry, `dashboard-styles.css` = `.bs-*` classes). ⚠️ its
  `surfaces/digest/digest.css` is stale and contains no `gsl-*` rules.
- **Component library:** `ui/src/lib/digest/` — notably `GuesserLeaderboard.svelte` (this
  feature), `StorylinesCast.svelte`, `DigestInsights.svelte`, `ChatMoments.svelte`,
  `digest.css`
- **Screens the feature touches:** `ui/src/routes/digest/[roundId]/+page.svelte`
- **Data contract:** `ui/src/lib/db/guesserInsights.ts` — `GuesserData`, `GuesserGrid`,
  `GuesserGridRow`, `GuesserGridCell`, `GuesserGridGuess`
- **Export pipeline:** `ui/src/lib/digest/export.ts:152` (`renderDigestSectionPngs`)
- **A rendered example of today's version:** `r150-guess-the-submitter.png` (repo root,
  1284 × 4548)

### 📎 Mockup data — `design/guesser-viz-data.json`

**Build every mockup against this file, not against invented numbers.** The sparsity is the
design problem; dummy data hides it. It contains:

| key | what it is |
|---|---|
| `_shape` | field-by-field explanation of the contract |
| `_states` | which blocks are real and which is derived |
| `_knownIssue` | a scoping bug in the data, described below |
| `live_round150` | **the real, current state** — the full `getGuesserData()` output: 10 players, 8 rounds, 6 populated rows, 4 never-guessed, and the one hand-authored `1/∞` cell with its footnote |
| `thin_earlySeason` | **synthetic** — the same real data truncated to the first 3 rounds, to exercise the early-season state (Conor 2/3, Clements 1/1, Matt 0/2, Jon 0/2, everyone else empty). Derived, not observed; labelled as such in the file. |

⚠️ **Known issue, unfixed:** `seasonGrid` is computed over the whole league regardless of
which round is being viewed, so an older digest currently renders rounds that hadn't happened
when it was published — R148 and R150 return an identical grid. Design need not solve this,
but don't assume the grid is era-scoped.

### The data CD has to work with

From `getGuesserData(db, roundId)`:

| Field | Shape | Notes |
|---|---|---|
| `weekly` | `{ attempts, correct, rate, guesses[] }` | this round, one player; each guess has song title, play position, guessed vs actual name, correct, and the raw vote comment |
| `byThird` | `{ first, middle, last }` | accuracy by play-order third |
| `seasonHitRates[]` | `{ roundId, label, correct, attempts, rate }` | one player's arc, last 10 rounds |
| `seasonRate`, `seasonRoundCount` | numbers | |
| `roster[]` | `{ playerId, name, attempts, correct, rate, thisRound, songs[] }` | how often the Guesser guesses *each* other player |
| `eludesHim[]`, `alwaysNails[]` | roster rows | |
| `littermates` | `{ aName, bName, swaps }` | the pair most often mixed up |
| **`seasonGrid`** | `{ rounds[], rows[] }` | **the feature's data.** `rounds` = `{roundId, label}` in chronological order, labelled 1..N. Each row = `{playerId, name, attempts, correct, cells[], guesses[]}`; `cells[i]` is `null` or `{roundId, attempts, correct, display, note}`; `guesses[]` is every guess with round label, guessed name, actual name, correct |

**Real R150 values** (verified today — use these, not dummy data):

| player | season | per-round (1–8) |
|---|---|---|
| Matt Mariani | 18/38 · 47% | · , 0/1, 0/1, · , 3/9, 3/9, 5/9, 7/9 |
| Conor Johnston | 6/10 · 60% | · , 1/1, 1/2, · , · , 1/1, 1/2, 2/4 |
| Dave Jensen | 2/7 · 29% | · , · , · , · , · , **1/∞**, 1/4, · |
| Jon Black | 0/5 · 0% | · , 0/1, 0/1, 0/1, · , 0/1, · , 0/1 |
| Clements Johnson | 1/2 · 50% | 1/1, · , · , 0/1, · , · , · , · |
| Dave Steingart | 1/2 · 50% | · , · , · , · , 0/1, · , · , 1/1 |
| Darren Paletz, Grant Koziol, Jimmy, Shane Farkas | 0/0 | never guessed, all season |
