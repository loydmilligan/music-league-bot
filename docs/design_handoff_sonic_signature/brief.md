# Feature Design Brief *(existing repo)*

> **For:** Claude Designer (CD) · **Written by:** Claude Code (CC) · **Product:** *the b/side* — a player-facing Music League companion dashboard
> **Feature:** Sonic Signature — a data-driven, shareable taste fingerprint · **Date:** 2026-06-30 · **Brief version:** 1
> **Repo (local checkout):** `/home/loydmilligan/Projects/music-league-bot` (the player-facing app is in `bside/`)

---

## 0. How CD will use this brief *(fixed — do not edit)*

CD will: (1) read this brief and load/observe the design system as it's actually
implemented; (2) confirm and, if needed, top up the decision points to 4–6 total;
(3) build a pannable **canvas** of options with visual aids — both for the ideas you named
and for the open areas CD is invited to explore; (4) iterate in chat to settle each
decision; (5) produce the **full design** for the feature, fitted to the existing product;
(6) write a process summary and decision log; (7) assemble a **handoff packet** (see
`Handoff-Packet-Manifest.md`); (8) return a **kickoff prompt** for CC to implement.

> **⭐ The immediate ask for this brief is narrower than the full feature.** We are at the
> *option-canvas* stage. The single most valuable thing CD can return is **four realized,
> native-to-b/side visual treatments of the Sonic Signature** — one per form factor in §6
> (Radar, Sigil/Bloom, Trading Card, DNA Strip) — each rendered with the real sample data in
> §3a, at two sizes (in-app hero + 264px sharecard), so the team can pick a direction. The
> rest of the brief is context so those four come back coherent and buildable, not generic.

---

## 1. Product & feature snapshot

- **Product:** *the b/side* — a no-login, mobile-first SvelteKit dashboard that turns a private
  family Music League's data (submissions, votes, chat, results) into a browsable, shareable
  season story. Lives in `bside/`; renders from a static `read_model.json`.
- **The feature, in one sentence:** Replace the current LLM-narrative "Taste fingerprint" with a
  **Sonic Signature** — a *measured*, visual taste fingerprint computed directly from each
  player's song metadata, designed to be screenshot-shared and argued about.
- **Why now:** The team has painstakingly captured per-song metadata (audio features, popularity,
  genre tags, lyrics) that currently powers almost nothing player-facing. The fingerprint today is
  an AI *read*, not a *measurement*. Turning the hard data into a unique-per-person visual is the
  unlock — objective, comparable, and inherently shareable. The update is meant to *land as an
  event* people react to.
- **Who reviews / decides:** the project owner (single decision-maker).
- **Deadline / milestone, if any:** none hard; this is exploratory design to choose a direction.

---

## 2. Repo orientation  *(filled from the local checkout)*

- **What the codebase is:** SvelteKit (Svelte 5). The player-facing app is a **separate, minimal
  package** at `bside/` (Svelte 5.55, Vite 8, TS 6 — no charting deps). A larger admin/research
  app + digest pipeline lives in `ui/`, but **this feature ships in `bside/`.**
- **How to run / view it:** `cd bside && npm run dev`. Key screens are plain route components in
  `bside/src/routes/`. The app fetches `read_model.json` once on mount and parses the pathname to
  switch screens; no auth.
- **Key directories CD should know about:**
  - `bside/src/colors_and_type.css` — **all design tokens** (color, type, spacing, radius, shadow, motion).
  - `bside/src/dashboard-styles.css` — the `.bs-*` component classes (cards, chips, spectrum, sharecard, etc.).
  - `bside/src/routes/ProfileScreen.svelte` — **where the current fingerprint lives** (lines ~111–182).
  - `bside/src/lib/atoms/ShareOverlay.svelte` — the screenshot-share modal + 264px sharecard.
  - `bside/src/lib/atoms/Avatar.svelte` — monogram/avatar circles.
  - `bside/src/lib/icons.ts` — inline-SVG icon set, used via `{@html icons.name}`.

### 2a. Design system, as implemented

- **System in use:** **Mashco** (the "Mash Co." pulp brand), implemented dark-first in `bside`.
  Documented below *as actually coded* — implemented reality wins.
- **Where tokens live:** `bside/src/colors_and_type.css` (`:root` custom properties + semantic type
  classes); component classes in `bside/src/dashboard-styles.css`.
- **Component library location & inventory:** CSS classes prefixed `.bs-` in `dashboard-styles.css`
  (see §2b and §8). Two Svelte atoms: `Avatar.svelte`, `ShareOverlay.svelte`.
- **Icon set / illustration system:** inline SVG strings in `bside/src/lib/icons.ts` (trophy, heart,
  spark, bolt, crown, star, thumbU/thumbD…). Color via `currentColor`. **No illustration system.**
- **Fonts in use:** **Bricolage Grotesque** (display/headlines), **Inter Tight** (body),
  **JetBrains Mono** (UI labels/eyebrows) — all via Google Fonts CDN.

### 2b. Existing visual & interaction vocabulary

- **Color palette (actual values):** Dark-first.
  - Backgrounds: `--ink-0 #07090c` (page) · `--ink-1 #0d1116` (panel) · `--ink-2 #141921` (card) · `--ink-3 #1c232c` (hover).
  - Lines: `--ink-4 #283039` · `--ink-5 #3a4451`.
  - Text: `--fg #f1f4f7` · `--fg-2 #c2cad3` · `--fg-muted #8b97a4` · `--fg-quiet #5a6773`.
  - **Primary accent (pulp):** `--mash-pulp #ff5b2e`, deep `#d94c23`, soft `#ff5b2e22`, edge `#8a2d15`.
  - **5-flavor accent system** (use `--acc`, `--acc-2`, `--acc-soft` via a flavor class): pulp `#ff5b2e` ·
    amber `#e8a83a` · sky `#5aa3ff` · moss `#3ec27a` · ember `#e6566c`. Each has a lighter `-2` and an alpha `-soft`.
  - Status: moss = good/up, ember = bad/down/divisive, amber = warning/featured, sky = analytical/info.
- **Type scale & families:** display classes `.t-display-hero` (Bricolage 800/84px) → `.t-h2` (Bricolage
  600/34px); section titles use Bricolage 700 ~21px; body `.t-body` (Inter Tight 400/15px); labels/eyebrows
  use **JetBrains Mono**, 10–12px, uppercase, `0.08–0.14em` tracking.
- **Spacing / grid / density:** 4px base, 9-step scale `--s-1 4px … --s-11 96px`. Cards pad ~14–18px, gaps
  ~10–14px. **Dense, information-rich, mobile-first** (rail stacks above phone < 880px).
- **Radius:** `--r-2 6px` (chips/small) · `--r-4 10px` (cards) · `--r-5 14px` (panels) · `--r-6 20px`
  (modals/sharecard) · `--r-full 999px` (pills).
- **Shadow / depth:** subtle 1px inset highlight + dark drop (`--shadow-1/2/3`); a signature **pulp-extrude**
  (stacked offset edges) for the brand wordmark. Sharecard uses a dramatic `0 24px 60px rgba(0,0,0,.6)`.
- **Signature components & behavior:** accent-tinted cards with a 2px top border in the accent + a radial
  accent gradient in one corner; chips (pill, three variants: default, `--star` pulp-filled, `--soft` mono);
  the **`.bs-spectrum`** polarity slider (6px track, gradient fill, 14px pulp dot positioned by `left:%`);
  two-column **rewards/punishes** (moss vs ember tinted); horizontal **ribbon/reel** with masked edge-fade.
- **Interaction patterns:** hover lifts cards `translateY(-2/-3px)` with border/bg shifts; modal opens by
  setting a payload, closes on Escape / backdrop click; spring entrance `bs-pop` (360ms, `--ease-spring`
  `cubic-bezier(.34,1.56,.64,1)`); motion tokens `--dur-fast 120ms / --dur-base 200ms / --dur-slow 360ms`.
- **Tone of UI copy** *(real strings)*: eyebrow "Taste fingerprint"; title "What makes them tick"; sub
  "An AI read of their picks and votes."; subheads "Signature artists", "Sounds like", "Rewards",
  "Punishes"; share caption "Screenshot-ready · no login, no app link — just the award and the league name."
  Voice is **warm, punchy, a little cheeky**, lowercase mono labels, confident Bricolage headlines.
- **Established states:** **tier-gating** is the main conditional — `member.tier === 'full'` unlocks
  spectrum, rewards/punishes, overlap, playlist; **lite** shows only artists + "sounds like" with the note
  *"{name}'s full profile fills in as the season plays out."* That lite/teaser pattern is the model for our
  **low-coverage / low-confidence** state.

### 2c. Current information architecture

- **Top-level IA:** Home (league hero, KPIs, reel, players grid, archive) → **Profile** (per player) →
  Archive (digests by season). Navigation is pathname-based; scroll resets to top on route change.
- **Where the feature becomes relevant:** the **Profile screen**, in the "Taste fingerprint" section. The
  Sonic Signature **replaces/absorbs** that section as the profile's hero visual, and feeds a **sharecard**
  via the existing ShareOverlay.

---

## 3. The feature — what & why

- **What it does:** Computes a per-player **Sonic Signature** from captured song metadata across six axes
  (§3a), renders it as a distinctive visual on the Profile screen, and exposes it as a screenshot-shareable
  card. (Two sibling pieces — a **Relationships/heredity** view and an **Archetype** badge — are part of the
  larger concept and described in §7 as open areas, but the **Signature visual is the subject of this brief**.)
- **Core user value:** "Here is *my* sound, measured — a thing that is uniquely mine, that I can post and my
  family will argue about."
- **The one outcome it must deliver:** a signature that is **(a) visually distinctive per person** (two
  people look obviously different at a glance) and **(b) native to b/side** (reads as the same product, not a
  bolted-on chart widget).
- **Scope — in / out / later:**

| In scope (this brief) | Explicitly out | Later |
|---|---|---|
| 4 realized form-factor treatments of the solo Signature + 264px sharecard, on real sample data | The data pipeline / how axes are computed (CC handles) | Relationships/heredity surface (§7-1) |
| Graceful low-coverage / low-confidence state | The Archetype naming logic | Archetype badge integration (§7-2) |
| How it sits in the Profile screen IA | Changes to Home/Archive screens | Animated "reveal" when an update lands |

### 3a. The data — the six axes + sample players  *(CD: render the examples with THIS data)*

Each axis is a 0–100 value per player (poles below). ✓ = full data coverage now; ⏳ = audio-derived, coverage
currently ~30% and climbing via a backfill (so the design **must** handle missing audio axes — see D4).

| # | Axis | Low pole (0) | High pole (100) | Source | Coverage |
|---|---|---|---|---|---|
| 1 | **Obscurity** | Pop | Hipster | Last.fm popularity proxy | ✓ now |
| 2 | **Energy** | Chill | Hype | audio energy | ⏳ backfilling |
| 3 | **Mood** | Dark | Bright | major/minor ratio | ⏳ backfilling |
| 4 | **Tempo** | Slow | Fast | BPM | ⏳ backfilling |
| 5 | **Lyrical density** | Instrumental | Wordy | lyrics-present ratio | ✓ now |
| 6 | **Eclecticism** | One-lane | Omnivore | genre-tag entropy | ✓ now |

**Sample players** (use these exact numbers so the four treatments are comparable):

| Player | Obscurity | Energy | Mood | Tempo | Lyrical | Eclecticism | Vibe |
|---|---|---|---|---|---|---|---|
| **Dad (M.)** | 88 | 48 | 35 | 60 | 90 | 72 | obscure, wordy, a little dark — "the crate digger" |
| **Jules** | 22 | 80 | 78 | 70 | 85 | 30 | poppy, bright, high-energy, one lane — "the radio" |
| **River** *(Dad's kid)* | 74 | 70 | 45 | 66 | 40 | 80 | shares Dad's obscurity, but louder, more instrumental, omnivore |

> **Family heredity demo:** *Dad* and *River* are parent/child. The DNA-strip form factor (and ideally the
> radar) should show a **stacked/overlaid comparison** of these two — they overlap hard on Obscurity but
> diverge on Lyrical/Energy. This is the emotional hook of the whole concept ("did your taste come from your
> parent?"), so at least one form factor should demo it.

> **Low-coverage sample:** also render **one** treatment in the degraded state — e.g. *Jules* but with the
> three ⏳ audio axes (Energy/Mood/Tempo) **unknown** — so we can see how the visual + a confidence/coverage
> cue behave when audio hasn't backfilled yet.

---

## 4. Where it lives — touchpoints & entry points

- **Screen modified:** `bside/src/routes/ProfileScreen.svelte` — the Signature replaces/absorbs the existing
  "Taste fingerprint" block (the `.bs-spectrum` sliders especially are the closest current analog and may be
  retired or demoted in favor of the Signature visual).
- **New entry points:** a **share button** on the Signature (reuse `.bs-share-btn` / ShareOverlay) producing
  a 264px sharecard. Possibly a tap-to-expand for axis detail (reuse modal pattern).
- **How it fits IA:** stays inside Profile; becomes the **hero of that screen** above the existing awards /
  overlap / playlist sections.
- **What it must not disrupt:** tier-gating (lite vs full), the share flow, and the no-login static-render
  model (everything must render from `read_model.json`; no runtime API).

---

## 5. Users & jobs for this feature

- **Who uses it:** members of a **private family Music League** (~29 people across 4 leagues / 9 seasons),
  viewing on phones, often passing screenshots around in WhatsApp.
- **Jobs-to-be-done (priority):**
  1. "Show me *my* sound as a thing I instantly recognize as mine."
  2. "Give me something worth screenshotting / posting to the family chat."
  3. "Let me compare myself to a family member (twin? opposite? did I inherit it?)."
- **Frequency & context:** spikes when a season/round wraps and the update 'lands'; quick mobile glances.
- **What they do today instead:** read the LLM narrative fingerprint (chips + 3 spectrum sliders) — fine to
  read, nothing to *share* or *compare*.

---

## 6. Ideas to flesh out  *(the four form factors — render ALL of them)*

> CD: produce a **realized, native-to-b/side treatment of each**, on the §3a sample data, at **two sizes**:
> (1) **in-app hero** (full Profile-screen width, mobile ~360–390px content width) and (2) **264px
> sharecard** (matching `.bs-sharecard`). Use Mashco tokens and the accent system. These four ARE the canvas.

### Idea A — Radar / Spider
- **The idea:** classic 6-axis radar; the player's polygon plotted over a faint hex grid.
- **Why interested:** precise and **directly comparable** — overlay two polygons for the family demo.
- **Known constraints / behavior:** must be inline SVG (no chart lib); axis labels in mono; fill in the
  player's accent; degrade by collapsing missing axes toward center with a visible "unknown" cue.
- **Open questions:** does it feel too "corporate/dashboard" for b/side's warmth? Can labels stay legible at
  264px?

### Idea B — Generative Sigil / Bloom
- **The idea:** an organic **bloom/sigil** — six petals/spokes radiating from a core, petal length = axis
  value, hue = which trait. Abstract, unique-per-person, poster/tattoo-able.
- **Why interested:** maximum emotional pull and "that's *my* shape" identity; most novel.
- **Known constraints / behavior:** still deterministic from the 6 values (same input → same bloom). Needs a
  small legend or it's pretty-but-unreadable. Must look intentional in Mashco, not like generic gradient art.
- **Open questions:** how to keep it readable enough to compare two people? Does it survive shrinking to a
  sharecard?

### Idea C — Trading Card
- **The idea:** a collectible **card** framing the signature visual (radar or bloom) + the archetype name +
  top-2 stat chips + a **rarity** tier (how unusual this signature is vs the league).
- **Why interested:** screenshot-native, "collect the family," gamified.
- **Known constraints / behavior:** the card is a *frame* — it still needs one of A/B inside it, so treat
  this as "A or B, dressed as a card." Reuse `.bs-sharecard` proportions/voice.
- **Open questions:** does rarity read as fun or arbitrary? Is the card redundant with the existing sharecard?

### Idea D — DNA / Genome Strip
- **The idea:** a horizontal **barcode/genome strip** — bands whose height/color encode the axis pattern.
  The killer move: **stack a parent's strip over a child's to *see* inherited taste.**
- **Why interested:** leans all the way into the literal "fingerprint/DNA" metaphor; the family-heredity
  comparison is native to the form.
- **Known constraints / behavior:** needs a legend; must encode all six axes legibly; the stacked
  parent/child comparison (Dad vs River) is the must-show view.
- **Open questions:** can a solo strip stand alone as a hero, or is it only compelling in comparison?

---

## 7. Open areas for CD to explore  *(proposed by CC — optional, secondary to §6)*

### Open area 1 — the Relationships / heredity surface *(proposed by CC)*
- **What it is & why:** the larger concept's second pillar — taste twins, rivals/nemesis (from co-voting and,
  in one league, real downvotes), and **family heredity** (this is a literal family tree: 80 relationships —
  siblings, spouses, parents, children, cousins). If a form factor naturally extends into a "you vs your
  brother" comparison view, a rough option is welcome — but **don't let it crowd out the four §6 treatments.**
- **How it relates:** the comparison/stacking behavior tested in D (and A) is the seed of this surface.

### Open area 2 — the Archetype badge *(proposed by CC)*
- **What it is & why:** the concept's playful third pillar — a named persona derived from signature extremes
  ("The Crate Digger", "The Radio"). It will sit *with* the signature. A light take on how a name/badge
  cohabits with the visual (esp. inside the Trading Card) is useful, but secondary.

---

## 8. Existing patterns to honor / reuse

- **Reuse as-is:** `ShareOverlay.svelte` + `.bs-sharecard` (264px, accent gradient, spring entrance) for the
  share output; `Avatar.svelte`; the `.bs-eyebrow` / `.bs-sec-title` / `.bs-sec-sub` section header pattern;
  the 5-flavor accent system (`--acc/--acc-2/--acc-soft`); `icons.ts` for any glyphs.
- **Patterns to follow:** mono uppercase micro-labels; 2px-accent-top + corner radial-gradient card styling;
  hover-lift; `bs-pop` spring for reveals; tier-gating as the model for the **low-coverage** state.
- **May extend with care:** `.bs-spectrum` (the existing polarity slider could be repurposed as a per-axis
  detail / expanded view behind the new visual); the icon set (new glyphs OK if they match the line weight).
- **Do NOT touch / change:** the no-login static `read_model.json` model; the tier-gating contract; Home and
  Archive screens; the brand wordmark treatment; token names in `colors_and_type.css`.

---

## 9. Decision points to game out  ⭐

### D1. Which form factor becomes the Sonic Signature? · **[Required — from team]**
- **The decision:** pick the primary visual language (A Radar / B Sigil / C Card / D DNA) — or a defined
  combo (e.g. "Bloom as hero, DNA as the family-comparison view, both inside a Card to share").
- **Why it matters:** it's the identity of the whole feature and everything downstream (share, comparison,
  archetype) hangs off it.
- **Options on the table:** the four in §6, plus combos.
- **Constraints from the existing system:** inline SVG / CSS only (no chart lib); must render from static
  data; must survive shrink to a 264px sharecard; must read as Mashco.
- **What CD should put on the canvas:** **all four, realized**, on the §3a sample players, at both sizes,
  shown *inside a real Profile-screen frame* for at least the chosen-feeling ones so we judge it in context.
- **How we'll decide:** the owner picks by eye from the canvas; tie-breakers = shareability + family-comparison legibility.

### D2. Solo vs. sharecard treatment · **[Proposed by CC]**
- **The decision:** how each signature scales from the in-app hero to the 264px screenshot card — same
  visual shrunk, or a purpose-built compact share layout?
- **Why it matters:** the share artifact is job #2; it must look deliberate, not like a cropped screenshot.
- **Options:** identical-shrunk · compact share variant · card-framed (ties to C).
- **Constraints:** must use `.bs-sharecard` proportions + voice + the "no login, no app link" caption ethos.
- **What CD should put on the canvas:** the chosen form at both sizes, side by side.
- **How we'll decide:** does the 264px version still read instantly and feel postable.

### D3. How the family/heredity comparison renders · **[Proposed by CC]**
- **The decision:** the "you vs your parent/sibling" view — overlaid polygons? stacked DNA strips? two cards
  + a match %? 
- **Why it matters:** comparison/heredity is the most novel, most shareable angle of the concept.
- **Options:** overlay (radar) · stack (DNA) · side-by-side + "match %" headline.
- **Constraints:** must work from Dad vs River (§3a); must stay legible on a phone.
- **What CD should put on the canvas:** at least one comparison treatment using the sample pair.
- **How we'll decide:** which makes "we share/don't share taste" obvious in one glance.

### D4. Low-coverage / low-confidence state · **[Proposed by CC]**
- **The decision:** how the signature looks and what cue it shows when audio axes (Energy/Mood/Tempo) haven't
  backfilled, or a player has too few songs.
- **Why it matters:** coverage is ~30% on audio today and grows over time; the visual must be honest and not
  look broken or fake-complete. The lite-tier teaser is the existing model.
- **Options:** ghost/hollow the missing axes · show only known axes + a "filling in…" cue · confidence ring/%.
- **Constraints:** reuse the lite-tier "fills in as the season plays out" tone.
- **What CD should put on the canvas:** the chosen form in full vs degraded, side by side (use Jules-degraded
  from §3a).
- **How we'll decide:** is it honest, on-brand, and clearly temporary rather than broken.

### D5. *(open stub for CD)* Archetype name + signature cohabitation · **[Proposed by CC]**
- Light exploration only — see §7-2. How a persona name/badge sits with the visual without competing.

### D6. *(open stub for CD)* — reserved for a high-value choice CD spots while designing.

---

## 10. Constraints

- **Technical:** `bside` has **no charting library** and we don't want to add one — everything is **inline
  SVG + CSS** (this is already how the spectrum/overlap bars are built). Must render from the static
  `read_model.json` (no runtime fetch). Mobile-first; content width ~360–390px on phones.
- **Brand & consistency:** must read as Mashco / *the b/side* — pulp accent, Bricolage + Inter Tight +
  JetBrains Mono, dark-first, the card/chip/eyebrow vocabulary. Not a generic analytics chart.
- **Accessibility bar:** legible at phone size; don't rely on color alone (the six axes need labels/shape, not
  just hue — important for the Sigil and DNA forms); respect text contrast against `--ink` backgrounds.
- **Risks / past problems:** the prior data-viz section (the digest "Tastemaker") **silently emptied** when
  data decayed — so the low-coverage state (D4) is a real, learned-the-hard-way concern, not hypothetical.

---

## 11. Success criteria

- **How we'll judge it's good:** (1) two different players are **instantly distinguishable** at a glance;
  (2) it looks **native to b/side**; (3) the 264px sharecard is something the owner would actually post; (4)
  the family-comparison view makes shared-vs-divergent taste obvious in one look.
- **Metrics it should move:** screenshots/shares into the family chat; "comment-ability" (people react to it).
- **What "fits the product" means:** uses Mashco tokens, the `.bs-*` vocabulary, the accent system, the share
  overlay, and the warm/cheeky mono-label voice — drop-in, not bolt-on.

---

## 12. Deliverables & logistics

- **Fidelity expected:** **high-fidelity, realized** treatments (not rough wireframes) — this is a "pick by
  eye" decision, so the four need to look real, on the §3a data, in Mashco.
- **Variations wanted, and on what:** all **four form factors** (§6); each at **in-app hero + 264px
  sharecard**; **one comparison** view (Dad vs River); **one degraded** view (Jules, audio unknown).
- **Deliverable format:** Handoff packet per `Handoff-Packet-Manifest.md` + a kickoff prompt for CC to
  implement the chosen direction in `bside`.
- **Review cadence:** one canvas pass → owner picks a direction → CD designs the chosen one to full fidelity.

---

## 13. Open questions & unknowns

- Which form factor wins is **the** open question (D1) — that's the point of this round.
- Does the Sigil/DNA stay readable enough to *compare* two people, or is Radar the only honest comparison form? (D3)
- Should the Archetype badge be in-scope now or strictly later? *(assumption: later — keep it light)*
- Is rarity (in the Trading Card) worth computing, or a gimmick? *(unknown — needs decision)*
- Exact final axis list could still shift (e.g. add a "vintage/era" axis **if** release-year gets backfilled —
  not captured today). Design for **six**, but don't hard-bake the count.

---

## Appendix — file map & references

- **Design tokens:** `bside/src/colors_and_type.css` (color/type/space/radius/shadow/motion).
- **Component library:** `bside/src/dashboard-styles.css` (`.bs-*`), `bside/src/lib/atoms/` (Avatar, ShareOverlay), `bside/src/lib/icons.ts`.
- **Screens the feature touches:** `bside/src/routes/ProfileScreen.svelte` (fingerprint section ~111–182), share via `ShareOverlay.svelte`.
- **Other references:** the larger concept (Sonic Signature + Relationships + Archetype) was brainstormed with the project owner; this brief covers the **Signature visual** only. Data axes/coverage are from the live `data/league.db` (audio ~30%, popularity/tags/lyrics ~100%).
