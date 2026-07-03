# the b-side — Shareable League Dashboard — handoff package

This package adds a **public, no-auth, read-only micro-site — one per
league** — to the music-league-bot stack. It's the **fan-facing flip
side** of the operator app: members get a link, never the league HQ.

The brand is **the b-side** — a sibling to `m/l`. Same dark Mash Co.
shell + pulp accent, plus a warmer, celebratory layer (gold/colored
award badges, bigger display type, yearbook energy). Compact mark `b/s`
echoes the `m/l` / `o/t` slashed marks.

Tone is **Spotify Wrapped × high-school yearbook** — warm, a little
roast-y, built to be screenshotted. Never a brutal leaderboard.

## Hosting model (the whole point)

- Lives on **`digest.mattmariani.com`** — the same host the existing
  digests already use.
- **One micro-site per league**, addressed by an **unguessable random
  slug** (e.g. `digest.mattmariani.com/fam-jam-a9f3`).
- **No auth.** Nothing private is exposed. But because the slug is
  unguessable, members of one league don't stumble into another league's
  site, and nobody reaches the operator app (`mlb37.mattmariani.com`)
  from here.
- This mirrors the existing digest model exactly — digests are already
  shared at `digest.mattmariani.com` with per-artifact slugs. The
  dashboard is the same principle, scoped to a whole league instead of a
  single round.

## What's in this folder

```
dashboard-handoff/
├── README.md                                  ← you are here
├── handoff/
│   └── Implementation prompt.md               ← paste this into Claude Code
└── reference/
    ├── the b-side - League Dashboard Preview.html  ← open in a browser — visual target
    ├── ml-dashboard-shell.jsx                  ← brand, phone/browser chrome, router, shared atoms, share overlay
    ├── ml-dashboard-home.jsx                   ← League Home screen
    ├── ml-dashboard-profile.jsx                ← Player Profile screen (the heart)
    ├── ml-dashboard-archive.jsx                ← Digest Archive screen
    ├── ml-dashboard-styles.css                 ← every .bs-* class
    ├── ml-dashboard-data.jsx                   ← fixture shape — drives the read-model / API contract
    ├── ios-frame.jsx                           ← review-only phone bezel (NOT shipped — see below)
    ├── colors_and_type.css                     ← Mash Co. tokens (already in your repo)
    └── m-l-favicon-32x32.png                   ← favicon
```

## Three screens

1. **League Home** — hero, a no-strife KPI ribbon (celebratory facts, no
   win/loss ladder), the season superlative reel, the member grid,
   "moments of the season" (group consensus, not ranking), and a
   latest-digest teaser.
2. **Player Profile** (the heart) — signature superlative trophy, the
   **Taste Fingerprint** (signature artists / genres / eras chips +
   Wrapped-style spectrum sliders + rewards/punishes), more yearbook
   superlatives, **Biggest Fan / Friendly Hater**, **Your People** (the
   Overlap v2 split — Vote Together within shared rounds + Taste Twins
   across leagues), and a personality-driven **Discovery playlist**.
   Degrades gracefully for `lite`-tier members.
3. **Digest Archive** — every past round, grouped by season, newest
   first. Each card deep-links to the existing full digest artifact.

Plus the **shareable card overlay** — tap any award's share icon to get
a screenshot-ready card carrying just the award + league name. No app
URL, no login wall.

## Where each file goes in your repo

| From here | To your repo |
|---|---|
| `reference/ml-dashboard-styles.css` | `src/lib/dashboard/dashboard.css` (or scoped to the route) |
| `reference/ml-dashboard-*.jsx` | Port to your framework's components under the public route |
| `reference/ml-dashboard-data.jsx` | `docs/design/dashboard/` — reference for the read-model shape |
| `reference/the b-side - League Dashboard Preview.html` + the rest | `docs/design/dashboard/` — keep as reference, do not serve |

## What to do

1. Open `reference/the b-side - League Dashboard Preview.html` in a
   browser. Use the **Home / Profile / Archive** pills under the phone
   (and the sitemap on the left) to walk all three screens, then tap a
   superlative's share icon to see the shareable card.
2. Drop the files in (table above).
3. Paste `handoff/Implementation prompt.md` into Claude Code, along with:
   *"read the files I just added to `docs/design/dashboard/` before you
   start — especially the `.jsx` screens, the `.css`, and
   `ml-dashboard-data.jsx` for the read-model shape."*

## Notes for Claude Code

- **The iOS phone bezel (`ios-frame.jsx`) is a presentation device for
  this review only — do NOT ship it.** The real site is a normal
  responsive mobile-first web page. In the reference build, everything
  *inside* `.bs-browser` is the actual product; the phone frame, the
  concept rail (`.bs-rail`), and the Home/Profile/Archive flip pills are
  scaffolding.
- The `.bs-urlbar` is a *mock* of the browser address bar drawn inside
  the bezel for the demo. The shipped page does not render its own URL
  bar — that's the real browser's job.
- The data is invented (the "Fam-Jam" family league). Swap in the three
  real leagues. `ml-dashboard-data.jsx` is the source of truth for the
  read-model shape the public route needs.
- Everything is **read-only and cacheable**. No login, no mutations, no
  LLM at request time — the page renders pre-computed content (the same
  pipeline that already writes digests). See the prompt for the
  generate-on-publish contract.
- One accent (`--mash-pulp`) + four semantic states (moss, amber, ember,
  sky) + the neutral scale. No stock Tailwind palette colors, no new
  hues. Avatar monograms all share one oklch lightness+chroma and vary
  only hue, so the family reads as one palette.
