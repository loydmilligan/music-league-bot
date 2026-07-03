# Song-Metadata Catalog — for Claude Designer

> Companion to `2026-07-02-song-metadata-theme-research-brief.md`. This is the **complete** list of per-song metadata to design around, from a full audit of the codebase + live DB (2026-07-02). It supersedes the shorter field list in the brief and the sample-data file. **Design for the whole set** — but note the **Status** column: some fields are **live** today, some are **planned** (approved, not yet populated). Design so planned fields slot in without rework.

All metadata is keyed by `spotify_uri`. The Theme-Research surface shows **competition songs** (the ~641-song corpus), so coverage numbers below are for that corpus.

Legend — **Status:** 🟢 live · 🟡 planned (approved spec, not yet built/populated). **Coverage** = populated / corpus (641).

---

## 1. Popularity & reach

| Field | Type / range | Meaning | Source | Coverage | Status | Display notes |
|---|---|---|---|---|---|---|
| `popularity_proxy` | int 0–100 (uniform) | Corpus-relative popularity percentile (higher = more popular) | Last.fm listeners/playcount, calibrated w/ Spotify | 641/641 | 🟢 | The headline signal. |
| **`obscurity`** (derived) | int 0–100 | `100 − popularity_proxy` (higher = more obscure) | derived | 641/641 | 🟢 | Use the **bucket vocabulary** (§7) + **sky** color. This is what the digest Tastemaker shows. |
| `spotify_popularity` | int 0–100 | Spotify's own popularity score | Spotify | 641/641 | 🟢 | Secondary; usually keep behind the expand. |
| `listeners` | int | Last.fm unique listeners (raw) | Last.fm | 641/641 | 🟢 | Raw; expand-only. |
| `playcount` | int | Last.fm total scrobbles (raw) | Last.fm | 641/641 | 🟢 | Raw; expand-only. |
| `popularity_source` | enum `lastfm`\|`spotify`\|`manual` | Which signal set the proxy | internal | 641/641 | 🟢 | Provenance; probably not shown. |

---

## 2. Genre / tags

| Field | Type / range | Meaning | Source | Coverage | Status | Display notes |
|---|---|---|---|---|---|---|
| `tags` | string[] (≤5) | Top Last.fm tags — genre + era + mood + artist-name folksonomy (e.g. `["classic rock","70s","rock"]`) | Last.fm | 638/641 (3 empty) | 🟢 | Chips. Not a clean taxonomy — mixes genre/era/mood. Great for inline chips + expand. |

---

## 3. Audio features (from librosa/sintel)

> These are the **only** audio features we have. Spotify's audio-features API (danceability/valence/loudness/etc.) is deprecated — **do not design for those; they don't exist.**

| Field | Type / range | Meaning | Coverage | Status | Display notes |
|---|---|---|---|---|---|
| `bpm` | float ~70–140 | Tempo | 638/641 | 🟢 | Number, e.g. "82 BPM". |
| `key` | text ("A", "C#") | Musical key | 638/641 | 🟢 | Pair with scale → "A minor". |
| `scale` | `major`\|`minor` | Mode | 638/641 | 🟢 | With key. |
| `energy` | int 0–100 | RMS-derived energy | 638/641 | 🟢 | Gauge/bar — **amber** works, or a neutral gauge. |
| `duration_s` | float (seconds) | Track length | 638/641 | 🟢 | Format m:ss. |

---

## 4. Lyrics

> Raw lyrics text is **not stored** (discarded after analysis). Everything here is a derived metric.

| Field | Type / range | Meaning | Coverage | Status | Display notes |
|---|---|---|---|---|---|
| `has_lyrics` | bool | Lyrics found (else instrumental/not found) | 641/641 (592 true) | 🟢 | Chip: "lyrics" / "instrumental". |
| `word_count` | int | Total words | 623/641 | 🟢 | Expand. |
| `line_count` | int | Non-empty lines | 623/641 | 🟢 | Expand. |
| `unique_word_count` | int | Distinct words | — | 🟡 | Expand. |
| `type_token_ratio` | float 0–1 | Vocabulary richness (unique/total) | — | 🟡 | "vocab richness" — small gauge or %. |
| `avg_word_length` | float | Mean chars/word | — | 🟡 | Expand. |
| `is_explicit` | bool | Contains profanity | — | 🟡 | **Badge** ("explicit") — visible inline candidate. |
| `profanity_count` | int | # profanity hits | — | 🟡 | Expand. |
| `reading_grade` | float | Flesch-Kincaid grade level | — | 🟡 | Number/label; **approximate** for lyrics (note it). |
| `reading_ease` | float 0–100 | Flesch reading ease (higher=easier) | — | 🟡 | Alt to grade. |
| `sentiment_score` | float (± net) | AFINN net valence | — | 🟡 | Sign matters. |
| `sentiment_norm` | float −1…1 | Per-word normalized sentiment | — | 🟡 | **Tone** indicator — +/− or a bipolar bar (moss=positive / ember=negative). Good inline candidate. |

---

## 5. Identity & release

| Field | Type / range | Meaning | Source | Coverage | Status | Display notes |
|---|---|---|---|---|---|---|
| `title` | text | Song title | ML export | 641/641 | 🟢 | Row primary. |
| `artist(s)` | text | Artist(s) | ML export | 641/641 | 🟢 | Row primary. |
| `album` | text | Album name | ML export | 641/641 | 🟢 | Expand / sub-line. |
| `album_art_url` | url | Cover art | Spotify (lazy) | **247/673 (37%)** | 🟢 (sparse) | Thumbnails — but **only ~37% covered** for competition songs (backfilled at digest-prep only). Design a **no-art fallback** (initials/placeholder). |
| `release_year` | int (YYYY) | Release year | Spotify `album.release_date` | — | 🟡 | Inline-candidate ("1997"). Planned corpus-wide fill. |

---

## 6. Competition context (per theme pick)

| Field | Type | Meaning | Coverage | Status |
|---|---|---|---|---|
| `points` | int | Votes the pick received in that round | 🟢 | derived from `votes` |
| `submitter` | text | Who submitted it | 🟢 | competitor name |

*(These already show on the Theme-Research pick row today; metadata is what we're adding.)*

---

## 7. Derived buckets & colors (reuse for consistency)

- **Obscurity buckets** (match the digest Tastemaker): `radioHit` (<10) · `recognizable` (10–19) · `curiousCut` (20–29) · `rabbitHole` (30+).
- **Axis colors** (Mashco): obscurity/discovery **sky `#5aa3ff`** · theme-fit/negative **ember `#e6566c`** · quality/positive **moss `#3ec27a`** · energy/replay **amber `#e8a83a`**.

---

## 8. NOT available — do not design for these

These are commonly expected but we **do not have** them (fetched-and-discarded or never computed). Designing for them would be dead UI:

- **Spotify audio features:** danceability, valence, loudness, acousticness, instrumentalness, speechiness, liveness, time signature — **none** (Spotify API deprecated; librosa doesn't compute them). We have only §3.
- **Actual lyrics text** — not stored (only the §4 metrics).
- **30-second preview clips, ISRC, explicit-flag-from-Spotify, track/disc number** — fetched sometimes, never stored. (Explicit *is* coming, but derived from lyrics profanity — §4 `is_explicit`, planned.)
- **Other streaming links** (Apple/Tidal/Deezer/YouTube-Music) — effectively none stored.
- **Release year is currently missing** for competition songs (🟡 planned — see §5).

---

## 9. Guidance for the design

- **Two coverage realities to design for** (brief §D3):
  1. **Completed rounds** — popularity/genre/audio/lyrics-presence ~fully covered; `tags` ~30% empty on some; `album_art` only ~37%; the 🟡 fields absent until built.
  2. **Fresh / in-progress rounds** — audio + lyrics + tags all pending (queue runs after import); only popularity/identity present.
- **Inline vs expand:** headline candidates for inline chips = obscurity (bucket+sky), energy, lyrics/explicit, release_year, tone(sentiment); everything else in the expand.
- **Planned (🟡) fields:** design the module so they drop in as additional chips/rows without relayout — they're approved and coming.
- **Sample values:** `2026-07-02-song-metadata-sample-data.json` (real picks + real coverage gaps) for the mockups.
