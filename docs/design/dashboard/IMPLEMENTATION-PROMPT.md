# Implementation prompt — the b-side (Shareable League Dashboard)

You're adding a **public, no-auth, read-only micro-site — one per league —
to the music-league-bot stack**. It's the fan-facing flip side of the
operator app (`mlbot2.mattmariani.com`): league members get a link, never
the league HQ.

The brand is **the b-side**, a sibling to `m/l` — same dark Mash Co. shell
+ pulp accent, with a warmer, celebratory layer on top (gold/colored award
badges, bigger display type, yearbook energy). Tone is **Spotify Wrapped ×
high-school yearbook**: warm, a little roast-y, screenshot-bait. Never a
brutal leaderboard.

A working visual reference lives at
`reference/the b-side - League Dashboard Preview.html`. **Open it before you
start.** Use the Home / Profile / Archive pills under the phone (and the
sitemap on the left) to walk all three screens, then tap an award's share
icon to see the shareable card.

---

## 0. Read these first

| File | Why |
|---|---|
| `reference/the b-side - League Dashboard Preview.html` | Open in a browser — the visual target. |
| `reference/ml-dashboard-home.jsx` | League Home layout + section order. |
| `reference/ml-dashboard-profile.jsx` | Player Profile — the heart. Fingerprint, superlatives, fan/hater, overlap v2, playlist. |
| `reference/ml-dashboard-archive.jsx` | Digest Archive layout. |
| `reference/ml-dashboard-shell.jsx` | Brand mark, shared atoms (Avatar, icons, accent map), share-card overlay, router. |
| `reference/ml-dashboard-styles.css` | Every `.bs-*` class. Lift wholesale. |
| `reference/ml-dashboard-data.jsx` | Fixture shape — drives the read-model / API contract. |
| `colors_and_type.css` (already in your repo) | Mash Co. tokens. |

**The iOS bezel (`ios-frame.jsx`), the concept rail (`.bs-rail`), the
Home/Profile/Archive flip pills, and the mock URL bar (`.bs-urlbar`) are
presentation scaffolding for the review only. Do NOT ship them.** The real
product is everything inside `.bs-browser`, rendered as an ordinary
responsive mobile-first web page.

---

## 1. Files to drop into the repo

| From (this folder) | To (your repo) |
|---|---|
| `reference/ml-dashboard-styles.css` | `src/lib/dashboard/dashboard.css` (or scoped to the route) |
| `reference/ml-dashboard-*.jsx` | Port to your framework under the public route (see §4) |
| `reference/*` (everything else) | `docs/design/dashboard/` — keep as reference, do not serve |

The CSS only references Mash Co. tokens already in your `tokens.css` /
`colors_and_type.css`. It is self-contained — no new hex literals.

---

## 2. Hosting & routing model

This is the core requirement — match the **existing digest sharing model**
exactly, scoped to a whole league instead of a single round.

- Lives on **`digest.mattmariani.com`** — same host as the digests.
- **One micro-site per league**, addressed by an **unguessable random
  slug**:

  ```
  digest.mattmariani.com/{slug}                     → League Home
  digest.mattmariani.com/{slug}/p/{memberId}         → Player Profile
  digest.mattmariani.com/{slug}/archive              → Digest Archive
  digest.mattmariani.com/{slug}/archive/{roundId}    → existing full digest artifact
  ```

- **No auth, ever.** Nothing private is exposed. Security is the
  unguessable slug — a high-entropy token (≥ 80 bits; the fixture shows
  `a9f3-kq7x-2m`-style). Treat it like a capability URL.
- **Slug → league** is a single indirection. One league = one stable
  slug, minted when the operator publishes the site. Rotating the slug
  (e.g. someone left the league) invalidates the old link.
- **No cross-league leakage**: a slug resolves to exactly one league's
  read-model and nothing else. There is no league switcher, no "browse
  other leagues," no global index. A member of league A given slug A can
  never reach league B.
- **No path back to the operator app.** Nothing on these pages links to
  `mlbot2.mattmariani.com`. The footer brand mark is decorative only.

```
robots: noindex, nofollow on every dashboard route — these are
share-by-link, not search-discoverable.
```

---

## 3. Read-model (drives the route data)

The site is **read-only over a pre-computed read-model**. Nothing is
computed at request time. `ml-dashboard-data.jsx` is the canonical shape;
mirror it as the published JSON blob per league.

```sql
-- One published site per league. Minting a row = publishing the site.
CREATE TABLE dashboard_sites (
  slug            TEXT PRIMARY KEY,          -- unguessable, ≥80 bits entropy
  league_id       TEXT NOT NULL UNIQUE,      -- one site per league
  published_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  refreshed_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  read_model      TEXT NOT NULL,             -- JSON snapshot (see below) — served as-is
  season          INTEGER NOT NULL,
  is_live         INTEGER NOT NULL DEFAULT 1 -- soft-unpublish without deleting the row
);
```

The `read_model` JSON mirrors the fixtures:

- **league** — `{ name, tagline, slug, season, round, seasons, founded,
  memberCount, updated }`. `updated` is the human "freshness" stamp shown
  in the hero.
- **members[]** — each: `{ id, name, initials, hue, tier, joined, role,
  headline, signatureArtists[], genres[], eras[], rewards[], punishes[],
  spectrum[], signatureSuperlative, superlatives[], biggestFan,
  biggestHater, voteTwins[], voteTogether[], playlist, stat }`.
  - `hue` is an oklch hue angle only — all monograms share one
    lightness+chroma (`oklch(0.72 0.15 H)`) so the family reads as one
    warm palette. Assign hues deterministically from member id.
  - `tier: "full" | "lite"` — see §5.
- **reel[]** — league-wide superlatives for Home: `{ award, winner
  (memberId), accent, blurb }`.
- **kpis[]** — celebratory facts: `{ value, label, sub }`. **Never a
  win/loss ladder.** (See §6.)
- **moments** — `{ mostLoved, mostDivisive, biggestUpset }`, each
  `{ title, artist, submitter (memberId), round, line }`.
- **archive[]** — past rounds newest-first: `{ n, season, theme,
  winnerSong, winnerArtist, submitter (memberId), date, votes, hue,
  open }`. Each maps to an existing digest artifact at
  `/{slug}/archive/{roundId}`.

`accent` is one of `pulp | amber | sky | moss | ember` — maps to the
`.bs-acc-*` classes. Don't invent new accents.

---

## 4. The three routes

### 4a. League Home — `/{slug}`
Order, top to bottom (see `ml-dashboard-home.jsx`):
1. Masthead (b/s mark + share-the-league icon)
2. **Hero** — league name (display, ~46px), tagline, live "Updated {date}"
   pill
3. **KPI ribbon** — horizontal scroll of celebratory stats (`.bs-ribbon`)
4. **Superlative reel** — horizontal scroll of award cards; each opens the
   winner's profile, each has its own share icon (`.bs-reel`)
5. **The family** — 2-up grid of every member → profile (`.bs-players`)
6. **Moments of the season** — most loved / most divisive / biggest upset
   (`.bs-moments`)
7. **Latest round** teaser → archive (`.bs-featured`)
8. Footer

### 4b. Player Profile — `/{slug}/p/{memberId}` (the heart)
Order (see `ml-dashboard-profile.jsx`):
1. Back-to-league bar
2. **Hero** — big monogram, name, role, joined, headline, 3-up statline
   (submitted / avg pts / round wins)
3. **Signature superlative** — the trophy block + "share this award"
4. **Taste Fingerprint** — signature-artist chips (one starred favorite),
   genre chips, era chips, then the **spectrum sliders** (Polished↔Raw,
   Sunny↔Melancholy, Familiar↔Obscure), then **Rewards / Punishes**
   two-column
5. **More yearbook superlatives** — each shareable
6. **Biggest Fan / Friendly Hater** — two cards; "hater" is **friendly**,
   amber not red, framed as affectionate (see §6)
7. **Your People** (Overlap v2) — two honest, separately-labeled metrics
   (see §7)
8. **Discovery playlist** — named, with a funny one-line "agenda" nudge and
   3 tracks each with a "why"
9. Footer

### 4c. Digest Archive — `/{slug}/archive`
- Hero, then rounds grouped by season (newest first), each row a card with
  round number, theme, winning song + submitter monogram, date, "New" tag
  on the most recent (`.bs-arch`).
- Each card deep-links to the existing full digest artifact at
  `/{slug}/archive/{roundId}` — **reuse the digest render pipeline you
  already have; do not rebuild it here.**

---

## 5. Member tiers — graceful degradation

Each member is `full` or `lite`.

- **full** — every section renders.
- **lite** — newer/quieter members. The profile still renders a coherent,
  shorter page from whatever fields exist. The reference components already
  guard every optional block (`{m.spectrum && …}`, `{m.playlist && …}`,
  etc.) — preserve that. A lite member with only `headline`,
  `signatureArtists`, `signatureSuperlative`, `biggestFan`, and `stat`
  still looks intentional, not broken. A one-line footnote
  ("{name}'s full profile fills in as the season plays out.") sits at the
  bottom for lite tiers.

Never render an empty section header with no body. If the data isn't there,
the section is omitted entirely.

---

## 6. The "fun" contract — flattering, not brutal

This is make-or-break. The site celebrates; it never humiliates.

- **KPIs are celebratory facts, not a ladder.** "9 different round
  winners," "1994 is the league's favorite year," "longest pick: 6:40."
  **Never** "last place," "worst average," win/loss records, or anything
  that designates a loser.
- **Superlatives are warm.** Even the spicy ones are affectionate —
  "Most Likely to Clear the Room," "The Downvote Hawk," "Brave Downvoter."
  Roast level is friendly-ribbing, dialed to land as a compliment.
- **Biggest Fan / Friendly Hater**: the "hater" is explicitly *friendly* —
  amber (not the ember/red error color), copy framed as good-natured
  ("buries them, lovingly"). It's the person who most often *withholds*
  points or used a rare downvote — never an insult.
- **Moments** are group-consensus, not individual rankings — "most loved,"
  "most divisive," "quiet upset."

When in doubt, frame around the music and the relationships, not the score.

---

## 7. "Your People" — Overlap v2 (two honest metrics)

The old single "overlap %" was misleading. Split it into two clearly-labeled
reads, side by side (see `.bs-people-split`):

| Metric | Scope | What it means |
|---|---|---|
| **Vote together** | within shared rounds | How often you actually hand each other points when you're both in a round. Behavioral. |
| **Taste twins** | across all leagues | Similarity of taste even when you've never shared a round — no penalty for no overlap. |

Each is a labeled group of people-bars with a one-line explainer. Keep the
two scopes visually distinct (the reference tints the Taste-twins fills
sky-blue vs. pulp for Vote-together) so nobody conflates "we vote alike"
with "we have the same taste." Both are read from the precomputed model;
neither is computed at request time.

---

## 8. Shareable card

Tap the share icon on any award (reel card, profile superlative, or the
league itself) → a screenshot-ready overlay card (`.bs-sharecard` inside
`.bs-overlay`). It carries:

- the **b/side** wordmark + league name + season
- a trophy medal in the award's accent color
- the award title + blurb
- the winner's monogram + name

**Critically: the share card exposes NO app URL and NO login wall** — just
the award and the league name, so it's safe to drop in any group chat. The
brief calls per-superlative / per-result sharing "a plus" — this is it.

Implementation notes:
- The overlay's visible state is the **base** style; only a non-critical
  transform is animated, gated so reduced-motion and any
  render-throttling still show the card. Don't gate visibility on an
  animation completing.
- v2 (optional): render the card server-side to a PNG (same Puppeteer
  approach as the digest export) for a true image attachment. v1 is the
  in-page card + the OS screenshot.

---

## 9. Generation & caching contract

- **No LLM at request time. No DB writes at request time.** Pages are pure
  reads of `dashboard_sites.read_model`.
- The read-model is (re)generated by the **existing digest/relationship
  pipeline** — the same machinery that already writes round digests. When a
  round closes and its digest finalizes, refresh the league's read-model
  (`refreshed_at = now`), recomputing superlatives, KPIs, fingerprints, and
  overlap from the accumulated data.
- Serve with long cache headers + an ETag on `refreshed_at`. These pages
  should be CDN-cacheable; a league site is the same for every visitor.
- The "Updated {date}" hero pill reflects `refreshed_at`.

---

## 10. Things to AVOID

- **Don't ship the iOS bezel, the concept rail, the flip pills, or the mock
  URL bar.** They're review scaffolding. The product is the responsive page
  inside `.bs-browser`.
- **Don't render any win/loss ladder or "last place" anything.** See §6.
- **Don't add an auth wall, a login, or a league switcher.** The slug is
  the only gate, and one slug = one league.
- **Don't link to the operator app** (`mlbot2.mattmariani.com`) from any
  dashboard route.
- **Don't index these pages** — `noindex, nofollow` everywhere.
- **Don't run the LLM or mutate the DB on a page view.** Reads only.
- **Don't use stock Tailwind palette colors.** One accent
  (`--mash-pulp`) + four states (moss, amber, ember, sky) + neutral scale.
  No new hex literals, no new hues. Monogram hues all share one
  oklch lightness+chroma.
- **Don't render the `b/s` / `m/l` mark as flat italic** — use the chunky
  extruded recipe in `.bs-rail-glyph` / `.bs-footer-mark`.
- **Don't break the lite-tier guards** — every optional profile block must
  stay conditional. No empty section headers.

---

## 11. Definition of done

- [ ] `digest.mattmariani.com/{slug}` resolves an unguessable slug → one
      league's read-model; bad slug → generic 404 (no league enumeration)
- [ ] `/{slug}/p/{memberId}` and `/{slug}/archive` render under the same slug
- [ ] `/{slug}/archive/{roundId}` deep-links to the existing digest artifact
- [ ] No auth anywhere; no link to the operator app; `noindex, nofollow` set
- [ ] One slug never reaches another league's data; no global index / switcher
- [ ] League Home renders hero, KPI ribbon, superlative reel, member grid,
      moments, and latest-digest teaser
- [ ] Player Profile renders fingerprint (chips + spectrum + rewards/punishes),
      superlatives, friendly fan/hater, Overlap v2 (two labeled metrics), and
      discovery playlist
- [ ] `lite`-tier members render a coherent shorter profile; no empty sections
- [ ] Share icon opens a screenshot-ready card with award + league only, no URL
- [ ] KPIs and superlatives are celebratory — no win/loss ladder, no "last place"
- [ ] Pages are pure reads of a precomputed read-model; LLM/relationship refresh
      runs on round-finalize, not on view; responses are CDN-cacheable
- [ ] All review scaffolding (bezel, rail, flip pills, mock URL bar) is gone
- [ ] No console errors. No hard-coded hex literals. Mash tokens only.

When you're done, open
`reference/the b-side - League Dashboard Preview.html` side-by-side with
your build. Walk Home → a full profile → a lite profile → Archive, then
fire the share card from a reel award and from a profile superlative.
