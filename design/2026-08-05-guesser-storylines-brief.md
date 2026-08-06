# Feature Design Brief *(existing repo)*

> **For:** Claude Designer (CD) · **Written by:** Claude Code (CC) · **Product:** Music League Bot digest
> **Feature:** Redesign two new digest sections — **"The Guesser"** and **"Storylines"** · **Date:** 2026-08-05 · **Brief version:** 1
> **Repo (local checkout):** `/home/loydmilligan/Projects/music-league-bot`

---

## 0. How CD will use this brief *(fixed — do not edit)*

CD will: (1) read this brief and load/observe the design system as it's actually implemented; (2) confirm and, if needed, top up the decision points to 4–6 total; (3) build a pannable **canvas** of options with visual aids — both for the ideas named and for the open areas CD is invited to explore; (4) iterate in chat to settle each decision; (5) produce the **full design** for the feature, fitted to the existing product; (6) write a process summary and decision log; (7) assemble a **handoff packet**; (8) return a **kickoff prompt** for CC to implement.

---

## 1. Product & feature snapshot

- **Product:** A private WhatsApp/Discord bot for a group of Music League players. Its headline artifact is a per-round **digest** — a shareable, print-zine-styled web page (rendered to PNG/PDF and sent to the group chat) recapping a round's songs, votes, drama, and chat.
- **The feature, in one sentence:** Redesign two just-shipped digest sections so they land with the *energy* the group actually feels about them — **The Guesser** (one player's ritual of guessing every song's submitter, drunker as he goes) and **Storylines** (a recurring-cast "who's who" of the league's running bits).
- **Why now:** Both sections are live and functionally correct but visually first-pass (plain tables/lists). The Guesser especially encodes a beloved group tradition that the current dry "2/16" record doesn't convey.
- **Who reviews / decides:** The repo owner (building this for his wife Mara, a player in the league).
- **Deadline / milestone, if any:** None hard. This is a polish/creative pass; the underlying data logic is settled and deployed.

---

## 2. Repo orientation *(from the local checkout)*

- **What the codebase is:** SvelteKit (Svelte 5 runes) app under `ui/`, `adapter-node`, better-sqlite3. The digest is a server-rendered route; sections are Svelte components. Digests are also screenshotted to PNG/PDF via Puppeteer (an `?export=1` query param switches components to a static render mode).
- **How to run / view it:** prod is live at `http://localhost:3002/digest/163` (round 163 "Ink worthy" — has BOTH new sections rendered right now, enabled for league `sssc`). Dev: `cd ui && npm run dev -- --host --port 5180`.
- **Key directories:** digest route `ui/src/routes/digest/[roundId]/+page.svelte` (+ `+page.server.ts`); section components + logic in `ui/src/lib/digest/`; deterministic data in `ui/src/lib/db/` (`guesserInsights.ts`, `roundInsights.ts`).

### 2a. Design system, as implemented

- **System in use:** **Mashco.** The digest's accent tokens resolve to Mashco pulp tokens: `--accent: var(--mash-pulp)` / `--accent-hover: var(--mash-pulp-deep)`. Document to the *implemented* light "paper/zine" theme (below), which is what the digest actually renders — the digest is deliberately a warm print-zine surface, not the app's dark chrome.
- **Where tokens live:** CSS custom properties on the digest root; global vars in `ui/src/app.css`. Real values (digest paper theme):
  - `--bg: #f4f1ea` (cream paper) · `--fg: #1a1d22` (near-black ink) · `--fg-muted: #5f6470` · `--fg-quiet: #8a8f9a`
  - `--accent: var(--mash-pulp)` (pulp red/orange; the app's `--color-accent` is `#ff5b2e`, deep `#8a2d15`)
  - A parallel **dark** theme exists (`--color-bg: #07090c`, `--color-surface: #141921`, `--color-fg: #f1f4f7`) — NOT used by the digest paper surface; ignore unless proposing a dark variant.
- **Component library / inventory (reusable, digest):**
  - `DigestSection.svelte` — the section shell (header/eyebrow, action bar, textual + visual slot). All sections mount through it.
  - `ChatMoments.svelte` — the best template for a hand-built visual renderer of a restructured JSON shape, with dual web/`?export=1` mode. **Storylines currently mirrors this.**
  - `DigestInsights.svelte` (the `stats` "By the numbers" section) — the deterministic-visual precedent (reads heavy payload via `visualData`/`data` prop, not `content`). **The Guesser follows this pattern.**
  - `AlbumPodium.svelte`, `StandingsChart.svelte`, `TastemakerSection.svelte` — other visual sections; look at these for the group's existing chart/viz vocabulary.
- **Icon set / illustration:** minimal; mostly typographic + emoji. No formal icon set in the digest.
- **Fonts:** `--font-display: "Bricolage Grotesque"` (headings/kickers), `--font-mono: "JetBrains Mono"` (labels, numbers, eyebrows), Inter Tight as a display fallback.

### 2b. Existing visual & interaction vocabulary

- **Color:** cream paper `#f4f1ea`, ink `#1a1d22`, muted `#5f6470`, single pulp accent. It reads like a printed zine / liner notes.
- **Type:** Bricolage Grotesque for display; **JetBrains Mono, uppercased, letter-spaced, ~11px** for eyebrows/labels/section-kickers and all numeric readouts (e.g. The Guesser uses `.gsl-kicker` "The Guesser", `.gsl-note` "deterministic · no LLM gloss").
- **Spacing/density:** compact, editorial; sections are stacked "cards" with a small-caps mono eyebrow row (`.gsl-card-head`, `.chatm-*`).
- **Signature components:** section header = kicker + optional note; body is either textual (title/body/items) or a bespoke visual component. `ChatMoments` uses an accordion/table-of-contents pattern (`.chatm-toc`, `.chatm-acc`, `.chatm-trigger`) on web that flattens for export.
- **Interaction:** web is interactive (accordions, hover); `?export=1` renders a flat static version for the PNG/PDF. **Every visual component must render well in BOTH modes** — the exported image is what actually gets sent to the group chat.
- **Tone of UI copy:** wry, lowercase-mono asides ("deterministic · no LLM gloss", "hardest to guess", "Drunk by the third round"). Playful but terse.
- **Established states:** each section renders an explicit empty state (e.g. `.gsl-empty` "(not enough season data yet)", ChatMoments `.chatm-empty`) rather than an empty table — keep this.

### 2c. Current information architecture

- **IA:** one long digest page = a vertical stack of sections (podium, villain, flow, consensus, quotes, chat/"Back cover", stats, and now guesser + storylines), each a `DigestSection`. Order is configurable; guesser & storylines currently sit among the back-half sections.
- **Where relevant:** the reader is scrolling one round's digest; these two sections are "the fun back-of-the-zine" content, after the competitive results.

---

## 3. The feature — what & why

- **What it does:** Two sections that celebrate the league's *culture*, not its scores.
  - **The Guesser** — a deterministic ledger of **Boonie Dogsweat**, who guesses the submitter of *every* song *every* round (getting visibly drunker down the playlist). Current UI: a weekly record ("2/16 correct", "hit rate 13%"), a 3-cell "Drunk by the third round" accuracy grid, and three small tables (Eludes him / Always nails / Littermates — the pair he swaps).
  - **Storylines** ("The Regulars") — a curated cast of recurring bits, each written up by an LLM strictly from real evidence quotes (e.g. PoetryInNoise's Sir-Mix-a-Lot fandom; timmyg's underground-hip-hop/weed deep-dives). Current UI: a title + a list of `{name, headline, evidence[]}`.
- **Core user value:** make the digest feel like *their* group — surface the in-jokes and the tradition so the sections are as fun to read as the actual results.
- **The one outcome it must deliver:** The Guesser section should make a reader who knows the tradition grin, and make a newcomer *get* why it's a thing — primarily as a **shareable exported image**.
- **Scope — in / out / later:**

| In scope | Explicitly out | Later |
|---|---|---|
| Visual/UX redesign of The Guesser + Storylines (web + export) | Changing the deterministic data logic / matching (settled) | Auto-generating per-round anecdotal blurbs from data |
| A legend/tooltip telling the origin story | New digest sections | Audio-feature (BPM/energy) analysis once coverage improves (only 6/217 songs analyzed today) |
| Better encoding of "drunkenness by play order" | The 6 core LLM sections' look | Player taste-fingerprint integration (system exists: `ui/src/lib/taste-waveform/`) |
| An "anecdotal" treatment given sparse correct-guess data | | |

---

## 4. Where it lives — touchpoints & entry points

- **Screens touched:** only the digest page `ui/src/routes/digest/[roundId]/+page.svelte` and the two components (`GuesserLeaderboard.svelte`, `StorylinesCast.svelte`). Live example: `/digest/163`.
- **New entry points:** none — these are in-page sections. A new **legend/tooltip** (origin story) is a new *element* within The Guesser section.
- **How it fits IA:** unchanged — same vertical section stack.
- **Must not disrupt:** the `?export=1` static render (this is what's sent to chat), the other sections, and the per-section action bar (`DigestSection` renders exclude/lock/regen; the guesser wires these like `stats`).

---

## 5. Users & jobs for this feature

- **Who:** league players reading the digest in WhatsApp/Discord (mostly as a forwarded image), and the owner/Mara reviewing before it's sent.
- **Jobs, priority order:**
  1. Feel the Guesser tradition's energy at a glance (who got nailed, who's a mystery, how drunk-wrong he got by the end).
  2. Read the Storylines cast and recognize their friends.
  3. Onboard a newcomer to *why* The Guesser exists (the legend).
- **Frequency & context:** once per round (~weekly), read on a phone, most often as a static image.
- **What they do today instead:** the tradition lives only in the chat + the raw Music League vote comments; nothing visualizes it.

---

## 6. Ideas to flesh out *(named by the team)*

### Idea A — Convey the *energy* + tell the origin (legend/tooltip)
- **The idea:** The Guesser is a real, beloved tradition; the section should feel like it. Include an **abbreviated origin story** as a legend/tooltip.
- **The origin (context for CD — energy, not all for the UI):** Early in the league's first season, Dogsweat guessed the submitters of ~5 songs in a round — missmara was one. He did it again the next round, and **missmara admitted his guesses had become *as exciting as the actual vote reveal*.** A tradition was born. He now guesses **every song, every round**, and at some point added his own rule: he does it **while getting progressively drunker** down the playlist.
- **Known constraints:** the legend must fit the paper-zine tone; work in the exported image (a tooltip that only exists on hover is useless in the PNG — needs a static form too). Keep it short.
- **Open questions:** inline legend vs. tooltip vs. a one-line standing epigraph? How much story is too much for a recurring weekly section?

### Idea B — Make the KPIs *legible* (what are we even measuring?)
- **The idea:** Explain/tighten the "KPIs." Today: **weekly record** (correct/attempts + hit-rate %), **Eludes him** (season submitters he's worst at), **Always nails** (best at), **Littermates** (the pair he most swaps for each other), and **Drunk-by-third** (accuracy in the first/middle/last third of the playlist).
- **Why interested:** the current tables are dry and the labels terse; a reader shouldn't have to decode them.
- **Constraints:** stay deterministic/honest (no fake precision). Data is genuinely sparse on the "correct" axis (see Idea D).
- **Open questions:** which KPIs deserve prominence vs. a footnote? Is "hit rate %" even the headline, given he's ~15% for the season?

### Idea C — Drunkenness as a graph / timeline (not a 3-cell grid)
- **The idea:** The "drunker as he goes" mechanic is the soul of the bit. A **line graph or timeline** across play order (song 1 → N) might convey it far better than the current 3-cell "first/middle/last" accuracy grid.
- **Why interested:** play order = `ORDER BY spotify_uri` (verified), so every guess has a real position 1..N. Accuracy and/or his self-reported drunkenness ("I'm still quite drunk", "I have lost all coherence") *decays* over the list — a timeline could plot correctness per position, annotate the moment he "loses coherence", show his bathroom breaks, etc.
- **Constraints:** must render statically in the export image; small data per round (~16–21 points).
- **Open questions:** plot accuracy, or a "drunkenness index" mined from his comments, or both? Per-round only, or a season-long strip?

### Idea D — Lean *anecdotal* over statistical (sparse correct data)
- **The idea:** He only gets **2–6 right per week** (~15% season), so dry stats undersell it. Favor **anecdotal/qualitative** framing: "this week he had unusual trouble with *so-and-so*", "he *always* whiffs on *X*", "he can't tell *A* and *B* apart", or (later) "he never gets songs with BPM over *N*".
- **Why interested:** the funny truth is in the *patterns of failure*, not the win count.
- **Constraints:** anything asserted must be backed by real data (the litter-mates/eludes-him rows already are). Audio-feature angles (BPM/genre) are **aspirational** — only 6/217 SSSC songs are analyzed today.
- **Taste fingerprints:** the repo has a per-player taste system (`ui/src/lib/taste-waveform/`, `song_audio_features` with bpm/key/energy). A rich future angle: when Dogsweat's comment **nails** a player's taste vs. **totally misses** it, surface it. (Assumption: worth prototyping the *presentation* even if the data pipeline is later.)

### Idea E — Storylines / "The Regulars" *(the other new section — full treatment)*

**What it is (current implementation).** A curated **cast of recurring characters** in the league. Mechanism (`ui/src/lib/digest/storylineSeeds.ts` + `storylineEvidence.ts`): a per-league **seed** list (`{player, motif, patterns, sources}`) drives a *deterministic* evidence gatherer that searches the round's chat window + that player's vote comments for the motif; matching **quotes** are collected; a thin LLM pass then writes a `{name, headline, evidence[]}` card for each seed **using only those quotes** (no invented threads). A seed with no evidence that round is **dropped**. Current SSSC seeds: PoetryinNoise (cats / "big butts"), Timmywhatup (rap deep-dives / weed), bagimation + missmara ("songs they didn't pick").

**Real current output (R163 "Ink worthy") — use this as the sample content, not lorem:**
- **PoetryinNoise** — *headline:* "Sir Mix-a-Lot's Biggest Fan (And Reluctant Motley Crüe Scholar)"; *evidence:* "…few songs have spoken to me on a deeper level than Baby's Got Back." / "Confessed to owning Motley Crüe's *New Tattoo* twice and experiencing active moral distress about it."
- **timmyg** — *headline:* "The Underground Hip-Hop Completist (Who Lives and Dies by OME)"; *evidence:* a real ELUCID/Billy Woods/RAP Ferreira weed-lyric deep-dive quote.

**The hard truth CD must design around: it fires sparsely.** Across the 11-round season the 4 seeds produced evidence only **6 times total** — most rounds show **0–2** cast members, and the "didn't-pick" seeds almost never fire. So the section is **frequently empty or a single card.** The design must make a 1-member (or 2-member) state feel *intentional and good*, not broken — and must have a graceful "no regulars surfaced this week" empty state. A dense multi-card grid designed for 5 people will look wrong at n=1.

**Why the team is less sure here.** Unlike The Guesser (a beloved tradition with a clear shape), Storylines is newer and its content is thinner/less predictable. It may want to be quieter — margin notes, a single "character of the week" spotlight, or a running who's-who that persists across rounds — rather than a big section.

- **Constraints:** LLM-written from bounded evidence; **cast size 0–2 typical**, must degrade gracefully; same export/web dual-mode; the `evidence[]` items are the real value and should read as *character*, not footnotes.
- **Open questions:** cards vs. list vs. margin notes vs. a single weekly spotlight? Given sparse firing, should it be a small always-present "regulars" strip that just shows *who appeared* this week, expanding only when there's real material? How should it relate visually to The Guesser — a matched sibling, or deliberately quieter?
- **Data:** the full seeds + every round's fired evidence quotes + R163's generated cast are exported to `exports/guesser-brief/storylines-data.json` (hand to CD).

---

## 7. Open areas for CD to explore *(proposed by CC)*

### Open area 1 — A shared visual identity for the two "culture" sections *(proposed by CC)*
- **What & why:** The Guesser and Storylines are both "back-of-the-zine, about the people" content, distinct from the competitive results above. A shared motif (a recurring header treatment, a margin rule, a stamp) could signal "this is the fun part" and make them feel intentional rather than two unrelated experiments.
- **Relation:** both are new; designing them together is cheaper and more coherent than separately.

### Open area 2 — The Guesser as a *season-long* artifact, not just weekly *(proposed by CC)*
- **What & why:** The tradition is cumulative (littermates, eludes-him, "you've eluded me all season" — a real quote). A small season strip/sparkline (his weekly hit-rate over the 11 rounds: `3/20, 3/21, 2/20, 3/16, 4/17, 2/19, 3/13, 1/16, 3/13, 2/16`) could anchor the weekly record in the ongoing saga.
- **Relation:** directly extends Ideas C/D; data is already exported (see the data file).

---

## 8. Existing patterns to honor / reuse

- **Reuse as-is:** `DigestSection.svelte` shell (do not reinvent the section header/action-bar); the `?export=1` dual-mode pattern from `ChatMoments.svelte`; the deterministic-visual `visualData` prop convention from `DigestInsights.svelte`.
- **Patterns to follow:** mono-uppercase eyebrows/labels; explicit empty states; the paper-zine palette + Bricolage/JetBrains type pairing.
- **May extend, with care:** the `GuesserData` / storylines `content_json` shapes IF a design needs a field the data doesn't yet carry — but flag it; adding data is a code+deploy change (`guesserInsights.ts`).
- **Do NOT touch:** the deterministic matching logic; the 6 core LLM sections; the export pipeline; the action-bar wiring.

---

## 9. Decision points to game out ⭐

### D1. How to encode "drunker as he goes" · **[Required — from team]**
- **The decision:** Replace the 3-cell "Drunk by the third round" grid with something that conveys the decay across the full playlist.
- **Why it matters:** it's the emotional core of the section and the most-requested change.
- **Options on the table:** (a) line graph — accuracy vs. play position; (b) a horizontal "night" timeline (song 1→N) annotated with his real comments ("came back from a bathroom break", "lost all coherence"); (c) a "drunkenness index" curve mined from his comment language, overlaid on hit/miss dots; (d) keep a compact grid but add a sparkline.
- **Constraints:** must render statically in the export PNG; ~16–21 points/round; stay honest (small n).
- **Canvas:** 3–4 in-context options shown inside a real digest, both web and exported-image forms.
- **How we'll decide:** which one best sells the tradition at a glance in the *image*.

### D2. Legend/origin treatment · **[Required — from team]**
- **The decision:** How to present the abbreviated origin story so it works in the static export (not hover-only).
- **Why it matters:** onboards newcomers; sets the tone.
- **Options:** (a) a one-line standing epigraph under the kicker; (b) an expandable "how'd this start?" that's collapsed on web but printed in full (or as a short caption) in export; (c) a margin/footnote "liner note".
- **Constraints:** short; paper-zine tone; must have a static form for the image.
- **Canvas:** 2–3 treatments in context.
- **How we'll decide:** conveys the story without crowding the weekly numbers.

### D3. KPI hierarchy — what's the headline? · **[Proposed by CC]**
- **The decision:** Given he's ~15% correct, is the headline the record, the *misses* (littermates/eludes-him), or the drunkenness arc?
- **Why it matters:** determines the section's whole layout & first read.
- **Options:** (a) record-first (status quo); (b) misses-first ("the people he can't crack"); (c) arc-first (the drunk timeline is the hero, stats are support).
- **Constraints:** all backed by real data; keep the deterministic honesty.
- **Canvas:** 3 layout options varying the hero element.
- **How we'll decide:** which reads as most *fun*, not most *accurate*.

### D4. Storylines format & how it survives being sparse · **[Proposed by CC]**
- **The decision:** What form the cast takes AND how it holds up when only 0–2 seeds fire (the common case: 6 fires across 11 rounds).
- **Why it matters:** it's the other new section; the wrong form looks broken at n=1. It should feel sibling to The Guesser without competing with it.
- **Options:** (a) refined list (status quo+); (b) cast "cards" (name/headline/pull-quote) sized to look right at n=1–2; (c) a single "regular of the week" spotlight; (d) a small persistent "the regulars" strip that names who showed up and expands only when there's real material; (e) quiet margin notes alongside other sections.
- **Constraints:** variable cast size **0–2 typical**, LLM-written from real quotes, export dual-mode, graceful "none this week" empty state.
- **Canvas:** 2–3 options in context, each shown at **n=0, n=1, and n=2** (the states it will actually be in), web + export.
- **How we'll decide:** looks intentional at n=1, warm, recognizable, coherent-but-subordinate to The Guesser.

### D5. *(open stub for CD)*
### D6. *(open stub for CD)*

---

## 10. Constraints

- **Technical:** Svelte 5 runes; components receive `content` (small caption) + `data` (heavy payload) props; must support `?export=1` static render (Puppeteer screenshots this); no new heavy deps for the export path (it runs in a container). Data shapes: `GuesserData` (`ui/src/lib/db/guesserInsights.ts`) and storylines `content_json` `{title, cast:[{name,headline,evidence[]}]}`.
- **Brand & consistency:** must read as the same paper-zine digest (Mashco pulp accent, Bricolage/JetBrains, cream/ink).
- **Accessibility:** legible at phone size and as a compressed forwarded image; sufficient contrast on cream; don't rely on color alone (hit/miss).
- **Risks / past problems:** the exported image is the real deliverable — anything hover-only or interaction-dependent is invisible there. Data is sparse on the "correct" axis. Audio-feature coverage is thin (6/217).

---

## 11. Success criteria

- **Good design =** a reader who knows the tradition grins; a newcomer understands it; it looks native to the digest.
- **Metrics it should move:** (soft) the owner wants to *actually send* these sections; delight, not a dashboard.
- **"Fits the product" =** indistinguishable in palette/type/tone from the existing digest sections; flawless in the exported PNG/PDF.

---

## 12. Deliverables & logistics

- **Fidelity:** high-fidelity, in-context (shown inside a real digest page), BOTH web and exported-image forms.
- **Variations wanted:** on D1 (drunkenness viz) and D3 (KPI hierarchy) especially.
- **Deliverable format:** Handoff packet per `Handoff-Packet-Manifest.md` + a kickoff prompt for CC. Additions: the exported-image mock is as important as the web mock.
- **Review cadence:** one canvas pass, then a joint review before build.

---

## 13. Open questions & unknowns

- Inline legend vs. tooltip vs. epigraph for the origin (D2). *(unknown — needs decision)*
- Is "hit rate %" the right headline given ~15%? (D3) *(unknown)*
- Should the two culture sections share a visual motif? (§7 Open area 1) *(assumption: yes — worth exploring)*
- How much of the "anecdotal" framing (Idea D) can be data-backed *now* vs. deferred until an anecdote-generation pass exists? *(unknown — the litter-mates/eludes-him data supports some; BPM/genre does not yet)*
- Taste-fingerprint integration is aspirational (data pipeline later) — design the *presentation* speculatively or defer? *(unknown)*

---

## Appendix — file map & references

- **Design tokens:** `ui/src/app.css` (paper theme vars; `--bg #f4f1ea`, `--fg #1a1d22`, `--accent → --mash-pulp`, `--font-display` Bricolage, `--font-mono` JetBrains).
- **Component library:** `ui/src/lib/digest/` — `DigestSection.svelte` (shell), `ChatMoments.svelte` (dual-mode template), `DigestInsights.svelte` (deterministic-visual precedent), `GuesserLeaderboard.svelte` (current Guesser), `StorylinesCast.svelte` (current Storylines).
- **Screens the feature touches:** `ui/src/routes/digest/[roundId]/+page.svelte`; live example `/digest/163`.
- **Data (Guesser):** `GuesserData` shape in `ui/src/lib/db/guesserInsights.ts`; a full real dataset (11 rounds of Dogsweat's guesses + comments + leaderboards) → `exports/guesser-brief/dogsweat-guesser-data.json`.
- **Data (Storylines):** seeds (`ui/src/lib/digest/storylineSeeds.ts`) + shape `{title, cast:[{name, headline, evidence[]}]}`; real seeds + every round's fired evidence + R163's generated cast → `exports/guesser-brief/storylines-data.json`. (Hand both data files to CD — real content beats lorem.)
- **Related:** taste system `ui/src/lib/taste-waveform/`; audio features `song_audio_features` table (sparse: 6/217 SSSC songs).
