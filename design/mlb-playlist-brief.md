# Feature Design Brief — MLB Playlist (page + WhatsApp share)

> **For:** Claude Designer (CD) · **Written by:** Claude Code (CC) · **Product:** music-league-bot
> **Feature:** The "MLB playlist" — a per-round music-video page on digest.mattmariani.com, plus the WhatsApp share image that carries it
> **Date:** 2026-09-07 · **Brief version:** 1
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

- **Product:** a WhatsApp bot + web app for a private Music League group — it ingests each
  round, writes an illustrated weekly digest, and posts playlists and artwork into the
  league's group chat.
- **The feature, in one sentence:** a per-round **music-video playlist** published as a public
  page at `digest.mattmariani.com/p/<slug>/`, shared into WhatsApp as an image + link, where
  league members can rate videos, crown a winner, and post a comment back into the group chat.
- **Why now:** Second Best's round **R143 "I Want My MTV"** (theme: *"Songs with memorable or
  standout music videos. Include the link to the video in the comment."*) closes 2026-09-09.
  It's the first round where the video *is* the submission, and a Spotify/YTM audio playlist
  cannot represent it.
- **Who reviews / decides:** Matt (sole owner/operator; also a player in the league).
- **Deadline / milestone:** R143's voting opens ~2026-09-09. A read-only version of the page is
  already live; the rating/comment layer is what this brief is mostly about, so it is
  **not** hard-blocked by that date.

### 1a. Status — what already exists vs. what CD is designing

A **read-only v0 of the page is live and shipped**, built by CC as a placeholder to see how the
shape feels. CD should treat it as *evidence of the content model, not as a design to preserve*.

- Live example (real data, 12 videos): **https://digest.mattmariani.com/p/EZK9K3sLDghPVVdv84GMsA/**
- Generator: `ui/src/lib/ytm/playlistPage.ts` (`buildPlaylistPageHtml`)
- The WhatsApp share image that currently accompanies it:
  `ui/src/lib/ytm/videoCover.ts` (`buildVideoCoverHtml`)

**CD is designing:** the real playlist page UI, the rating / winner-stamp / comment / identity
layer on it, and **three** WhatsApp share concepts.

---

## 2. Repo orientation

- **What the codebase is:** TypeScript monorepo-ish. A Node WhatsApp bot (`src/`), a **SvelteKit
  5 app** (`ui/`, runes syntax — `$state` / `$derived` / `$props`) that is both the admin UI and
  the renderer for all published artifacts, and host-run Node scripts (`scripts/`). SQLite
  (better-sqlite3) throughout, one file: `data/league.db`.
- **How to run / view it:** `cd ui && npm run dev` (port 5173) for the admin app. The published
  page is a **static file**, so the fastest loop is to render the HTML and open it directly.
  Production runs under docker compose (`bot`, `api`, `bot-ui`, `digest-static`).
- **Key directories:**
  | Path | What's there |
  |---|---|
  | `ui/src/lib/ytm/` | This feature's server code: `playlistPage.ts`, `videoCover.ts`, `videoReview.ts`, `send.ts` |
  | `ui/src/routes/ytm/[roundId]/videos/` | Matt-only review screen (curation *before* publishing) |
  | `ui/src/lib/digest/` | The weekly digest renderer — the richest existing "published artifact" surface |
  | `digests/` | The volume `digest.mattmariani.com` serves, read-only |
  | `design/` | Prior CD briefs; `design/ytm-cover-brief.md` is the direct precedent |
  | `Caddyfile.digest` | Routing for the public host; `/p/*` is this feature's namespace |

### 2a. Design system, as implemented

- **System in use:** **Mash Co. Design System — music-league slice.** Bundled in-repo as a
  Claude Design handoff.
  - Bundle root: `data/Mash Co. Design System-handoff/mash-co-design-system/`
  - **Tokens:** `project/music-league/colors_and_type.css` (105 custom properties)
  - **Component CSS:** `project/music-league/ml-styles.css` (all classes prefixed `.ml-`)
  - **Prototypes:** `project/music-league/ml-home.jsx`, `ml-round.jsx`, `ml-screens.jsx`,
    `ml-shared.jsx`, `design-canvas.jsx`
  - Its own README says: read the primary design file top to bottom and follow its imports.
- **Where tokens live in the app:** `ui/src/app.css` (Tailwind theme layer mirroring the tokens
  above — `bg-surface`, `text-fg-muted`, `border-border-muted`, `text-accent`, etc.)
- **Component library:** `ui/src/lib/components/` — `CollapsiblePanel`, `StatusChip`,
  `SectionLabel`, `DeadlineChip`, `DotIndicator`, `SongRatingBars`, `YtmPlayButton`.
  *(assumption: these are admin-app components; the public page is standalone HTML and cannot
  import them — see §10 Technical.)*
- **Icon set:** none. The app uses **text glyphs and emoji** (`▶`, `▲`, `♪`, `★`, `📺`, `🎧`).
  *(unknown — needs decision: whether CD may introduce a real icon set for this surface.)*
- **Fonts in use:** self-hosted, served from the same public host at
  `/d/boarz-chat-superlatives/_app/fonts.css`:
  - **Bricolage Grotesque** — display (800, often italic, tight tracking)
  - **Inter Tight** — body
  - **JetBrains Mono** — labels, metadata, all-caps micro-copy

### 2b. Existing visual & interaction vocabulary

**Colour (actual values, from `music-league/colors_and_type.css`):**

| Token | Hex | Role |
|---|---|---|
| `--mash-pulp` | `#ff5b2e` | primary accent — "meat red", signals action |
| `--mash-pulp-deep` | `#d94c23` | pressed / hover-darken |
| `--mash-pulp-edge` | `#8a2d15` | dark edge that gives the logo dimension |
| `--ink-0 … --ink-9` | `#07090c` `#0d1116` `#141921` `#1c232c` `#283039` `#3a4451` `#5a6773` `#8b97a4` `#c2cad3` `#f1f4f7` | page bg → panel → card → hover → line → strong line → quiet fg → muted fg → body fg → bright fg |
| `--bone` | `#faf7f2` | warm white for brand surfaces / text on pulp |
| `--moss` / `--amber` / `--ember` / `--sky` | `#3ec27a` `#e8a83a` `#e6566c` `#5aa3ff` | success / warning / error / info |

**Dark-first, and there is no light mode.** One accent only — pulp orange on near-black.

**Type scale:** `--fs-xs 12px` · `sm 13` · `md 15 (base)` · `lg 17` · `xl 20` · `2xl 26` …
Display headings use Bricolage 800 with `letter-spacing:-.02em` and `text-wrap:balance`.
Mono is used at 10–12px, uppercase, `letter-spacing:.1–.24em` for every label and metadata line.

**Signature moves already in the shipped artwork** (worth honouring or deliberately breaking):
- Rotated **pulp rubber-stamp** over a tiled image grid (the audio cover's variant `1e`,
  and the video cover's `THE VIDEOS / ACCURACY NOT GUARANTEED` stamp).
- **Pulp-orange mono kicker** above a big display headline.
- Cards: `--surface` fill, 1px `--line` border, ~0.6rem radius.
- Chips/badges: 1px border in the semantic colour, mono uppercase ~0.6rem.

**Tone of UI copy** — dry, plain, faintly deadpan. Real strings from the code:
- `"ACCURACY NOT GUARANTEED"` (video cover stamp)
- `"Needs your call"` / `"Long shots"` / `"Found automatically"` (review screen section heads)
- `"No video for this one"` (a real answer, not an absence)
- `"…if one is wrong, that is why."` (page footer)
- `"🎧 *<round>* — this week's playlist, now for the YouTube Music crowd:"` (WhatsApp caption)

The league's own register is **profane comedy** — round names like *"I Hope You Shit Your Pants
at Target"* are normal. The product voice is drier than the league's, and that contrast is
deliberate.

**Established states:** loading is usually a disabled control with `…` appended
(`{busy ? 'Working…' : 'Save'}`); errors are a bordered `--ember` strip with plain-language
text; success is a `StatusChip` reading `SAVED`.

### 2c. Current information architecture

Two separate hosts, and the distinction matters:

| Host | Access | Purpose |
|---|---|---|
| `mlbot2.mattmariani.com` (bot-ui) | **behind Cloudflare Access — Matt only** | admin app, curation, the review screen |
| `digest.mattmariani.com` (digest-static) | **public, no auth**, Caddy over a read-only volume | digests `/d/<slug>/`, b-side league pages `/<slug>/`, **and this feature `/p/<slug>/`** |

**Where the user is when this becomes relevant:** in the WhatsApp group, on a phone, tapping a
link the bot posted. That is the *only* entry point. Nobody navigates to this page.

---

## 3. The feature — what & why

- **What it does:** presents a round's music videos as a page that says more than a YouTube
  playlist can — which *song* each video belongs to, **who chose it** (the submitter's own link
  vs. something the machine found), and how confident the machine was — then lets the league
  react without leaving it.
- **Core user value:** watch the round's videos in one place, and argue about them.
- **The one outcome it must deliver:** a league member who taps the link from WhatsApp
  immediately understands *this is our round's videos* and can start watching in one tap.

| In scope | Explicitly out | Later |
|---|---|---|
| The playlist page UI | The WhatsApp caption copy & send mechanics (built) | Comment threads / replies to replies |
| Thumbs up / down per video | The Matt-only review screen at `/ytm/…/videos` (built, admin-only) | Live vote counts updating without reload |
| A **"Second Best stamp"** marking the #1 video | The audio (YTM) drop cover — see `design/ytm-cover-brief.md` | Cross-round "best videos ever" archive |
| Add a message to a video + send it to WhatsApp | Anything about how the videos are *chosen* (built) | Identity beyond the honour system |
| Identify-yourself UI | Light mode (there isn't one) | |
| **3 WhatsApp share image concepts** | | |

---

## 4. Where it lives — touchpoints & entry points

- **New surface:** `digest.mattmariani.com/p/<slug>/` — one self-contained page per round.
  Namespace added in `Caddyfile.digest`; slugs carry 16 bytes of entropy, so a page is
  **unlisted, not secret** (the link is pasted into a group chat and could be forwarded).
- **Entry point:** a single WhatsApp media message — the share image with a caption + link.
  There is no navigation, no home page, no way to browse to other rounds *(unknown — needs
  decision: whether the page should link onward to the league's b-side page or the digest).*
- **What it must not disrupt:** the `/d/` digest namespace and the top-level `/<slug>/` b-side
  league pages share this host. `/p/` was chosen so a re-rendered digest can never overwrite a
  playlist page.

---

## 5. Users & jobs

- **Who:** the **13 players** of the Second Best league. Non-technical, all on phones, all in
  one WhatsApp group. Matt is one of them *and* the operator.
- **Jobs-to-be-done, priority order:**
  1. Watch the round's videos without leaving the page.
  2. See which video was *the point* — who nailed the brief.
  3. React (thumbs) and say something funny about a specific video.
  4. Get that funny thing into the group chat where everyone will actually see it.
- **Frequency & context:** once a week per league, in a burst — most traffic in the hours after
  the bot posts. Read on a phone, likely one-handed, quite possibly on the toilet.
- **What they do today instead:** paste YouTube links into WhatsApp and lose them in the scroll.

---

## 6. Ideas to flesh out *(named by Matt)*

### Idea A — Three WhatsApp share concepts, escalating ambition
- **The idea:** the share image is what sells the page. Matt wants **three** concepts, explicitly
  spanning a risk gradient:
  1. **Simple** — close to the existing video cover (`videoCover.ts`): thumbnail grid + stamp.
  2. **More stylized** — same job, considerably more design.
  3. **Swing for the fences** — genuinely clever. Matt's own prompt: *"could it maybe somehow
     mimic the design of a YouTube watch window?"* — a fake player chrome, a scrubber, a
     suggested-videos rail. He is unsure about it and wants to see it tried.
- **Why interested:** the current cover works but is one idea; this is a weekly recurring asset
  and deserves range.
- **Constraints:** see §10 — 1:1 canvas, deterministic HTML/CSS render, no per-round AI art.
- **Open questions:** does the fake-YouTube-chrome idea read as clever or as broken UI at
  350px wide in a chat bubble? Does it survive WhatsApp's compression?

### Idea B — Thumbs up / down per video
- **The idea:** each video gets an up and a down vote, open to anyone with the link.
- **Why interested:** cheap, universally understood, and it produces the ranking Idea C needs.
- **Constraints / behaviour:** *(unknown — needs decision)* whether a person's vote is visible
  to others, whether tallies are public before some cutoff, and whether you can change your vote.
- **Open questions:** does the down-vote need to exist? This is a group of friends; a visible
  negative tally on a person's pick has social weight that a private one doesn't.

### Idea C — The "Second Best stamp" — a stamp of approval on the #1 video
- **The idea:** the top-rated video is crowned with a **stamp**, in the league's own name
  ("Second Best"). Matt described it as *"a stamp of approval — ie the number 1 video in the list."*
- **Why interested:** the product already has a rubber-stamp vocabulary (the cover's rotated
  pulp stamp); this extends it into the UI and gives the page a payoff.
- **Constraints:** must degrade — early on, nothing has enough votes to crown *(assumption:
  there is a "no winner yet" state; CD should design it)*.
- **Open questions:** is the stamp *live* (moves as votes come in) or *settled* (awarded at a
  cutoff)? Does a tie show two stamps or none?

### Idea D — Add a message to a video, and push it to WhatsApp
- **The idea:** on a video, write a short message; a button turns it into a WhatsApp post from
  the bot carrying **the song, the link, the message, and who wrote it**.
- **Why interested:** it closes the loop back to where the league actually lives. The page is
  where you *look*; the chat is where you *talk*.
- **Constraints (decided):** the message does **not** post directly. It queues for Matt's
  approval — he releases it, exactly like the existing digest and video-review approval flows.
  So the page needs a credible **"sent for approval"** state, not a "posted!" state.
- **Open questions:** does the author see their pending message on the page afterwards? What
  happens visually if Matt rejects it?

### Idea E — Identify yourself, once, before the list
- **The idea:** you pick who you are from the league roster. Matt's instinct, quoted:
  *"i sort of think it should be once at the top before you see any of the list - maybe?"* —
  note the "maybe"; he is genuinely unsure.
- **Why interested:** votes and messages are meaningless unattributed, and the group is 13
  known people, not the public.
- **Constraints:** it is an **honour system** — there is no login and there will not be one.
  Anyone can claim to be anyone.
- **Open questions:** the whole shape. A hard gate before the list, a soft prompt on first
  interaction, or a persistent "you are ___" chip? A gate costs every reader a tap before they
  see anything; deferring it costs a tap at the moment of action instead. **This is D2.**

---

## 7. Open areas for CD to explore *(proposed by CC)*

### Open area 1 — The provenance badge is the page's whole reason to exist *(proposed by CC)*
Each video currently carries one of `submitter's pick` / `found by search · 70%` / `added by
hand`. That distinction is the one thing this page has that a YouTube playlist does not: it is
honest about which videos a machine guessed at. In v0 it is a small bordered chip, which
under-sells it.

It also carries an unresolved tension: **a confidence percentage is a strange thing to show
civilians.** 70% means something precise to the system and nothing to a reader. CD should decide
whether it becomes a word, a shape, a texture, a degree of visual confidence — or disappears
entirely for everyone except Matt.

### Open area 2 — This page has no empty, error, or "not yet" states *(proposed by CC)*
v0 assumes a happy path. Real ones that will occur:
- A round where **every** video came from a submitter's comment (no guesses at all) — the
  provenance badges all say the same thing and the accuracy footnote is pointless.
- A round with **one** video, or with 30.
- A video that has since been **deleted or made private** on YouTube — the thumbnail 404s and the
  embed shows YouTube's own error. This *will* happen to older rounds.
- Nobody has voted yet, so there is no stamp.

---

## 8. Existing patterns to honor / reuse

- **Reuse as-is:** the Mash Co music-league tokens (colour ramp, type scale, the three fonts);
  the mono-uppercase-kicker + big-display-headline header; card = surface fill + 1px line +
  0.6rem radius; chips as 1px bordered mono uppercase.
- **Patterns to follow:** the rotated pulp rubber-stamp as the product's signature "verdict"
  device — the Second Best stamp (Idea C) should feel like a member of that family; disabled +
  `…` for in-flight actions; plain-language `--ember` strips for errors.
- **May extend, with care:** the stamp vocabulary; the badge system; the page may introduce
  motion (there is essentially none today) if it earns it on a phone.
- **Do NOT touch:** the audio drop cover (`design/ytm-cover-brief.md`, variant `1d` shipped and
  live weekly); the digest's own visual language; the Matt-only review screen.

---

## 9. Decision points to game out ⭐

### D1. How far does the WhatsApp share push? · **[Required — from team]**
- **The decision:** three concepts across a deliberate risk gradient, and which one ships.
- **Why it matters:** this image is the *entire* invitation. It appears weekly in a chat where
  a 🎧 audio-drop cover already appears — the two must be siblings, distinguishable at a glance,
  and neither may be mistaken for the other.
- **Options:** (1) close to today's grid+stamp; (2) markedly more stylized; (3) fake
  YouTube-watch-window chrome, or something equally clever.
- **Constraints:** 1:1, rendered 640×640 from deterministic HTML/CSS, WhatsApp re-compresses it,
  and it must survive as a ~48px chat-list preview. See §10.
- **What CD should put on the canvas:** all three, each shown **twice** — full size, and mocked
  inside a WhatsApp bubble on a phone at real scale. Include a chat-list-thumbnail crop.
- **How we'll decide:** Matt picks; the tiny-preview legibility is the tiebreaker.

### D2. Where does "who are you?" happen? · **[Required — from team]**
- **The decision:** a hard identity gate before the list, a soft prompt at first interaction, or
  an always-visible identity chip.
- **Why it matters:** it is the first thing every reader hits, on a phone, arriving from a chat.
  A gate makes attribution reliable and costs every passive reader a tap for nothing. Deferring
  makes the page instantly readable and risks unattributed or lazily-attributed reactions.
- **Options:** (a) full-screen roster picker first; (b) read freely, prompted on first
  vote/message; (c) persistent chip in the header, "you are ___ / change".
- **Constraints:** honour system, no auth, 13 known names. Choice should persist locally so it is
  asked once per person, not once per visit.
- **What CD should put on the canvas:** each option as a real first-30-seconds sequence on a
  phone. Matt leans (a) but explicitly said "maybe".
- **How we'll decide:** which one a distracted person in a group chat gets through fastest
  without lying about who they are.

### D3. What do thumbs and the Second Best stamp look like, and when? · **[Required — from team]**
- **The decision:** the rating control, the tally's visibility, and how the winner is crowned.
- **Why it matters:** it is the page's main interaction and its payoff. Also social: a visible
  down-vote tally on a friend's pick lands differently from a private one.
- **Options:** live tallies vs. hidden-until-cutoff; up-only vs. up/down; the stamp as a live
  crown that moves vs. a settled award.
- **Constraints:** must have a credible **"no winner yet"** state; must handle a tie; the stamp
  should read as kin to the existing rotated pulp stamp.
- **What CD should put on the canvas:** the same list in three states — nothing voted, mid-vote,
  settled with a stamp — plus a tie.
- **How we'll decide:** whether it stays fun when your pick is losing.

### D4. How honest is the page about machine guesses? · **[Proposed by CC]**
- **The decision:** what happens to the provenance badge and its confidence score.
- **Why it matters:** it is this page's differentiator *and* a potential embarrassment — R141's
  live data has a 10%-confidence pick sitting in the list. Over-showing it makes the product look
  unreliable; hiding it makes the page a worse YouTube playlist.
- **Options:** keep the raw percentage; translate to words ("sure" / "probably" / "a guess");
  express as visual confidence (opacity, border weight); show only when it's low; hide entirely
  from players and keep it for Matt.
- **Constraints:** three real sources — `comment` (a person chose it), `search` (with a 0–100
  score), `manual` (Matt added it by hand). Real R141 scores: 100, 80, 75, 75, 70, 55, 55, 45,
  30, 30, 30, 10.
- **What CD should put on the canvas:** one list rendered 3–4 ways, using the real R141 data.
- **How we'll decide:** would a player trust this page more or less after reading the badges.

### D5. Does the page carry the video, or hand off to YouTube? · **[Proposed by CC]**
- **The decision:** in-page embeds vs. thumbnails that jump to YouTube vs. a "play them all" hand-off.
- **Why it matters:** it decides whether this is a *destination* or a *launcher*, which changes
  everything about the layout. Note the constraint below — it may decide itself.
- **Options:** tap-to-embed in place (v0's behaviour); grid of thumbnails that all open YouTube;
  a single hero player with a playlist rail (pairs naturally with the D1 concept 3).
- **Constraints:** **some music videos forbid embedding** and will fail inside an iframe with
  "Watch on YouTube" — a design that leans entirely on in-page playback needs a fallback.
  A "Play them all" link already exists and works (YouTube temporary playlist, titled).
- **What CD should put on the canvas:** at least the hero-player and the grid, on a phone, and
  what a blocked-embed video looks like in each.
- **How we'll decide:** whether people watch on the page or bounce.

### D6. *(open stub — CD to top up)*

---

## 10. Constraints

**Technical — the hard ones:**
- The page is a **single self-contained static HTML file** per round, written to a read-only
  volume and served by a dumb Caddy. **No framework, no build step, no bundler, no server-side
  rendering at request time.** Inline CSS and inline JS only. External assets limited to: the
  shared font stylesheet on the same host, and YouTube thumbnails (`i.ytimg.com`).
- Generated by a **TypeScript template function** (`buildPlaylistPageHtml`) — CD's output must be
  expressible as a string template over per-round data. Deterministic; no per-round AI art.
- **Writes need a backend the page does not currently have.** Votes, messages and identity all
  require a public write API. `digest.mattmariani.com` is static; the app is behind Cloudflare
  Access. The plan is a narrow Caddy reverse-proxy to bot-ui. *This is not built yet* — CD should
  design as if it exists, but keep the number of distinct write actions small.
- **Share image:** 1:1, rendered at 640×640 by headless Chromium from HTML/CSS (full CSS —
  filters, gradients, blend modes, masks, grids). Raster inputs fetched and inlined ahead of the
  render. WhatsApp re-compresses on send.
- **Phone-first, hard.** Nearly all traffic is a phone opening a link from a chat.

**Brand & consistency:** must read as the same product as the weekly digest and the audio drop
cover, while being clearly a *different object* from the audio cover in the same chat.

**Accessibility bar:** *(assumption — no formal bar exists in this repo)* CD should hold to:
4.5:1 on body text, hit targets ≥44px, no colour-only encoding of vote state or provenance,
and legibility at 350px width in bright daylight.

**Risks / past problems:**
- WhatsApp renders a link preview for only **one** link per message — a design implying two
  equal links will lose one.
- YouTube titles arrive HTML-encoded and have already caused double-escaped mojibake once.
- The audio and video covers were nearly indistinguishable as chat thumbnails; the current video
  cover was deliberately made rectangular-stamped and tilted the *other* way to fix that.

---

## 11. Success criteria

- **Good looks like:** a player taps the link, understands in under two seconds that these are
  our round's videos, and starts watching without pinching, scrolling past chrome, or reading
  instructions.
- **Metrics it should move:** *(no analytics exist — none are instrumented)* the honest measures
  are: does anyone use the thumbs, and does a message actually make it back into the group chat.
- **"Fits the product" means:** side by side with the weekly digest and the audio-drop cover, all
  three read as the same hand — the pulp accent on near-black, the mono kicker, the display
  headline, the stamp as verdict.

---

## 12. Deliverables & logistics

- **Fidelity:** high for the share concepts (they ship as pixels); **structural** for the page —
  layout, states and the interaction model matter more than final pixel polish, since the
  underlying comment/identity backend is still unbuilt.
- **Scope ambition (decided, and it differs by surface):**
  - **Page — conservative first pass.** Keep the v0 content structure recognisable and add the
    new controls carefully. The logic beneath it is unbuilt and unproven; the design should not
    outrun it. Favour the simplest viable choice and defer speculative richness.
  - **WhatsApp share — swing for the fences on concept 3.** The cost of a wild idea there is one
    image.
- **Variations wanted:** 3 share concepts (D1); the page's rating/stamp states (D3); the identity
  placements (D2); the provenance treatments (D4).
- **Worked example:** use **R141 "This is the Tale of Captain Jack Sparrow"** (Second Best,
  nautical theme) — it is live with real data and CD can view it. Real contents, in page order:

  | # | Song | Artist | Source | Score | Channel |
  |---|---|---|---|---|---|
  | 1 | Where Is My Mind? | Pixies | search | 70 | PixiesOfficial |
  | 2 | Petrov, Yelyena and Me | Flight of the Conchords | search | 30 | McTezTube |
  | 3 | The Mollusk | Ween | search | 30 | TubeVisionDotCom |
  | 4 | Au Pays du Cocaine | Geese | **comment** | 100 | — |
  | 5 | Barrett's Privateers | Stan Rogers | search | 45 | The Wellermen |
  | 6 | Island Glow | Dirty Heads | search | 75 | Dirty Heads |
  | 7 | Brandy (You're a Fine Girl) | Looking Glass | search | 80 | LookingGlassVEVO |
  | 8 | Gilligan's Island Theme (Dark Metal Version) | SethDrums | search | 55 | SethDrums |
  | 9 | Smooth Sailin' | Leon Bridges | search | 75 | LeonBridgesVEVO |
  | 10 | (The Bonnie) Shoals of Herring – 1993 Remaster | The Dubliners | search | 10 | TheNightVisitor |
  | 11 | Another New World | Josh Ritter | search | 30 | building55 |
  | 12 | Travel Is Dangerous | Mogwai | search | 55 | OurCeasingVoice |

  Note the shape of it: long titles, one submitter pick among eleven guesses, a 10% embarrassment
  at #10. **R143 "I Want My MTV"** is the round this was built for and will invert that ratio —
  mostly submitter picks — so design for both.
- **Deliverable format:** handoff packet per `Handoff-Packet-Manifest.md` (zip) + kickoff prompt
  for CC.
- **Review cadence:** Matt reviews the canvas, settles D1–D5, then reviews the full design once.

---

## 13. Open questions & unknowns

- **The write API does not exist yet.** Every interactive idea here assumes a public endpoint
  that has not been built. CD should design it; CC will build to the design.
- **Identity is unsolved and Matt knows it.** He has floated per-person challenge questions
  drawn from player dossiers, with a *"(suspected impersonator)"* tag for wrong answers, and
  IP-derived geolocation as corroboration. **The geolocation idea is flagged as needing a
  deliberate decision** — it means collecting location data on friends — and is **out of scope
  for this brief.** The challenge-question idea may be worth a design option; the roster picker
  is the baseline.
- Should the page show **vote tallies live**, or only after a cutoff? (D3)
- Is there any link **onward** from this page — to the round's digest, the b-side league page,
  or previous rounds' playlists? None exists today.
- Does the page need to work when opened **weeks later**, once videos have been deleted? (§7)
- Is there a **desktop** view worth designing, or is phone-only honest? *(assumption: phone-only
  in practice, but it is a plain web page and will occasionally be opened on a laptop.)*
- No analytics, no error reporting, no consent/cookie mechanism exists on this host.

---

## Appendix — file map & references

**Design system**
- `data/Mash Co. Design System-handoff/mash-co-design-system/README.md` — bundle instructions
- `…/project/music-league/colors_and_type.css` — **the tokens** (105 properties)
- `…/project/music-league/ml-styles.css` — component CSS, `.ml-` prefixed
- `…/project/music-league/ml-round.jsx`, `ml-home.jsx`, `ml-shared.jsx` — prototypes
- `ui/src/app.css` — the Tailwind theme layer the live app uses

**This feature, as currently built**
- `ui/src/lib/ytm/playlistPage.ts` — the live page generator (v0, read-only)
- `ui/src/lib/ytm/videoCover.ts` — the current WhatsApp share image
- `ui/src/lib/ytm/videoReview.ts` — data model: `VideoPick`, `VideoCandidate`, bands, sources
- `ui/src/lib/ytm/send.ts` — how the WhatsApp message is assembled and posted
- `ui/src/routes/ytm/[roundId]/videos/+page.svelte` — Matt-only review screen (admin vocabulary)
- `Caddyfile.digest` — public host routing, incl. the `/p/*` namespace

**Precedent & context**
- `design/ytm-cover-brief.md` — the audio drop cover brief; **read this first**, it is the direct
  sibling and its constraints section still applies
- `design/digest-flavor.md` — the product's written voice
- `ui/src/lib/components/` — admin component inventory (not importable by the static page)
- Live v0 page: https://digest.mattmariani.com/p/EZK9K3sLDghPVVdv84GMsA/
