---
title: History Research Tool — Song & Theme Research Surface
aliases:
  - history-research-tool
  - history-tool
  - round-history-rework
type: session
session_type: brainstorm
project: music-league-bot
milestone: ""
phase: ""
status: first-pass
created: 2026-06-06
updated: 2026-06-06
domain: tooling
tags:
  - brainstorm
  - music-league-bot
  - session
  - history
  - research
  - ui
related:
  - - music-league-bot
parent:
  - - music-league-bot
---

> [!abstract]- 📋 Session Dashboard
> | Field | Value |
> | :--- | :--- |
> | **Status** | `VIEW[{status}]` |
> | **Project** | `VIEW[{project}]` |
> | **Domain** | `VIEW[{domain}]` |
> | **Created** | `VIEW[{created}]` |
> | **Updated** | `VIEW[{updated}]` |

# History Research Tool

**Status:** first-pass (2026-06-06).

Reworks the **"Round history" → "History"** nav item into a **research & brainstorming tool** for picking a song to submit. The lens is the corpus of songs **already submitted or mentioned** across the leagues we've been in, plus fresh Spotify search — every result visually flagged by its history so you can see at a glance which candidates are "affected" by past play. Results promote into the existing **shortlist** and **head-to-head** sections.

Built on a strong existing base (so this is mostly assembly, not greenfield): a Spotify search endpoint (`ui/src/routes/api/spotify/search/+server.ts`) + client-credentials client; the **shortlist** (`research_songs` + `/shortlist` + `ShortlistRow.svelte`, with collapse/expand + `MiniDna`/`ScoreChip` + a `submittedElsewhere` flag); **head-to-head** (`head_to_head_matches`, candidates drawn from `research_songs`); and the corpus itself in **`ml_submissions`** (every submitted song, album art, across rounds/seasons) + **`chat_songs`** (mentions).

---

## Structure — tabbed subscreens

History is a **tabbed screen** (a few subscreens):

### Tab 1 — Song search
Spotify search → song cards. **Reuse the existing card/promotion UI from the Chat Watcher screen** (`ResearchList.svelte` + `SongRatingBars` etc.), which already supports the two promotion targets:
- **Add to shortlist** = the big "saved songs" list (the `research_songs`/shortlist corpus).
- **Add to a specific round's list** = a round-scoped candidate list.
Layer the **history visual encoding + badges** (below) onto those cards; cards are **shortlist-style collapsed → expand**. Also feeds **head-to-head**.

### Tab 2 — Theme research (NEW — being brainstormed)
**Anchor:** pick the **currently active round for a league** (these are selectable as research seeds) OR a **free-text search box**; supports researching **upcoming themes**. Active-round-per-league already partly exists (`currentRoundId`/`currentRoundPhase` in `layout.ts`; seasons `status: active`) but we want **manual control** to accurately mark each league's active/upcoming round.
**Flow:** seed theme → **theme-property-tag overlap** (see *Theme tags* below — **no LLM needed for v1**; LLM optional augment later) finds historically related themes → for each, surface songs that **did well** + songs that **did poorly** → reveal the **telling comments** (high-point voters + <1/zero voters) — for insight & inspiration. From those songs you can promote (shortlist / round list / h2h), tying back to Tab 1.

### Tab 3 — Player research (NEW)
Aggregate everything we have on **every player we've played with** → review per-player summaries to understand their tendencies. **Phase-1 = objective, numbers-only (NO semantic analysis):** songs submitted, votes given out (up/down where available), comment counts (Music League + chat), results/placements. The subscreen lets you review: *here are the songs this player submitted · here are the votes this player gave out* → read their tendencies.
- **Future phases:** richer analysis — genres, release-date distribution, popularity, style — and eventually **player research as an INPUT to theme research** (exact mechanism TBD; phase 2/3/4 of theme research).
- **In this first batch:** establish the concept + the basic numbers-only summaries, even if vastly simplified.

## Active-round management (foundational)
The app must clearly know **which leagues are currently being played** and hold a **clear "active round" slot per active league** (these are the seeds Tab 2 researches for). Active-round detection exists (`currentRoundId`/`currentRoundPhase`) but needs **manual control**:
- A way to **mark leagues as active**.
- An **active-round screen** showing one slot per active league.
- If a league is active but the system can't resolve its active round → a **modal warning: "No active round — choose from this list, or create a new round now"** (button).
- **Creating/setting a round includes setting its dates** (submission/voting deadlines — load-bearing for the automated setup; same deadline gap we hit with S4/S2/r70).

## Theme tags (the similarity engine — replaces LLM for v1)
Themes get **property tags** so similarity = **tag overlap**, no LLM needed for the first pass. Some themes already carry tags in places — lean into it and define a **tag taxonomy of theme "properties":**
- **semantic** — based on a song's title, lyrics, or what it's "about" (most common).
- **musicality** — musical content (bass-heavy, BPM/tempo, key, production).
- **energy / feel** — mood/vibe (chill, hype, melancholy).
- **instrument** — features a specific instrument.
- **artist** — about who created/performed it (one-hit wonders, a specific artist/era).
- *(extensible — add categories as patterns emerge.)*

A theme can carry **multiple tags**. Similar themes = high tag overlap (optionally weighted). LLM stays an *optional later augment*, not a v1 dependency.

---

## Card model (locked — mirror shortlist)

- **Collapsed row:** small album art · title/artist · compact status · (history encoded visually). One open at a time; Esc collapses.
- **Expanded:** big art, album/year, explicit · popularity · duration, the **corpus-history detail panel** (every appearance: league/season/round · who submitted · points; plus chat mentions with the quote), and **promote actions** (+ Add to shortlist, + Head-to-head, ▶ Play on Spotify).

## Visual language — "me vs others" (LOCKED)

Principle: **hue = what kind of history · weight = whose action.** Crucially, MY history and OTHER players' history use a clearly different visual register so I can instantly see which songs are affected by *my* past actions vs *others'*.

- **Border:** MINE = bold solid · OTHERS = dotted.
- **Fill:** flat background opacity (no gradient) — **MINE = 25%, OTHERS = 10%** of the hue (tweakable). Flat keeps it simple/legible (gradients read as "more X on one end").

| Hue | Meaning | Mine | Others |
| :-- | :-- | :-- | :-- |
| 🔴 Red | **Song was submitted** | you submitted it — bold solid red outline + faint fill | someone else submitted it — dotted red + more-opaque red bg |
| 🟠 Orange | **Artist you've already submitted** | bold solid orange + faint fill | (n/a — this category is about *your* artist usage) |
| 🔵 Blue | **Chat mention** | you mentioned it — bold solid blue + faint fill | someone else mentioned it — dotted blue + more-opaque blue bg |
| — | **Clean** | plain row | |

Multiple statuses at once → the row border takes the **strongest signal**; the rest show as small **secondary pills**. (Priority order TBD — see open questions.)

---

## Badge system (NEW — to track / brainstorm)

Separate from the row's history *coloring*, badges convey **achievement/notoriety** at two levels. **Two badge areas** keep song-level vs artist-level legible:

- **Song badges** — about *this specific song*.
- **Artist badges** — about *the artist* (any of their songs). **Instinct: artist badges live mostly in the expanded card**; the collapsed row should only give a *subtle hint* that the artist carries *some* badges (not the full set).

Proposed badges:
- 🥇🥈🥉 **Medal** — the artist (or song) has placed **1st / 2nd / 3rd** in a round. A **count badge-on-the-badge** (a small number) conveys *more than once* (e.g. 🥇×2).
- 💩 **Poop** — the opposite: has come in the **bottom 2** in any round, with a count badge.
- 🗣️/💬 **Big-discussion** — has had a song submitted that drew a **large amount of comments**.

Open: exact thresholds (what counts as "a lot of comments"?), whether medals/poop apply to song *and* artist (with the two areas distinguishing them), and how the collapsed-row "this artist has some badges" hint looks.

---

## Promotion targets (reuse existing)
- **+ Shortlist** → creates a `research_songs` row (gains ratings/`MiniDna`, notes, assign-to-round once shortlisted).
- **+ Head-to-head** → enters the h2h candidate pool (already sourced from `research_songs`).

---

## Phasing (proposed — milestone, not one sprint) — NEEDS USER CONFIRM
- **Phase 1 — Foundation:** rename Round History → History + tabbed shell; **active-round management** (per-league active slot, manual mark-active, modal "no active round → choose/create-with-dates"); **theme property-tag taxonomy** + tag existing themes. (Substrate the rest needs.)
- **Phase 2 — Tab 1 Song search:** Spotify search + reuse `ResearchList` cards + history coloring (D3) + song/artist badges (D6/D7) + promote (shortlist / round list / h2h).
- **Phase 3 — Tab 2 Theme research:** tag-overlap similarity → similar rounds → high/low songs + telling comments; promote back to Tab 1 targets.
- **Phase 4 — Tab 3 Player research:** numbers-only per-player summaries (submissions, votes given, comment counts, results) + tendencies view.
- **Later:** player-research → theme-research input; richer player analysis (genre/release/popularity); artist-badge depth; optional LLM similarity augment.
- *Open:* user wanted Player research "established in the first batch even if simplified" — may pull a minimal Tab-3 stub into Phase 1, or keep Phase 4 but ensure the tab exists from the shell. CONFIRM.

## Open questions / to brainstorm
- **Theme-research surface** — full brainstorm needed: how theme-similarity is computed (LLM/embedding vs keyword), how related rounds + high/low songs are surfaced, which comments to reveal (high-point voters + <1 voters).
- **Badge thresholds + scope** — medal/poop/comment thresholds; song-level vs artist-level; the collapsed "has-some-badges" hint.
- **Multi-status priority** — when a row is several things at once, which hue wins the border.
- **Current-round context** — promotion is per-round (shortlist/h2h assign to rounds); how the tool knows/sets the target round.
- **MVP cut** — likely: Surface 1 (song-search + me/others history coloring + promote) first; badges and Surface 2 (theme research) as follow-on phases.

## Decisions so far
- **D1** — "Round history" → **"History"**; it becomes a research tool, not just a round list.
- **D2** — Results are **shortlist-style rows** (collapsed→expand), reusing the shortlist pattern/components.
- **D3** — **Me-vs-others visual language locked**: hue=kind, weight=whose. Border: mine bold-solid / others dotted. Fill: flat opacity, mine 25% / others 10% (no gradient; tweakable). Red=submitted, orange=your-artist, blue=mention.
- **D7** — Collapsed-row "artist has badges" hint = a 🖌️ **paintbrush** icon (not a dot). Artist badges themselves reveal only in the expanded card.
- **D8** — History is a **tabbed screen**: Tab 1 Song search, Tab 2 Theme research (+ maybe a legacy round-history tab later).
- **D9** — Tab 1 **reuses the Chat Watcher card UI** (`ResearchList.svelte`) with its two promotion targets (saved-songs shortlist + specific-round list); we add the history coloring/badges on top.
- **D10** — Theme research is anchored on a **selectable active round per league** (manual control) and/or a free-text box; supports upcoming themes.
- **D11** — **Theme similarity = property-tag overlap, NOT LLM** for v1 (tag taxonomy: semantic / musicality / energy-feel / instrument / artist / extensible; multi-tag per theme). LLM is an optional later augment.
- **D12** — New **Tab 3: Player research** — establish in the first batch but **numbers-only / objective** (submissions, votes given, comment counts, results); richer analysis + "player as theme-research input" are later phases.
- **D13** — **Active-round management** is foundational: per-league active slot, manual mark-active, modal warning + create-round (with dates) when missing.
- **D14** — Scope is now a **milestone**, phased (see Phasing) — not one sprint.
- **D4** — **Two surfaces**: song-search+history overlay, and theme-research (new).
- **D5** — Promote to existing **shortlist** + **head-to-head**.
- **D6** — **Badge system** (medals/poop/comments) tracked as a concept; song vs artist in two areas; artist badges mostly expanded-only with a collapsed hint.
