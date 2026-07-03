# Metadata enrichment: release year + deeper lyrics analysis — design

**Date:** 2026-07-02
**Status:** Approved (brainstorming complete). Two independent, self-contained parts (A, B) — buildable together or separately.

## Context

From the metadata audit (2026-07-02): the competition corpus (~641 songs, keyed by `spotify_uri`) has popularity, genre tags, audio features, and lyrics *presence* — but **release year is not stored for competition songs** (only `shortlist_songs.year`), and **lyrics text is fetched then discarded** after computing only `word_count`/`line_count`. This spec captures release year for the corpus and squeezes more metrics out of the lyrics text before it's discarded.

Both parts extend the existing per-`spotify_uri` metadata tables and the existing enrichment paths. No `ml_submissions` change; consumers join by `spotify_uri`.

---

## Part A — Release year

**Goal:** store each song's release year on the per-song facts table, populated corpus-wide with no extra API cost (it rides the Spotify batch we already make).

### Storage
- Add `release_year INTEGER` (nullable) to `song_popularity`.
  - CREATE in `ui/src/lib/db/schema.ts` (the `song_popularity` block).
  - Additive migration in `ui/src/lib/db/client.ts` using the existing PRAGMA-guarded idiom (same as `popularity_source`): `if (cols.length && !cols.some(c => c.name === 'release_year')) db.exec("ALTER TABLE song_popularity ADD COLUMN release_year INTEGER")`.
  - Also add the column to the standalone `scripts/backfill-popularity.ts` `CREATE TABLE`/migration (that script opens the DB directly, bypassing `client.ts` — mirror the guard there too, as was done for `popularity_source`).

### Fetch
- Extend the existing Spotify batch fetch `fetchSpotifyPopularity(uris)` in `ui/src/lib/spotify.ts` (it already calls `GET /v1/tracks?ids=` in 50-id batches and reads `popularity`). Widen it to also read `album.release_date` and return, per URI, `{ popularity: number | null, releaseYear: number | null }` (rename to `fetchSpotifyTrackMeta` for clarity; keep behavior — batched, graceful empty map when creds absent, no throw).
  - `releaseYear` = `parseInt(album.release_date.slice(0,4), 10)`; guard non-numeric/empty → null. (`release_date` may be a full date `"2004-03-01"` or year-only `"2004"` depending on `release_date_precision`; the first 4 chars cover both.)
  - Update its two call sites (`recomputePopularityProxies` in `lastfm.ts`; `scripts/backfill-popularity.ts`) and the existing `spotify.popularity.test.ts` to the richer return shape.

### Populate
- In `recomputePopularityProxies(db, opts)` (`ui/src/lib/lastfm.ts`): today it fetches Spotify only for rows missing `spotify_popularity`. Change the trigger to fetch for rows **missing `spotify_popularity` OR missing `release_year`**, and write **both** columns from the returned meta. (All 641 existing rows have `spotify_popularity` but no `release_year`, so the first run after deploy fetches them all once; steady state only fetches genuinely-new songs.) Keep it inside the same transaction/no-op-without-creds behavior.
- This rides the existing "recompute at prepare/generate" trigger + the backfill script — no new queue job type, no new endpoint.

### Testing
- Extend `ui/src/lib/spotify.popularity.test.ts`: mocked `fetch` returns tracks with `album.release_date` of both `"2004-03-01"` and `"1997"` → asserts `releaseYear` 2004 / 1997; missing/empty `release_date` → null; still batches by 50; empty map without creds.
- A focused test that `recomputePopularityProxies` writes `release_year` for a row that has `spotify_popularity` but no year (mocked fetch), and does not re-fetch a row already having both.

---

## Part B — Deeper lyrics analysis (compute-then-discard)

**Goal:** extract more metrics from the LRCLIB lyrics text inside the existing `lyrics` job, then discard the text as today.

### Storage
Extend `song_lyrics_metrics` (keep existing `has_lyrics`, `word_count`, `line_count`, `fetched_at`) with additive nullable columns:

| Column | Type | Meaning |
|---|---|---|
| `unique_word_count` | INTEGER | distinct lowercased word tokens |
| `type_token_ratio` | REAL | `unique_word_count / word_count` (vocabulary richness, 0–1) |
| `avg_word_length` | REAL | mean characters per word token |
| `is_explicit` | INTEGER | 1 if any profanity hit, else 0 |
| `profanity_count` | INTEGER | number of profanity token hits |
| `reading_grade` | REAL | Flesch-Kincaid Grade Level |
| `reading_ease` | REAL | Flesch Reading Ease (0–100, higher = easier) |
| `sentiment_score` | REAL | AFINN net score (sum of matched word valences) |
| `sentiment_norm` | REAL | per-token normalized sentiment, ≈ −1…1 (score / matched-or-total tokens) |

CREATE additions in `schema.ts`; PRAGMA-guarded migrations in `client.ts` (one guard per column, matching the existing idiom).

### Compute (in `ui/src/lib/lrclib.ts`)
The `lyrics` job already fetches `plainLyrics`/`syncedLyrics` and computes `word_count`/`line_count` via `lyricMetrics()`, then discards the text. Replace/extend that with `analyzeLyrics(text)` returning all metrics; the text is still discarded after.

- **Tokenization (pure-JS):** lowercase, split on non-letter/apostrophe, drop empties. `word_count` (total), `unique_word_count` (Set size), `type_token_ratio` = unique/total, `avg_word_length` = mean token length.
- **Explicit (pure-JS):** a bundled profanity word list (a curated `Set<string>` in a new `ui/src/lib/lyrics/profanity.ts`; ~a few hundred terms, offline). `profanity_count` = token hits; `is_explicit` = count > 0. (No external service.)
- **Reading level (pure-JS):** Flesch-Kincaid using sentence count (approx by line count when punctuation is sparse — lyrics rarely have terminal punctuation; use `max(lineCount, sentenceCount)` as the sentence denominator), word count, and a syllable estimate (vowel-group heuristic in `ui/src/lib/lyrics/readability.ts`). `reading_grade` = `0.39*(words/sentences) + 11.8*(syllables/words) - 15.59`; `reading_ease` = `206.835 - 1.015*(words/sentences) - 84.6*(syllables/words)`. **Documented caveat:** lyrics are short-lined and repetitive, so these are approximate/relative, not authoritative grade levels.
- **Sentiment (lexicon):** AFINN-165 valence lexicon. Use the lightweight offline `sentiment` npm (AFINN-based, no network) **or** a bundled AFINN JSON + a ~15-line scorer in `ui/src/lib/lyrics/sentiment.ts` (prefer the bundled route to avoid a dependency; implementer picks based on footprint). `sentiment_score` = sum of matched token valences; `sentiment_norm` = `score / max(1, matchedTokenCount)` clamped to −1…1 so long vs short songs compare.
- **Guards:** when `has_lyrics = 0` (instrumental / not found) → all new metrics `null`. When `word_count = 0` → guard divisions (`type_token_ratio`, `avg_word_length`, ratios) → `null`; counts → 0.

### Dependencies constraint
Small, **offline, deterministic** only (AFINN lexicon; pure-JS readability + profanity). **No new network calls** in the lyrics job beyond the existing LRCLIB fetch. Deterministic so tests are stable.

### Backfill
The existing 641 songs have `lyrics` jobs `done` but only the old columns. Since the text was discarded, populating the new columns requires **re-fetching LRCLIB** → re-enqueue the `lyrics` job for the corpus (via the existing fill-gaps / `POST /api/songs/[spotifyUri]/enrich` path, or a one-off enqueue of `['lyrics']` for all URIs). ~641 LRCLIB calls, rate-limited by the worker. Note this in the plan as a post-deploy backfill step.

### Testing
Pure unit tests (`ui/src/lib/lyrics/*.test.ts`) — deterministic text in, exact/bounded metrics out:
- tokenization: known text → exact `unique_word_count`, `avg_word_length`, `type_token_ratio`.
- profanity: text with N known bad words → `profanity_count = N`, `is_explicit = 1`; clean text → 0/0.
- readability: a simple vs a complex passage → grade ordering (complex > simple); values finite.
- sentiment: clearly-positive vs clearly-negative text → sign of `sentiment_score`/`sentiment_norm` matches; neutral ≈ 0.
- `analyzeLyrics` integration: instrumental (empty) → all new metrics null; a full sample → all fields populated and internally consistent (`unique ≤ total`, `0 ≤ ttr ≤ 1`).

---

## Isolation / boundaries
- **Part A** touches: `spotify.ts` (fetch), `lastfm.ts` (recompute write), `schema.ts` + `client.ts` (column), `scripts/backfill-popularity.ts` (mirror). One new nullable column; one widened function.
- **Part B** touches: `lrclib.ts` (analysis) + new small pure modules `ui/src/lib/lyrics/{profanity,readability,sentiment}.ts`; `schema.ts` + `client.ts` (columns). Analysis modules are pure, independently testable.
- The two parts share nothing at runtime; either can ship alone.

## Out of scope
- Album art backfill (declined) — though the same Spotify call returns it, we're not touching art here.
- Storing raw lyrics text (declined) — text still discarded after analysis.
- Any UI to display these — the metadata-display surface (separate Theme-Research design) and future consumers read these columns later.
- Sentiment beyond lexicon (no ML model); readability beyond Flesch-Kincaid.

## Resume notes (for pickup)
- Both parts are additive columns + small pure functions + one backfill each; no destructive migration.
- Part A backfill is automatic (rides `recomputePopularityProxies` once trigger includes `release_year`); Part B backfill is an explicit re-enqueue of `lyrics` (text was discarded, must re-fetch LRCLIB).
- Straight to `writing-plans` on resume; no open design questions.
