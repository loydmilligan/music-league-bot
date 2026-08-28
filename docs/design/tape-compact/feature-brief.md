# Feature Design Brief *(existing repo)*

> **For:** Claude Designer (CD) · **Written by:** Claude Code (CC) · **Product:** The Boarz Tape (music-league-bot digest microsite)
> **Feature:** Compact layout redesign — same content, far less scrolling
> **Date:** 2026-08-27 · **Brief version:** 1.0
> **Repo (local checkout):** `~/Projects/music-league-bot`

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

- **Product:** The Boarz Tape — a single-page, share-with-the-group stats microsite mining a 10-person WhatsApp music-league chat (10,800 messages, full season) for awards, charts, and editorial bits. Live at `https://digest.mattmariani.com/d/boarz-chat-superlatives/`.
- **The feature, in one sentence:** Restructure the page so the same content requires dramatically less scrolling — it is currently one enormous vertical scroll of ~12 sections, and just grew two more (The Regulars: 30 cards; The Glossary: 6 dictionary entries).
- **Why now:** The owner's words: "the content as is is just toooooo long… make the content feel more compact… requires less scrolling… give us a few options." More sections are planned (see §7), so the layout must scale.
- **Who reviews / decides:** Matt (league commissioner, sole owner). Ten league members are the audience.
- **Deadline / milestone, if any:** None hard. (assumption: casual cadence — this is a hobby league site iterated between weekly digests.)

---

## 2. Repo orientation

- **What the codebase is:** A static-page generator inside a larger SvelteKit app. The Tape is **one self-contained HTML file** produced by substituting a JSON blob into an HTML template — no framework at runtime, all CSS and JS inline, self-hosted fonts, zero external requests by design. Build: `ui/scripts/build-chat-superlatives.mjs` injects computed stats (`chat-superlatives-data.mjs`), song data (`chat-songs.json`), and hand-authored editorial (`chat-tape-editorial.json`) into `ui/scripts/chat-superlatives.template.html` (1,194 lines) → `digests/d/boarz-chat-superlatives/index.html`, served read-only by a static Caddy.
- **How to run / view it:** `cd ui && node scripts/build-chat-superlatives.mjs` then open `digests/d/boarz-chat-superlatives/index.html`, or view live at the URL above (deploys instantly on rebuild — shared volume).
- **Key directories CD should know about:**
  - `ui/scripts/chat-superlatives.template.html` — the entire page: CSS (lines 11–345), markup (346–640), render JS (641–1194).
  - `ui/scripts/chat-tape-editorial.json` — Regulars/Glossary content (structured, hand-authored).
  - `docs/superpowers/specs/2026-07-27-chat-superlatives-design.md` — original feature spec.

### 2a. Design system, as implemented

- **System in use:** None named (not Mashco, not DogBelly). The Tape has its **own implemented language** — dark "liner notes / cassette insert" editorial aesthetic shared visually with the league's weekly digests. **The implemented reality below is the system; match it.**
- **Where tokens live:** `ui/scripts/chat-superlatives.template.html` lines 12–27 (`:root` block).
- **Component library location & inventory:** No component library — hand-rolled CSS classes in the same file. Reusable idioms: `.sec-head`/`.sec-tag` (section headers), `.roll`/`.award` (award cards), `.trivia`/`.triv` (stat tiles), `.bigword-*` (hero word + quote), `.row`/`.row-bar` (ranked bar rows), `.tri-*` (grouped bars), `.dumb-*` (dumbbell chart), `.heat-*` (heatmap grid), `.chips` (filter chip groups), `.nav` (sticky pill nav, new), `.reg-*` (Regulars cards, new), `.gl-*` (Glossary dictionary cards, new).
- **Icon set / illustration system:** None. Emoji appear only as content. No images except lazy-loaded album art in the track list.
- **Fonts in use:** self-hosted via `./_app/fonts.css` — **Bricolage Grotesque** (display: h1/h2/h3, hero words, archetype/term titles), **Inter Tight** (body), **JetBrains Mono** (all data, captions, kickers, tags).

### 2b. Existing visual & interaction vocabulary

- **Color palette (actual values):** accent `--mash-pulp:#ff5b2e` (+ `-deep:#d94c23`, `-edge:#8a2d15`, `-soft:#ff5b2e22`); ink scale `--ink-0:#07090c` → `--ink-9:#f1f4f7` (bg is ink-0, cards ink-1/2, borders ink-4/5, muted text ink-6/7); `--bone:#faf7f2`; chart accents `--moss:#3ec27a`, `--amber:#e8a83a`, `--ember:#e6566c`, `--sky:#5aa3ff`.
- **Type scale & families:** body 16px/1.6 Inter Tight; h1 display ~clamp large with italic accent word; h2 in `.sec-head`; mono captions at 10.5–13px with letter-spacing .06–.18em, uppercase for kickers/tags; hero tokens 26–30px+ Bricolage 800.
- **Spacing / layout grid / density:** single centered column `--col:860px`, 24px side padding; sections separated by generous vertical whitespace and `1px var(--line)` rules; cards radius 8–12px with 1px borders; grids via `repeat(auto-fit,minmax(270px,1fr))`.
- **Signature components & how they behave:** ranked bar rows animate in with `transform:scaleX` (0.62–0.8s, `--ease:cubic-bezier(.16,1,.3,1)`); the Mixing Board and heatmap are the two interactive widgets — chip groups (`.chips`) switch metric/normalization/person and re-render in place; everything else is static prose + cards.
- **Interaction patterns:** anchor-scroll via the new sticky pill nav; chip toggles; no modals, no forms, no toasts anywhere. Keep it that way unless a decision point says otherwise.
- **Tone of UI copy** (verbatim strings): masthead tape-label "Side A · Chat Superlatives"; sub "…counted, measured and ranked. Nobody asked for this."; sec-tags: "Every winner", "Find yourself", "Filter by person", "League language". Dry, archival, faintly menacing narrator. The new sections carry a small `DRAFT` chip (`.reg-tag-draft`).
- **Established states:** none needed — static content, no loading/empty/error states. NA chart rows render as striped bars ("insufficient sample"), the only "empty" idiom.

### 2c. Current information architecture

- **Top-level navigation / IA:** one page, 13 sections in fixed order (template line refs): masthead → sticky nav → `#closer` (The Off Switch, editorial) → `#awards` (The Full Roll, 11 award cards) → `#board` (Mixing Board, interactive) → `#heatmap` (When The Boarz Post, interactive) → `#bigword` → `#volume` (Motormouth triptych) → `#ballot` (All Talk dumbbell) → `#regulars` (NEW — 10 players × 3 cards) → `#glossary` (NEW — 6 long dictionary cards) → `#songs` (Track List: podium + ~160-row shared-links list) → `#trivia` (Loose Ends) → `#method` (methodology, caveats, definitions).
- **Where the user is when this feature becomes relevant:** the moment they open the link from the WhatsApp group — almost always **on a phone**. The scroll problem is worst there.

---

## 3. The feature — what & why

- **What it does:** Re-lays-out the existing content so any section is reachable in seconds and the page feels curated rather than endless. No content is being cut; density and structure change.
- **Core user value:** A league member can get to *their* stats, the newest bits (Regulars/Glossary), or the playlist without scrolling through everything else.
- **The one outcome it must deliver:** Radically less scrolling to reach any given piece of content, on a phone, without losing the editorial voice.
- **Scope — in / out / later:**

| In scope | Explicitly out | Later |
|---|---|---|
| Layout/IA restructure of all 13 sections | Rebranding, new color/type language | Planned new sections (§7): carrot-box season review, submitter-guessing ledger, per-player chatbot, polls |
| Compaction patterns (tabs/accordions/drill-ins/pivots — CD's call) | Changing the stats/analysis themselves | Recency-highlighting inside charts (separate task, but leave room) |
| Track-list reorganization (see D4) | Removing the interactive Board/heatmap | |

---

## 4. Where it lives — touchpoints & entry points

- **Existing screens/flows this feature touches:** the single Tape page (`/d/boarz-chat-superlatives/`); every section listed in §2c.
- **New entry points:** none — same shared URL from the group chat.
- **How it fits the current IA:** it *is* the IA change. The sticky pill nav (11 anchors) was added days ago as a stopgap; CD may replace or evolve it.
- **What it must not disrupt:** the URL; the self-contained single-file constraint (no SPA framework, no external requests); the two interactive widgets keep working; deep-linkable section anchors are nice-to-keep (assumption).

---

## 5. Users & jobs for this feature

- **Who uses this feature:** the 10 league members (named on every card) + the commissioner. Phone-first, arriving via WhatsApp link. No accounts, no auth.
- **Jobs-to-be-done**, priority order:
  1. Find *myself* — my awards, my Regulars cards, my rank on any chart.
  2. See what's new since last time (currently: Regulars, Glossary).
  3. Settle an argument — pull up one specific stat/quote mid-chat and screenshot it.
  4. Play the playlist / find a song someone shared.
- **Frequency & context:** bursty — heavy for a day or two after the link drops, then occasional argument-settling visits.
- **What they do today instead:** scroll. And give up (assumption, but it's why this brief exists).

---

## 6. Ideas to flesh out *(named by the team)*

### Idea A — "Make it compact; give us a few options"
- **The idea:** The team deliberately did **not** pick a mechanism. The entire ask, verbatim: "I want to look at an update to the UI for that content. I want the content to feel more compact — right now it's a huge scroll of stuff. I'd like it to require less scrolling. Ask Claude Design to give us a few options."
- **Why the team is interested:** the page doubled in length with the new sections and will grow again (§3 "Later" column).
- **Known constraints / how it should behave:** all content stays; single static file; phone-first.
- **Open questions about it:** which compaction family — see D1. CC's candidate families (for the canvas, not a constraint): (1) **Side A / Side B tabs** — split into 2–4 top-level views, leaning into the cassette metaphor; (2) **collapsed sections** — every section renders as a compact summary strip (winner + one number) that expands; (3) **dashboard + drill-in** — a dense bento overview up top, each tile opening the full section; (4) **player pivot** — a "find yourself" mode that filters the whole page to one member.

*(No Ideas B–D — the team named exactly one, intentionally open.)*

---

## 7. Open areas for CD to explore *(CC-identified)*

### Open area 1 — The layout must scale to what's coming *(proposed by CC)*
- **What it is & why it's worth a look:** four more content blocks are already planned: a carrot-box season review (editorial analysis), a submitter-guessing ledger (table-ish), a per-player chatbot (interactive, needs an obvious entry point), and polls. Whatever structure CD picks should have an evident slot for "another section of a new shape" without re-triggering this redesign.
- **How it relates:** it's the difference between compacting today's page and designing the page's *system*.

### Open area 2 — The Track List is a data problem, not just a layout problem *(proposed by CC)*
- **What it is:** ~160 shared links render as one flat chronological list. The owner separately asked (verbatim): "is there some way we can organize this, rank it — a big long list just doesn't seem as useful." Grouping/ranking axes available in the data: sharer, platform (Spotify/YouTube), share date, artist. See D4.

---

## 8. Existing patterns to honor / reuse

- **Components to reuse as-is:** `.sec-head`+`.sec-tag` header idiom; `.chips` filter groups (the established "switch what you're looking at" control — a natural fit for tabs/pivots); card idioms (`.award`, `.triv`, `.reg-card`, `.gl-card`); bar/heatmap chart classes.
- **Patterns to follow:** mono uppercase kickers for wayfinding; orange (`--mash-pulp`) strictly as the single accent; scaleX entrance animations; `1px var(--line)` hairline structure.
- **Things CD may extend, with care:** the sticky nav (replace freely — it's 3 days old); section ordering; the masthead (a compact header that survives scrolling could carry navigation).
- **Things CD should NOT touch / change:** the token palette and three-font system; the narrator voice and existing copy; the Mixing Board's and heatmap's interaction models; the single-file/no-framework/no-external-requests constraint.

---

## 9. Decision points to game out ⭐

### D1. The compaction model · **[Required — from team]**
- **The decision / question:** What is the page's structural mechanism for "less scrolling" — tabs/views, per-section collapse, overview-and-drill-in, player pivot, or a hybrid?
- **Why it matters:** it's the whole feature; every section inherits the choice; it sets the pattern for four planned future sections.
- **Options on the table:** the four families in §6 Idea A. CD may add or hybridize (e.g., tabs *plus* collapsed sections inside each tab).
- **Constraints from the existing system:** single static file (tab/accordion state is fine in vanilla JS; routing is not); phone-first; anchors ideally survive for share-links; the two interactive widgets must remain fully usable inside whatever container they land in.
- **What CD should put on the canvas:** 3–4 full-page options rendered **in-context as phone-width mockups** of the real content (use the actual section names, winners, and copy from the live page) — the owner explicitly asked to "look at a few options."
- **How we'll decide:** Matt picks by gut from the canvas; ease of implementation in a single vanilla-JS file is the tiebreak.

### D2. Regulars density · **[Proposed by CC]**
- **The decision / question:** 30 archetype cards (10 players × 3) are the single biggest scroll block. Per-player accordion? Player-chip selector showing one player at a time? Compact roster table that expands a card on tap? Horizontal card rail per player?
- **Why it matters:** it's the newest marquee content — it should feel like the star, not the reason you stopped scrolling.
- **Options on the table:** the four above; CD free to counter.
- **Constraints:** cards carry heterogeneous payloads (spotlight quotes, big tokens, alias-map pairs, quote rails) — the compact form must show *something* distinctive per card, not just a title.
- **What CD should put on the canvas:** 2–3 treatments using the real card content for two contrasting players (e.g., JB's alias map vs Shane's "Asshole" spotlight).
- **How we'll decide:** whichever keeps the jokes landing at a glance.

### D3. Glossary presentation · **[Proposed by CC]**
- **The decision / question:** Six (growing) long dictionary entries — keep full cards, or an index (term + one-line gloss) that expands/deep-dives per entry?
- **Why it matters:** entries are 200+ words each with labeled quotes; the glossary is designed to grow every season ("kept in perpetuity").
- **Constraints:** the Urban-Dictionary card structure (term/pronunciation/part-of-speech/definition/coined/stats/usages) is a deliberate running joke — the *full* form must survive somewhere.
- **What CD should put on the canvas:** 2 options: full-cards-with-collapse vs index-first.
- **How we'll decide:** scroll cost vs how often the full entry gets read (unknown — gut call).

### D4. Track List reorganization · **[Proposed by CC]**
- **The decision / question:** How to turn ~160 flat rows into something organized/ranked (owner's explicit ask): group by sharer with counts? filter chips (person/platform)? "top shared artists" summary + collapsed full list? weekly grouping?
- **Constraints:** data available per link: sharer, date, platform, resolved track metadata (title/artist/art). No play counts.
- **What CD should put on the canvas:** 2 options, one summary-first and one filter-first.
- **How we'll decide:** whichever makes the playlist CTA and "who shared what" both prominent.

### D5. Wayfinding & the header · **[Proposed by CC]**
- **The decision / question:** With D1 chosen, what carries navigation — evolved sticky pills, a real tab bar, a masthead that condenses on scroll, a floating "find yourself" control? And how do the DRAFT chips and any future "new since last visit" marker fit in?
- **Constraints:** phone-first thumb reach; the cassette masthead is beloved (assumption) — keep its spirit even if it shrinks.
- **What CD should put on the canvas:** fold into D1's mockups rather than standalone options.
- **How we'll decide:** with D1.

### D6. *(open stub — CD may add a decision it considers high-value)*

---

## 10. Constraints

- **Technical:** output must remain **one self-contained HTML file**: inline CSS/JS, vanilla JS only, no framework, no router, no external requests (fonts self-hosted at `./_app/fonts.css`). All state is in-page (hash/anchors OK, `localStorage` OK if wanted). Rendered by JS from an injected JSON blob — layouts must be expressible as template markup + small render functions. Album art lazy-loads.
- **Brand & consistency:** must still read as the Tape and as kin to the league's weekly digests — dark, mono-annotated, orange-accented, dry narrator.
- **Accessibility bar:** reasonable-effort — semantic headings, visible focus, contrast already strong on the ink scale; no formal audit. (assumption)
- **Risks / past problems with this area:** the page recently had duplicate awards from parallel render paths — any design that shows the same award in two places (summary + detail) must be explicit that it's *by design*, and the summary/detail must come from one source. Some editorial prose sections (e.g., The Off Switch) carry hand-written numbers that go stale when data refreshes — compact treatments that surface fewer hardcoded numbers age better.

---

## 11. Success criteria

- **How we'll judge the design is good:** Matt can hand the link to the group and nobody scrolls more than a couple of screens to hit what they came for; the page still gets screenshotted for the chat.
- **Metrics it should move:** none instrumented — no analytics on the page. Judged by feel and by group reaction.
- **What "fits the product" means, concretely:** dropped into the existing page, a new-section header, card, or control should be indistinguishable in voice and finish from the ones already there (§2b values, verbatim).

---

## 12. Deliverables & logistics

- **Fidelity expected:** high-fidelity mockups for the canvas (phone-width primary, desktop secondary), using real content lifted from the live page.
- **Variations wanted, and on what:** 3–4 on D1 (the owner's explicit "a few options"); 2–3 each on D2–D4.
- **Deliverable format:** Handoff packet per `Handoff-Packet-Manifest.md` (zip) + kickoff prompt for CC. Additions: none.
- **Review cadence:** single async review by Matt; expect one round of "mix option 2's nav with option 3's regulars."

---

## 13. Open questions & unknowns

- Scope ambition: treated here as a **conservative restructure** — same content, same brand, new structure. (assumption — Matt asked for options to *look at*, not a committed rebuild; CD should not propose a rebrand.)
- Should the Off Switch–style long editorial essays stay full-length or get the same compact treatment? (unknown — needs decision; they're the narrator's showcase.)
- Do section anchors need to keep working for old shared links? (assumption: yes, cheap to preserve.)
- Is the "Side A" label a hook CD may build the whole structure around (Side A/Side B tabs), or just flavor? (unknown — Matt will react on the canvas.)
- Desktop: is ultrawide worth any layout effort, or is phone + ordinary laptop enough? (assumption: phone + laptop; no ultrawide-specific work.)

---

## Appendix — file map & references

- **Design tokens:** `ui/scripts/chat-superlatives.template.html` L12–27
- **Component idioms/CSS:** same file, L11–345 (incl. new `.nav`/`.reg-*`/`.gl-*` blocks near the end of the style tag)
- **Markup & section order:** same file, L346–640 (section ids listed in §2c)
- **Render JS:** same file, L641–1194
- **Editorial content:** `ui/scripts/chat-tape-editorial.json` (Regulars + Glossary schemas visible by example)
- **Build/publish:** `ui/scripts/build-chat-superlatives.mjs` → `digests/d/boarz-chat-superlatives/index.html` (live on rebuild)
- **Original spec:** `docs/superpowers/specs/2026-07-27-chat-superlatives-design.md`
- **Live page:** https://digest.mattmariani.com/d/boarz-chat-superlatives/
