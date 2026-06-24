<!-- Universal Songcard — brief for Claude Design · 2026-06-24 -->
# Brief for Claude Design — The Universal Songcard

## What we're trying to do
Music League Bot renders "a song" in ~9 different places, each with its own bespoke
component, its own data shape, and its own subset of actions/badges/rating UIs. We want
to collapse all of that into **ONE configurable Svelte UI element** — a *Universal
Songcard* — that can be dropped in anywhere a song (or a list of songs) is shown, with
its features toggled at render time per context. Adding "a list of songs" anywhere in the
app should become trivial.

We want a **design** from you: component API (props/slots), the canonical data model,
density/variant system, how the configurable feature layers compose, and how the rating
UIs unify. Not code yet — a design we can turn into an implementation plan.

## Repo
- GitHub: `git@github.com:loydmilligan/music-league-bot.git` (you have access)
- Stack: SvelteKit (`adapter-node`) operator app in `ui/`; public site in `bside/`; sqlite.
- **Read these first** (committed alongside this brief):
  - `docs/design-briefs/2026-06-24-universal-songcard-inventory.md` — full current-state
    inventory with file:line refs for every variant.
  - This brief.

## Feature inventory — everything the card may need to surface or do

### A. Song metadata (all of this EXISTS today; the card should be able to show any of it)
| Feature | Source / storage | Notes |
|---------|------------------|-------|
| Title / artist / album / year / art | Spotify | 3 album-art key spellings in the wild (`coverUrl`/`albumArtUrl`/`album_art_url`) — unify |
| YTM link | `ytm_link_cache`, `GET /api/ytm/[spotifyUri]` | alternate play target |
| Tastemaker popularity / obscurity | `song_popularity` (`popularity_proxy`, `spotify_popularity`, `obscurity`) + `db/discoverability.ts` buckets (radioHit→rabbitHole) | |
| Genre / mood tags | `song_popularity.tags` (Last.fm top-5, JSON) | |
| Audio insights | `song_audio_features` (`bpm`, `key`, `scale`, `energy`) via sintel/librosa | |
| Lyrics | `song_lyrics_metrics` (`has_lyrics` presence today, via LRCLIB) | |
| Enrichment pipeline | `song_metadata_queue` job_types `{ytm, lastfm_pop, lastfm_tags, audio, lyrics}`; worker `lib/queueWorker.ts` | |
| **Single-track enrich** | `POST /api/songs/[spotifyUri]/enrich` | the per-song "analyze/enrich" entry point |
| Playlist ingestion | `POST /api/ingest/songs`, `lib/import/importer.ts` | bulk enrich a whole playlist |
| Corpus history | `/api/history/song-status`, `CorpusHistoryPanel.svelte` | appearances + who submitted + chat mentions |
| Badges | `BadgeStrip.svelte`, `ArtistBadgeHint.svelte` | medals 🥇×N, 💩, 🗣️ big-discussion (song + artist) |
| Chat context | `chat_mentions` | mention count, intent (ALT/RETRO/FOUND), timeline pips, chat chips |

### B. Rating UI (4 renderings of the SAME 4 dimensions — Discovery / Theme-fit / Nostalgia / Personal)
- `SongRatingBars.svelte` — editable bars (canonical)
- H2H dot-grid (inline in `HeadToHeadCard.svelte`) — editable, space-efficient
- `MiniDna.svelte` — read-only mini bars
- `ScoreChip.svelte` — read-only `/20` numeric + opacity
→ unify to one rating component: `mode` (bars|dots|mini|chip) × `editable`.

### C. Actions (union)
+shortlist · +round-research · +h2h · assign-to-round (popover) · quick-assign ·
play-Spotify · play-YTM · analyze/enrich · rate · notes · save-for-future ·
mark-previously-submitted · dismiss/not-interested · collapse/expand · remove · pick-winner.

## Where the card is used + what each spot needs

Surfaces: **HS**=History Song-Search · **SL**=Shortlist · **RR**=Round Research ·
**H2H**=Round head-to-head · **SLH**=Shortlist king-of-hill · **CH**=Chat Songs ·
**DG**=Digest (read-only, operator) · **BS**=public b-side (read-only, public).

| Feature / Action | HS | SL | RR | H2H | SLH | CH | DG | BS |
|---|---|---|---|---|---|---|---|---|
| Thumbnail / art | ✓ | ✓ | – | – | – | ✓ | ✓ | – |
| Collapse/expand | ✓ | ✓ | – | – | – | ✓ | – | – |
| Rating editor (bars) | – | ✓ | ✓ | – | – | – | – | – |
| Rating editor (dots) | – | – | – | ✓ | – | – | – | – |
| Rating read-only (mini/chip) | – | ✓ | ✓(score) | ✓(score) | ✓(score) | – | – | – |
| Tastemaker popularity/obscurity | ✓ | ✓ | ✓ | ✓ | – | ◐ | ✓ | ◐ |
| Genre/mood tags | ✓ | ✓ | ✓ | ◐ | – | ◐ | ◐ | ◐ |
| Audio insights (bpm/key/energy) | ◐ | ✓ | ✓ | ◐ | – | – | – | – |
| Lyrics presence | ◐ | ✓ | ✓ | ◐ | – | – | – | – |
| YTM link | ◐ | ◐ | ✓ | – | – | ◐ | – | – |
| Corpus history panel | ✓ | – | – | – | – | – | – | – |
| Badges (medals/poop/disc.) | ✓ | ◐ | – | – | – | – | ✓ | – |
| History coloring | ✓ | – | – | – | – | – | – | – |
| Chat context (mentions/intent) | – | – | – | – | – | ✓ | – | – |
| +shortlist | ✓ | – | – | – | – | ✓ | – | – |
| +round research | ✓ | – | – | – | – | – | – | – |
| +h2h | ✓ | – | – | – | – | – | – | – |
| assign / quick-assign | – | ✓ | – | – | ✓ | ✓ | – | – |
| analyze / enrich | ◐ | ✓ | ✓ | – | – | – | – | – |
| notes | – | ✓ | ✓ | ◐ | – | – | – | – |
| save-for-future | – | ◐ | ✓ | – | – | – | – | – |
| mark previously submitted | – | ✓ | ✓(pills) | – | – | – | – | – |
| dismiss / not-interested | – | – | – | – | – | ✓ | – | – |
| play Spotify | ✓ | ✓ | ✓ | ✓ | – | ✓ | – | ◐ |
| play YTM | – | – | ✓ | – | – | – | – | – |
| remove | – | ✓ | ✓ | – | – | – | – | – |
| pick winner | – | – | – | ✓ | ✓ | – | – | – |

✓ = needed · ◐ = nice-to-have / candidate to add in the unified card · – = not appropriate here.
(Many ◐s are features that *should* be available now that the card is unified — e.g.
showing tastemaker/tags/audio in History search, or enrich on more surfaces.)

## The core problem to solve (more than buttons)
Every surface consumes a **different song type** that disagrees on fundamentals:
`title` vs `name`; id `string` vs `number`; rating field names
(`ratingThemeFit` vs `themeFit`); rating scale `0–5` vs `1–5`; three album-art key
spellings. (See inventory §6 for the table.) The Universal Songcard needs **one canonical
`Song` model** + thin per-source adapters, so the component never sees source-specific
shapes.

## What we'd love from you
1. A **canonical `Song` (+ `SongRatings`, `SongMetadata`) type** the card consumes, and the
   adapter strategy from the existing shapes.
2. The **component API**: props/slots, the `density`/variant system (collapsed / expanded /
   compact-row / read-only), how feature layers (metadata, badges, rating, actions,
   corpus, chat-context) are toggled and composed.
3. A unified **rating component** design (bars/dots/mini/chip × editable).
4. Visual direction consistent with the existing design tokens
   (`ui/src/lib/shortlist/colors_and_type.css`: `--mash-pulp` accent, `--moss`, `--amber`,
   `--sky`, `--ember`).
5. Anything we're missing or over-building (YAGNI welcome).

Goal restated: **one configurable UI element usable in every place a song is shown.**
