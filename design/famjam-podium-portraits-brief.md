# Feature Design Brief *(existing repo)*

> **For:** Claude Designer (CD) · **Written by:** Claude Code (CC) · **Product:** Music League Bot — the digest
> **Feature:** Podium portrait images for the Fam Jam Season 4 season-results podium
> **Date:** 2026-08-30 · **Brief version:** 1
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

- **Product:** A private WhatsApp/web bot that turns a Music League season into a designed, magazine-style digest published per round at `digest.mattmariani.com`.
- **The feature, in one sentence:** Nine square images — **three players × three style themes** — to sit as the artwork on the top-three cards of the new "Season Results" podium in the Fam Jam Season 4 finale digest.
- **Why now:** Fam Jam Season 4 just ended (final round closed 2026-08-30). The season-recap digest is written and fact-checked; the podium currently falls back to a plain monogram tile because these players have no avatars in `player_avatars`.
- **Who reviews / decides:** Matt (Mashew) — league commissioner, sole reviewer.
- **Deadline / milestone:** The recap goes out to the league shortly; this is the last open item on it.

---

## 2. Repo orientation

- **What the codebase is:** SvelteKit 5 (runes) app in `ui/`, TypeScript, better-sqlite3. Digest sections are rows in `digest_sections` (SQLite), each rendered by a registered visual component. Node bot + MCP server live in `src/` and `mcp-server/`.
- **How to run / view it:** App runs at `http://localhost:3002`. The digest in question: **`/digest/129`** (Fam Jam S4 finale, draft `draft-129-e694c511`). Note: the digest page hydration-crashes under `npm run dev` for unrelated reasons — view the production build.
- **Key directories:**
  - `ui/src/lib/digest/` — all digest section components
  - `ui/src/lib/digest/AlbumPodium.svelte` — **the component these images render inside**
  - `ui/src/lib/shortlist/colors_and_type.css` — the design tokens
  - `design/` — where prior briefs live (`ytm-cover-brief.md`, `voting-habits-brief.md`)

### 2a. Design system, as implemented

- **System in use:** **Mash Co.** — dark-first, brand-led. Declared source of truth: `ui/src/lib/shortlist/colors_and_type.css` ("The single source of truth for both products").
- **Where tokens live:** `ui/src/lib/shortlist/colors_and_type.css` (colors, type). Radius/space tokens (`--r-2`, etc.) are consumed throughout `ui/src/lib/digest/*.svelte`.
- **Component library:** `ui/src/lib/digest/` — `AlbumPodium`, `ChatMoments`, `StorylinesCast`, `StandingsChart`, `DigestInsights`, `NextRoundPreview`, `GuesserLeaderboard`, `ReelSection`.
- **Icon set / illustration system:** None. There is no existing illustration language in the product — **this brief creates the first one.** (This is the main creative opening; see §7.)
- **Fonts in use:** `var(--font-body)`, `var(--font-mono)` (mono used heavily for eyebrows, ranks, metadata).

### 2b. Existing visual & interaction vocabulary

- **Color palette (actual values, `colors_and_type.css`):**

  | Token | Hex | Role |
  |---|---|---|
  | `--ink-0` | `#07090c` | page background (deepest) |
  | `--ink-1` | `#0d1116` | panel rest |
  | `--ink-2` | `#141921` | **card — what these images sit on** |
  | `--ink-4` | `#283039` | line |
  | `--ink-8` | `#c2cad3` | body text |
  | `--ink-9` | `#f1f4f7` | headings |
  | `--bone` | `#faf7f2` | warm-white brand surface |
  | `--mash-pulp` | `#ff5b2e` | primary accent — "meat red" |
  | `--amber` | `#e8a83a` | warning **and the gold-medal border tint** |
  | silver / bronze | `--fg-2` / `#c08758` | 2nd / 3rd medal tints |

- **Density:** compact, editorial. Podium card padding is 12px (9px in export). Mono micro-labels above almost every block.
- **Signature components & behavior:** `AlbumPodium` renders a **medal shelf** — silver·gold·bronze, gold tallest — then a numbered list for ranks 4+. Web is click-to-expand; `?export=1` renders everything flat for PNG/PDF.
- **Tone of UI copy:** dry, lowercase mono eyebrows ("A-side · final ranking", "Back cover · chat notes"), long-form editorial body copy.

### 2c. Current information architecture

The Fam Jam finale digest, in order:

`Season Results` *(this feature)* → `The Recap` → `Hall of Fame` → `The Coinage` → `Consensus` → `The Usual Suspects` → `The Lexicon` → `The Least-Loved` → `Best Lines` → `Season Moments`

The **Season Results** section is the first thing a reader sees.

---

## 3. The feature — what & why

- **What it does:** Gives each of the top three finishers a piece of artwork on their podium card, in place of the current letter-monogram fallback.
- **Core user value:** This is a family league. The podium is the emotional payload of the whole season — it should feel like something made *for these three people*, not a database row.
- **The one outcome it must deliver:** Each image reads, at a glance, as unmistakably *that person* — to the ten people who know them — without being a literal illustration of a fact about them.
- **Scope:**

| In scope | Explicitly out | Later |
|---|---|---|
| 9 square images: 3 players × 3 themes | Portraits / likenesses of real faces | Same treatment for ranks 4–11 |
| A theme system that could extend to the rest of the league | Any change to `AlbumPodium.svelte` | Reusable per-player avatars across future seasons |
| Delivery specs (size, format, safe areas) | New digest sections or layout changes | Animated/video variants |

---

## 4. Where it lives — technical envelope ⚠️

> ⟦ These are hard constraints from `ui/src/lib/digest/AlbumPodium.svelte`. ⟧

- **Aspect ratio: exactly 1:1.** `.apod-art { width: 100%; aspect-ratio: 1 / 1; }` (line ~215). Non-square art will be cropped by `object-fit`.
- **Corners are rounded** via `--r-2` — keep nothing critical in the extreme corners.
- **Top-left corner is occupied.** `.apod-rank-badge` is absolutely positioned at `top: 6px; left: 6px`, ~20px tall, on `rgba(7,9,12,0.78)`. **Leave the top-left ~22% × 22% free of anything load-bearing.**
- **Rendered small.** Three cards sit side by side inside a digest column — assume **~180–260 px wide** on screen. The design must survive that downscale: this is the single most common failure mode. Fine linework and small type will disappear.
- **Deliver at 1024 × 1024 PNG.** The digest exports to PNG and PDF (`?export=1`), so assets need 2×+ headroom. Transparent background is acceptable but the images sit on `--ink-2` `#141921`, so design *for* a dark card.
- **Medal borders sit around the card** in gold `#e8a83a` / silver / bronze `#c08758`. The artwork shouldn't fight those, and ideally doesn't force a rank-specific color of its own.
- **Filenames:** `famjam-s4-podium-{player}-{theme}.png`, e.g. `famjam-s4-podium-em-theme1.png`.

**What it must not disrupt:** `AlbumPodium.svelte` is shared by every league's digest and by the Hall of Fame section directly below this one (which shows real album art). No component changes — these images must work with the component exactly as it is.

---

## 5. Users & jobs

- **Who sees this:** the eleven Fam Jam players — an extended family (two married couples, a set of siblings, cousins, in-laws, parents) plus a few friends. Ages roughly 30s–70s.
- **Jobs-to-be-done:**
  1. Make the winner feel genuinely celebrated.
  2. Let each of the three be recognized by the other ten *without a caption*.
  3. Look like a coherent set — three cards, one family.
- **Context:** viewed once, on a phone, in a group chat, alongside a lot of text.

---

## 6. The three players — content

> ⟦ CD: the "season" facts are verified from the league database and chat. The "person"
> facts come from Matt directly. **Do not illustrate any of these literally** — see §6d. ⟧

### 6a. Em (Emily Friedman) — 🥇 1st, 125 points

**Her season:**
- **Champion**, and an upset — nobody expected it; the chat's verdict was "Upset of the decade" and "I feel a Netflix doc coming."
- **Won on floor, not ceiling.** Her worst round all year was 6 points; nobody else's floor was above 4. She is the only player who never posted a round under 5. Top three in 7 of 12 rounds and top five in 10 — both league bests.
- Her biggest single round (16) was only the **seventh**-largest score of the season. Five players out-peaked her; nobody out-steadied her.
- Won the **EDM round she chose the theme for herself** — with a track the league immediately complained was "barely EDM. Which is why it won."
- Her ballot comments are famously minimal: **"Fuunn," "Rad," "😍😍😍😍😍😍."**
- On winning: *"Wow guys never thought I'd see the day!"* — and immediately deflected credit to someone else.

**The person:** Art dealer. Loves EDM. Vegetarian. **Relentlessly, sincerely kind** — the most positive voice in a chat full of insult comedy. Married to Brianna (Mara's younger sister); the two are just beginning an Italian vacation for a significant birthday of Brianna's. Also an excellent basketball player, a point guard — **a fact Matt has explicitly forbidden from being illustrated.**

**Initial:** `E`

### 6b. missmara (Mara Mariani) — 🥈 2nd, 122 points

**Her season:**
- Led the table for **five consecutive rounds** and finished three points short.
- Scored the season's joint-highest single song: Pucker Up!'s "CREOLE," **22 points**, in the "Beats That Don't Taste Like Dirt" round.
- **The Commissioner.** She writes the themes, compiles the playlists, tabulated the "biggest critic" spreadsheet, and assigns people their haters: *"Mom, your biggest critic is Jo. Bri, yours is Ari."*
- Votes the reason over the song, out loud and against her own taste: *"My principles are at war. I am constitutionally opposed to voting for songs I can't bear to listen to. But I respect and accept your reasons for submitting it."*
- Refrain: *"points have to go somewhere."*
- On a rival submission: *"Every time I hear a new Halsey song in music league, I discover a new Halsey song I dislike."*

**The person:** Runs a business helping high-school students get into college. Listens to rap, **especially indie rap**. **Feisty.** Hates talking about her feelings.

**Initial:** `M`

### 6c. Johanna Friedman — 🥉 3rd, 115 points

**Her season:**
- **Won three rounds — more than anyone in the league** — including the finale (Tainy's "MOJABI GHOST," 15) and the opening practice round (Familjen's "Det snurrar i min skalle," 19).
- Mines a **Swedish-language vault** nobody else can reach; her wins repeatedly come from records the rest of the league has no route to.
- The even-handed one-point taxer: *"I'm sorry Ellen 😘 I tried to like this but Olivia Dean makes me feel like I'm at a Starbucks during the holidays. 1 point cause I love you."*
- Gave the league its best coinage-adjacent import: *"In Sweden we say 'smaken är som baken - delad' — taste is like the butt, divided."* Another player adopted it two days later.
- Saw Rosalía at the Forum in June: *"Life changing."*

**The person:** Swedish by birth. Married to Ari (cousin to Mara and Brianna). A **textile artist**, known for working on a very large **jacquard loom**. Young mother of two — Ruben and a daughter *(name unknown — see §12)*. She has unilaterally decided Matt looks like a "Timmy" and calls him that permanently.

**Initial:** `J`

### 6d. The hard creative rule — **do not be on the nose** ⚠️

Matt's instruction, verbatim in spirit: *"do not make these images too on the nose — just make the image evocative of the person."*

Concretely, the following are **banned**, not examples to follow:

| Player | Do **not** draw |
|---|---|
| Em | a basketball, a hoop, a court, a DJ booth, a turntable, a vegetable |
| missmara | a graduation cap, a diploma, a college campus, a microphone, a boombox |
| Johanna | a loom, a Swedish flag, a ball of yarn, blue-and-yellow, IKEA-anything |

The target is **evocation** — texture, palette, motion, geometry, mood — that makes the right person say "that's me" without any single object doing the explaining. A theme that leans on props has failed the brief.

**Initials:** each image should probably carry the player's initial as a designed element (the component's own fallback is a bare letter, so the initial is already the established visual grammar here). *(assumption — CC: worth testing an option without it, see D3.)*

---

## 7. Open areas for CD to explore *(proposed by CC)*

### Open area 1 — this is the product's first illustration language
There is **no existing illustration or avatar system anywhere in this codebase** (§2a). Whatever CD lands here becomes the de facto house style for player imagery across every league and season. Worth designing the *system*, not just nine files: a rule for how any player becomes an image.

### Open area 2 — the set has to survive being three-in-a-row
These are never seen alone. They appear as a shelf — silver, gold, bronze, gold tallest — 12px apart. A treatment that's gorgeous in isolation and muddy at 200px in a row of three is the failure case. Worth putting a three-up mock on the canvas early rather than judging single tiles.

---

## 8. Existing patterns to honor / reuse

- **Reuse as-is:** `AlbumPodium.svelte` — no changes. Mash Co. tokens from `colors_and_type.css`.
- **Follow:** dark-first surfaces; mono for anything typographic; editorial restraint over decoration.
- **May extend with care:** the palette — an illustration language may need hues outside the token set, but should feel adjacent to `--mash-pulp` `#ff5b2e` and the ink scale.
- **Do NOT touch:** the Hall of Fame section directly below, which shows real Spotify album art in the same component. These images will be seen a few centimetres from real album covers — **that's the adjacency to design against.**

---

## 9. Decision points to game out ⭐

### D1. What are the three themes? · **[Required — from team]**

- **The decision:** The deliverable is 3 options per player, where **each option is a different styling theme, and each theme is applied consistently across all three players** — so Matt can pick any one theme and get a matched set of three.
- **Why it matters:** This is the whole shape of the deliverable. The themes need to be genuinely different *approaches*, not three palettes of one idea.
- **Options on the table:** none pre-chosen — this is CD's to propose. Directions worth considering: risograph/print-artifact; woven or textile-structured abstraction; art-deco medal/trophy engraving; blocky monogram-as-poster; photographic-collage/darkroom; generative-geometry.
- **Constraints:** each theme must work for all three people without one of them feeling like an afterthought; must read at ~200px; must not collide with real album art (§8).
- **What CD should put on the canvas:** 3 candidate themes × the 3 players = the full 3×3 grid, shown as a **three-up podium shelf per theme**, at true rendered size, on `#141921`.

### D2. How far from literal? · **[Required — from team]**

- **The decision:** Where exactly on the abstraction dial these sit — pure abstraction (color/texture/form only), symbolic-but-oblique, or figurative-without-props.
- **Why it matters:** Matt's one strong instruction is "not on the nose" (§6d), but *unrecognizable* also fails: the other ten players must know who each card belongs to.
- **Constraints:** the banned-objects list is absolute.
- **What CD should put on the canvas:** the same player (suggest Johanna — richest material) at three abstraction levels, so the dial can be set once and applied.
- **How we'll decide:** Matt reacts to whether he'd know it was her.

### D3. The initial — integrated, incidental, or absent? · **[Proposed by CC]**

- **The decision:** How the `E` / `M` / `J` shows up: as the compositional hero, as a small mono mark, or not at all.
- **Why it matters:** the component's built-in fallback is a bare letter, so the initial is the existing grammar — but it may be redundant when the name is printed directly beneath the image anyway (`.apod-title` shows the player name).
- **What CD should put on the canvas:** one theme, one player, three initial treatments.

### D4. Does the artwork adopt the Mash Co. palette or contrast with it? · **[Proposed by CC]**

- **The decision:** Do the images live inside the dark ink scale (feeling built-in), or deliberately break out in saturated color (feeling like objects placed on the page)?
- **Why it matters:** they sit next to real album art, which is arbitrarily colorful. Matching the UI risks looking like chrome; ignoring it risks looking pasted on.
- **Constraints:** must not fight the gold/silver/bronze medal borders.

### D5. Coverage — top three only, or the whole league? · **[Proposed by CC]**

- **The decision:** Whether the chosen theme should be specified to scale to all 11 players (ranks 4–11 render the same art small, in list rows) or stay a podium-only flourish.
- **Why it matters:** changes whether CD designs a *system* with per-player rules or nine bespoke pieces.
- **How we'll decide:** cost of eight more images vs. the podium reading as special.

### D6. *(open stub — CD to top up)*

---

## 10. Constraints

- **Technical:** 1:1, 1024×1024 PNG, top-left 22% kept clear, legible at ~200px, designed on `#141921`. No code changes.
- **Brand:** must sit in the Mash Co. dark-first world and not look like generic AI illustration — this digest's whole voice is dry and editorial.
- **Accessibility:** the image is decorative; the player's name and points are real text beneath it. No information may live *only* in the image. Alt text should be provided per image.
- **Human constraint:** these are **real people in one family**, and two of the three will see their own card in a group chat. Flattering-or-neutral only; the digest's insult comedy lives in the copy, not here. No caricature of real faces.
- **Risks / past problems:** a previous digest visual (`ytm-cover-brief.md`) went through several rounds over exactly this "evocative vs. literal" line — expect the first pass to be too literal.

---

## 11. Success criteria

- **Good looks like:** Matt sends the digest, and at least one of the three says "how did you know" — or better, laughs.
- **Concretely fits the product when:** the three cards read as one set at phone size; none of them out-shouts the real album art below; the top-left rank badge sits on clean space; and nothing in the image needs a caption to work.
- **Fails when:** anyone needs the name underneath to know whose card it is, or when a themed prop does the explaining.

---

## 12. Assumptions & unknowns

| # | Item | Status |
|---|---|---|
| 1 | **Johanna's daughter's name** — Matt named Ruben and couldn't recall the second. CC searched the full Season 4 chat export and every Fam Jam message in `chat_messages`; **it is not in any data I hold.** | **(unknown — needs decision)** — Matt to supply, or omit |
| 2 | Images carry the player's initial | (assumption) — see D3 |
| 3 | "Em" is the display name on the card, not "Emily" | (assumption) — matches the DB and the standings |
| 4 | Vegetarianism / art dealing / college business are *character* inputs, not subjects to depict | (assumption) — follows from §6d |
| 5 | These are one-season assets, not permanent player avatars (`player_avatars` is empty for this league) | (assumption) — see D5 |
| 6 | Matt has the players' implicit consent to be depicted abstractly; no likenesses are being generated | (assumption) — flagged deliberately |

---

## 13. What comes back

CD returns a **handoff packet**: the nine images (plus the canvas of explored options), a decision log covering D1–D6, the theme system written up so it can be extended to other players, per-image alt text, and a kickoff prompt for CC to wire the files into `digest_sections` for `draft-129-e694c511`.
