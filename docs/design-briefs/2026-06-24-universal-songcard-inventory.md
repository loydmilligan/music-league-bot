<!-- Universal Songcard — brainstorm inventory · 2026-06-24 -->
# Universal Songcard — Current-State Inventory

> Goal: unify today's divergent song-card variants into ONE canonical, reusable
> Svelte component whose features (actions / badges / rating UI) are toggled at
> render time per context. This doc inventories **how songs are displayed today**,
> **what each variant shows**, and **where each element does / doesn't make sense** —
> the input for the redesign and the eventual Claude-design handoff.
>
> Built from a 3-agent code crawl (History+Search+analysis · Shortlist+H2H+Research ·
> Digest+Content+Chat+b-side).

## 1. Song-card rendering surfaces (the variants today)

| # | Variant | File | Context | Collapse/Expand | Image |
|---|---------|------|---------|-----------------|-------|
| 1 | **SongSearchCard** | `ui/src/lib/components/SongSearchCard.svelte` | History → Song Search (`/history?tab=songs`) | yes (one-at-a-time) | 44 / 72px |
| 2 | **ShortlistRow** | `ui/src/lib/shortlist/ShortlistRow.svelte` | `/shortlist` list | yes | 44 / 180px |
| 3 | **ResearchList candidate card** | `ui/src/lib/components/ResearchList.svelte` (`262–345`) | Round research tab | always expanded | none |
| 4 | **HeadToHeadCard** | `ui/src/lib/components/HeadToHeadCard.svelte` | Round H2H compare | always expanded | none |
| 5 | **ShortlistH2HPanel cards** | `ui/src/lib/shortlist/ShortlistH2HPanel.svelte` | `/shortlist` king-of-the-hill | n/a | none |
| 6 | **ShortlistStrip** | `ui/src/lib/shortlist/ShortlistStrip.svelte` | `/shortlist` sticky header | n/a | none (league quick-assign, not a song card) |
| 7 | **CwRow** | `ui/src/lib/chat/CwRow.svelte` | Chat → Songs tab | yes | 44 / 180px |
| 8 | **AlbumPodium** | `ui/src/lib/digest/AlbumPodium.svelte` | Digest A-side podium | no (read-only) | album art |
| 9 | **TastemakerSection** | `ui/src/lib/digest/TastemakerSection.svelte` | Digest tastemaker buckets | modal | varies |
| 10 | **b-side displays** | `bside/src/routes/{HomeScreen,ArchiveScreen,ProfileScreen}.svelte` | Public site (no login) | no (read-only) | submitter avatars only |
| — | MessageCard / RoundCard | `ui/src/lib/chat/history/*.svelte` | Chat history search | no | none (message/round, not song) |

## 2. Actions catalog (union across surfaces)

| Action | Appears in | Endpoint | Notes |
|--------|-----------|----------|-------|
| + Shortlist (bookmark) | SongSearchCard, CwRow | `POST /api/shortlist` | CwRow uses a Bookmark toggle |
| + Round research | SongSearchCard | `POST /api/research/{roundId}` | |
| + H2H | SongSearchCard | (pool picker) | |
| Assign to round (popover) | ShortlistRow | `POST /api/shortlist/{id}/assign` | `AssignPopover.svelte`, league-filtered |
| Quick-assign | ShortlistStrip | `POST /api/shortlist/{id}/assign` | only when a song is open |
| Play on Spotify | most | external link / iframe embed (H2H) | |
| Play on YT Music | ResearchList | `/api/ytm/{uri}` | |
| **Analyze (audio)** | ShortlistRow, ResearchList (+ round batch) | `POST .../analyze-audio` | **EXISTS** — see §5 |
| Rate | ShortlistRow, ResearchList, HeadToHeadCard | `PATCH .../rating` | 2 editable UIs — see §3 |
| Notes | ShortlistRow, ResearchList | `PATCH .../notes` | textarea |
| Save for future round | ResearchList (`saveForFuture`) | PATCH | |
| Mark previously submitted / elsewhere | ShortlistRow (`submittedElsewhere`); ResearchList shows submitted-by pills | PATCH | |
| Dismiss / not interested | CwRow | `POST /api/chat/songs/{id}/dismiss` | |
| Collapse ✕ / expand | SongSearchCard, ShortlistRow, CwRow | — | |
| Remove | ShortlistRow, ResearchList | DELETE | |
| Pick winner | HeadToHeadCard, ShortlistH2HPanel | local until final | |

## 3. Rating UI variants (a key part of the mess)

| Variant | File | Editable? | Shape | Used in |
|---------|------|-----------|-------|---------|
| **SongRatingBars** (canonical) | `ui/src/lib/components/SongRatingBars.svelte` | yes (click bars) | 4 tracks DSC/THM/NST/PRS, 0–5 | ShortlistRow, ResearchList |
| **H2H dot grid** | inline in `HeadToHeadCard.svelte` (`151–176`) | yes (click dots) | 4 dims × 5 dots, 1–5/null | H2H only |
| **MiniDna** | `ui/src/lib/shortlist/MiniDna.svelte` | no (read-only) | 4 mini bars | ShortlistRow collapsed |
| **ScoreChip** | `ui/src/lib/shortlist/ScoreChip.svelte` | no (read-only) | numeric `/20` + opacity bars | ShortlistRow both states |

→ 2 editable (bars + dots) + 2 read-only (MiniDna + ScoreChip). Bars are the natural
canonical editor; dots/MiniDna/ScoreChip are space-constrained renderings of the same
4 dimensions. **Consolidation target: one rating component with `mode` (bars | dots |
mini | chip) + `editable` flag.**

## 4. Badges / info elements

- **Song + artist badges** (🥇 medals ×N, 💩, 🗣️ big-discussion): `BadgeStrip.svelte`, `ArtistBadgeHint.svelte` — SongSearchCard only
- **History coloring** (submitted-mine / others / artist-mine / chat-mention data-attrs): SongSearchCard
- **Corpus history panel** (appearances + chat mentions): `CorpusHistoryPanel.svelte` — SongSearchCard expanded only
- **Chat chips / mention count / intent (ALT·RETRO·FOUND) / timeline pips**: CwRow
- **Assignment-count badge**: ShortlistRow
- **Submitted-by-me / -by-other·pts pills**: ResearchList
- **Rank / medal / points / submitter**: AlbumPodium (digest)

## 5. "Analyze" status — important distinction

- **What exists today:** an **audio-feature** analyze (BPM / key / scale / energy) wired
  in ShortlistRow + ResearchList (and a round-level batch). Flow:
  `analyze-audio` → `song_metadata_queue` → `queueWorker.ts` → `analyzeTrack()` in
  `sintel.ts` → `song_audio_features` table.
- **What is NOT built (the about-to-be-planned work):** the richer **single-song
  analysis** UI and **playlist analysis** (analyze a whole playlist, enrich metadata for
  every song) for *taste fingerprinting*. The decision was to fold this into the universal
  card rather than design its UI standalone. ← confirm scope.

## 6. Data-shape divergence (the real knot)

Each surface consumes a different song type, and they disagree on fundamentals:

| Type | id | rating fields | scale | extras |
|------|----|--------------|-------|--------|
| `SpotifyResult` | uri | — | — | `name` (not `title`), `imageUrl` |
| `ShortlistSong` | string | `ratingDiscovery/ThemeFit/Nostalgia/Personal` | 0–5 | `notes`, `assignments[]`, `submittedElsewhere` |
| `ResearchSong` | number | `discoveryPotential/themeFit/nostalgiaPotential/personalRating` | 0–5 | `saveForFuture`, `submittedByMe/Other` |
| `H2HCardSong` | number | same as Research | 1–5 / null | `weightedScore` |
| `ChatSong` | string | — | — | `mentions[]`, `chatNames[]`, `intent`, `dismissed`, `assignedRoundIds`, `onShortlist` |
| `PodiumSong` | — | — | — | `rank`, `points`, `coverUrl/albumArtUrl/album_art_url` |

Inconsistencies to resolve: `title` vs `name`; id `string` vs `number`; rating field
names; 0–5 vs 1–5; three album-art key spellings. **A canonical `Song` shape (with a
mapping layer per source) is the foundation the universal card needs.**

## 7. Context-appropriateness (what does NOT belong where)

- Rating editors / analyze / assign → **not** in public b-side or digest (read-only) and not in History search (corpus view, not round-scoped).
- Corpus history panel + badges → History search only (redundant once a song is a vetted candidate).
- "Submitted elsewhere", assignment chips → shortlist context.
- H2H dot grid → fast pairwise picking; bars too heavy there.
- Public b-side: no actions, no ratings, no operator data — ever.

## 8. Image sizes in use
40 (research search) · 44 (collapsed/search/chat) · 72 (search expanded) · 180 (shortlist/chat expanded). Fallback: vinyl-glyph initial when no art.

---

### Render-time config surface (first cut)
A `UniversalSongcard` likely needs to toggle: `density` (collapsed/expanded/strip),
`ratingMode` (none/bars/dots/mini/chip) + `editable`, `actions[]` (shortlist/round/h2h/
assign/analyze/notes/save/submitted/dismiss/remove/play), `badges`/`historyStatus`/
`corpusPanel` (optional data layers), `imageSize`, `readonly`/`public`. Plus a canonical
`Song` type + per-source adapters (§6).
