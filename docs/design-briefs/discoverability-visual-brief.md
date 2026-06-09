---
project: music-league-bot
type: design-brief
title: Discoverability ("Tastemaker") visual — data + intent brief
created: 2026-06-03
status: brief
---

# Discoverability visual — data + intent brief

> **Purpose of this doc.** Context for whoever (agent or human) builds the next
> iteration of the digest's **discoverability / "tastemaker"** section. It explains
> the app, the data we have, *why* this stat exists, and what the visual must show.
> Read it before touching `discoverability.ts` or the `TastemakerLeaderboard` component.

## 1. App context (concise)

music-league-bot is a companion app for **Music League** — a game where a group of
players submit one song per themed **round**, then everyone votes points across each
other's submissions. Points accumulate into **season standings**. Rounds belong to a
**season**, seasons belong to a **league**, and the same people play across many
seasons. The app ingests each league's export and generates a per-round **digest** (a
shareable infographic): winner podium, standings, chat highlights, and — new in
sprint-17 — data-driven stat sections including this discoverability leaderboard.

## 2. Why this stat exists (the intent — don't lose this)

Music League can be played two ways, and this stat exists to celebrate one of them:

- **As a trivia/popularity game** — submit the song most likely to *win votes*, i.e.
  the crowd-pleaser everyone already knows. One of our leagues skews hard this way:
  players optimize for winning, so rounds fill with songs everyone's heard.
- **As a music-*discovery* game** — the way it's most fun over many seasons: the point
  is to **find new music**. Submit songs and artists people *haven't* heard, build
  playlists you actually want to listen to, and send each other down **new rabbit holes**
  of content worth enjoying. Winning is secondary to broadening everyone's listening.

The discoverability stat is a **counter-scoreboard**: instead of "who won the most
votes," it surfaces **who is submitting the less-popular, more-discoverable music** —
rewarding the discovery players, gently calling out the trivia-optimizers. It should
feel like a celebration of taste/curation, not a shame board.

## 3. What "discoverability" means here

**Discoverability = inverse of popularity.** A song almost nobody has heard is highly
discoverable (someone in the group might *discover* it); a song everyone's streamed a
billion times is not. Per player, we want their tendency to submit discoverable music.

## 4. The data we have (and its limits)

**Popularity source — Last.fm (the real "reach" signal).** Per song we store, in the
**`song_popularity`** table (keyed by `spotify_uri`):

| column | meaning |
|---|---|
| `listeners` | Last.fm distinct listeners for the track |
| `playcount` | Last.fm total scrobbles (plays) for the track |
| `popularity_proxy` | 0–100 score: log-normalized blend (≈0.7·playcount + 0.3·listeners), **relative to the most-played song in our whole corpus** |
| `spotify_popularity` | Spotify's own 0–100 track popularity score (rides along) |
| `artist`, `title`, `fetched_at` | match metadata / cache key |

- **`obscurity = 100 − popularity_proxy`** is today's per-song discoverability.
- The lookup was hardened (sprint-17): titles are normalized (strip
  "- Remastered/Live/Mono/Originally Performed by…" suffixes) and we take the
  **highest-scrobble Last.fm match for the artist**, so per-song numbers are now trustworthy.

**Hard limits to respect:**
- **Spotify's API does NOT expose monthly listeners or stream counts** — only
  `track.popularity` (0–100) and `artist.followers`. So "how many people have actually
  heard this" comes from **Last.fm playcount/listeners**, not Spotify streams. Don't
  design around stream counts; we can't get them.
- **`popularity_proxy` is corpus-relative.** It's normalized against the single
  most-played song in the database (currently Arctic Monkeys "Do I Wanna Know?" at ~45M
  scrobbles). Adding more songs/seasons shifts everyone's proxy slightly. This also
  **squashes the scale**: most real songs land proxy ~62–100 (obscurity 0–38), so the
  current leaderboard bunches up near the bottom and is hard to read. **The scale needs
  rework** (see §6.3).

**Submission / identity data** (for aggregation):
- `ml_submissions` (competitor_id, round_id, spotify_uri) — who submitted which song where.
- `rounds` → `season_id`; seasons → league. `competitors` is a **global** table (one row
  per person, no league/season column) — so **a player's identity spans every season and
  league**, which is what makes a cumulative all-time ranking possible.

## 5. What the visual must show

Three things, together:

### 5.1 Cumulative / all-time ranking (the headline)
The leaderboard should rank players by their discoverability **across ALL their seasons**,
not just the current round's season. This is the "where does everyone stand on this stat,
all-time" view — the persistent reputation. (Today's implementation is season-only;
this needs to aggregate every submission a competitor has ever made.)

### 5.2 Individual round/song performances (the breakdown)
Alongside the cumulative number, show the **per-round / per-song** discoverability values
that feed it — each of a player's submissions as its own data point. This is what makes
the stat honest and readable: you can *see* whether someone is consistently discoverable
or all over the place.

### 5.3 Repeated-popular-picks pattern
Surface **who repeatedly submits popular songs** vs. who does it once. A single averaged
number hides this — show the pattern (e.g. count of mainstream picks, or the per-song
points visibly). The trivia-optimizer who *keeps* submitting crowd-pleasers should be
visible as such.

## 6. The outlier problem (this is the crux — read carefully)

A single extreme submission can wreck a player's cumulative ranking under a naive average,
mislabeling a genuinely discoverable curator as a crowd-pleaser.

**Worked example — Mashew (the app's primary user), Hip Jammers "Dept. of Education" season:**
- The Vandals "I Have a Date" — obscure (obscurity ~38)
- Jawbreaker "Want" — obscure (~25)
- Beastie Boys "Fight For Your Right" — quasi-popular (~12)
→ mean obscurity ≈ 25, **ranks #1** (correct — he's a discovery player).

The Beastie Boys pick isn't popular enough to sink him. **But imagine the third song were
BTS** (a globally massive K-pop act, tens of millions of listeners → obscurity ≈ 0). That
**one** outlier would crater his mean and likely drop him **near the bottom** — even though
he's a strong discovery player who just had one mainstream night.

**The visual must make that legible.** If someone is *generally* great at this stat and has
**one really bad outlier**, the viz should show it — "consistently discoverable, one anomaly"
— rather than letting the outlier silently define their rank. Two complementary levers:

1. **A robust headline statistic** so one extreme value doesn't dominate the cumulative rank
   — e.g. **median** (not mean) obscurity, or a trimmed/winsorized mean, or a per-song
   **percentile rank** (each song scored by where it falls among all songs, then aggregated).
2. **A visible distribution** — show each player's per-song obscurity as points/dots/bars so
   the outlier is *seen* in context: a cluster of high-obscurity picks plus one low dot reads
   instantly as "discovery player + one anomaly," not "crowd-pleaser."

### 6.3 Scale guidance (don't over-prescribe, but)
- The current corpus-relative log-norm proxy compresses everything to obscurity 0–38; the
  rescale should **spread the score across 0–100** so the leaderboard is readable.
- Prefer a **rank/percentile** treatment (the user's own instinct: "a percentage so the less
  popular one scores higher") and/or a **robust central tendency** for the cumulative number,
  paired with the per-round distribution from §5.2/§6.
- Keep it meaningful for the discovery-vs-trivia story — the spread should make the discovery
  players visibly separate from the crowd-pleasers.

## 7. Summary for the builder

Build a discoverability section that:
1. Ranks players **cumulatively across all seasons** (all-time discovery reputation).
2. Shows each player's **individual per-round/per-song** obscurity so the distribution is visible.
3. **Handles outliers** — a robust headline stat + a visible spread so one anomalous popular
   pick doesn't mislabel a consistent discovery player (the BTS example).
4. Surfaces **repeated** popular-picking as a pattern.
5. Uses a **spread-out, outlier-resistant scale** (percentile/rank + median-style aggregation),
   built on **Last.fm playcount/listeners** (not Spotify streams — unavailable).

The data is in `song_popularity` (+ `ml_submissions`/`rounds` for cross-season aggregation);
per-song obscurity is already computable. The work is (a) aggregate cumulatively across seasons,
(b) expose per-song detail in the payload, (c) a robust + spread scale, (d) a viz that shows
cumulative + per-round together with outliers legible.

## 8. Sample data & snippets (concrete)

All values below are **real** from Hip Jammers S3 (season 6) after the sprint-17 lookup fix,
unless marked *hypothetical*.

### 8.1 A `song_popularity` row (what's stored per song)
```
spotify_uri        spotify:track:...          (PK)
artist / title     "The Vandals" / "I Have a Date"
listeners          12,182          (Last.fm distinct listeners)
playcount          55,342          (Last.fm total scrobbles)
popularity_proxy   62              (0-100, corpus-relative log-norm)
spotify_popularity 36              (Spotify's own 0-100)
fetched_at         2026-06-03T...
```
Reference points: missmara's Arctic Monkeys "Do I Wanna Know?" = `listeners 2,914,938 /
playcount 45,572,769 / proxy 100` — it's the **corpus max**, which is what squashes everyone
else upward (Mashew's genuinely-obscure Vandals still only reaches proxy 62 → obscurity 38).

### 8.2 Current live payload — `GET /api/digest/:roundId/discoverability` (season-only, today)
```json
{ "discoverability": [
  { "name": "Mashew",   "obscurityScore": 25, "submissionCount": 3, "avgPopularity": 75 },
  { "name": "mmariani13","obscurityScore": 18, "submissionCount": 3, "avgPopularity": 82 },
  { "name": "missmara", "obscurityScore": 7,  "submissionCount": 3, "avgPopularity": 93 },
  { "name": "Kristin",  "obscurityScore": 6,  "submissionCount": 3, "avgPopularity": 94 }
] }
```
Note the squash: even the #1 tastemaker sits at 25/100 and last place at 6 — a 19-point spread.
Partial-coverage seasons (e.g. Fam Jam S3 today) return a single lonely row (the self-suppress bug).

### 8.3 Current computation (the two pieces to change)
Per-song proxy — `src/api/lastfm.ts` (corpus-relative, squashes the high end):
```js
const logNormalize = (v, max) => (Math.log10(v + 1) / Math.log10(max + 1)) * 100;
// proxy = round(0.7 * logNormalize(playcount, maxPlay) + 0.3 * logNormalize(listeners, maxListeners))
```
Per-player aggregation — `ui/src/lib/db/discoverability.ts` (note `WHERE r.season_id = ?` —
the season scope that must be dropped/parameterized for the cumulative all-time view):
```sql
SELECT c.name AS name, sp.popularity_proxy AS proxy
FROM ml_submissions m
JOIN rounds r        ON r.id = m.round_id
JOIN competitors c   ON c.id = m.competitor_id
JOIN song_popularity sp ON sp.spotify_uri = m.spotify_uri
WHERE r.season_id = ?            -- ← cumulative view = aggregate across ALL seasons per competitor
  AND m.competitor_id IS NOT NULL
  AND sp.popularity_proxy IS NOT NULL;
-- then: obscurityScore = round(mean(100 - proxy))   ← mean is the outlier-fragile part
```

### 8.4 Proposed v2 payload shape (starting point — not final)
Carries the cumulative headline, BOTH mean+median (so the outlier gap is visible), the
repeated-popular count, and per-song detail for the distribution/outlier view:
```json
{ "discoverability": {
  "scope": "all-time",
  "players": [
    {
      "name": "Mashew", "rank": 1,
      "score": 74,            // robust spread-out headline (percentile/median-based, 0-100)
      "mean": 70, "median": 74, "submissionCount": 18,
      "mainstreamPicks": 2,   // # picks below an obscurity threshold (repeated-popular pattern)
      "songs": [              // per-round/per-song → drives the distribution + outlier flag
        { "season":"Hip Jammers S3","round":"Dept. of Education",
          "artist":"Beastie Boys","title":"Fight For Your Right","obscurity":12,"outlier":false }
      ]
    }
  ]
} }
```

### 8.5 The outlier math, concretely (why median > mean)
Mashew, Dept. of Education season — per-song obscurity `[38, 25, 12]`:
- mean **25**, median **25** → ranks #1. ✓

*Hypothetical:* swap the Beastie Boys pick (12) for **BTS** (massive K-pop, obscurity ≈ **0**):
- per-song `[38, 25, 0]` → **mean drops 25 → 21**, **median holds at 25**.
- In a 3-song season one outlier is 1/3 of the data, so a mean-based rank could shove a real
  discovery player down the board; **median (or a trimmed mean / percentile) absorbs it**.
- And in the **per-song view (§5.2)** that single `0` dot sits visibly apart from a `38`/`25`
  cluster → reads instantly as "discovery player, one anomaly," which is the whole point.

Cumulatively (e.g. 18 submissions), one BTS barely moves a mean — but the per-round breakdown
should *still* flag it, so a player can see/own their one trivia-night.
