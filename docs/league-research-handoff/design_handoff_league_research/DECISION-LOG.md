# League Research tab — decision log

Decisions settled against real data from two leagues: **Second Best** (14 players,
10 rounds, single season — matrix/genre/round-drift source) and **Hip Jammers**
(9 players, 3 seasons / 27 rounds — the only real multi-season case, used for D4's
season boundaries).

## D1 — Overall tab layout → **1b, single visual switcher**
A mono segmented control (Heatmap / Drift / Genre) renders one visual at a time,
large. Rejected: stacked collapsible panels (1a, most native but buries the
flagship heatmap behind a click) and the dashboard grid (1c, too dense for a
conservative first pass). The hero+drawers wildcard (1d) was shown but not chosen.
**Why:** least clutter, most focus, still shows something impressive on first load
since the default tab is the heatmap.

## D2 — Heatmap attribute lens → **2a + 2d, toggle with callouts underneath**
Final direction combines both: the Points/Obscurity/Energy toggle from 2a stays
(the matrix recolors on click, one lens at a time, with the pts-range reference),
and 2d's auto-surfaced callouts (strongest voter→submitter relationship, and the
strongest obscure-leaning pair) render underneath regardless of which lens is
active — reusing the digest's existing `.dgA-mx-callout` pattern. Rejected as
final on their own: 2d alone (no way to inspect obscurity/energy per-cell
yourself, callout-only), small multiples (2b, too dense — three full grids
stacked), and bivariate size+hue cells (2c, hardest to read at a glance).
**Why:** the toggle keeps the matrix inspectable and interactive rather than
purely descriptive, while the callouts still do the "does A reward B for obscure
picks" reading *for* the user so that insight isn't buried behind a click.

## D3 — Genre comparison → **3c, diverging/tornado bars**
Per genre, submit % renders left of a center axis and vote % renders right, in the
`accent`/`sky` axis colors. Rejected: radar/spider (3a, no app precedent, distorts
area), paired horizontal bars (3b, most native but the submit/vote split reads
slower than a diverging split), and the delta-list wildcard (3d, elegant but too
subtle for a genre *comparison* ask). **Why:** the mismatch direction ("submits
rock, votes hip-hop") reads instantly without needing to compare two separate bar
lengths.

## D4 — Obscurity drift → **4b, filled area + winner dots**
League median obscurity renders as a soft filled area (pulp); each round's winner
renders as a separate sky dot rather than a second connected line — so an
obscure surprise win reads as a single outlier point, not a jagged competing line.
Season boundaries are dashed verticals with `S1`/`S2`/`S3` labels. Rejected: the
plain two-line spline (4a, legible but a jagged winner line competes visually with
the smoother median), and the per-season small-multiples wildcard (4c, better for
season-over-season comparison but loses timeline continuity — worth revisiting if
the owner wants that comparison specifically). **Edge case validated (4d):** a
genuine 2-way tie exists in the real data (Second Best, Round 10 — "I'd Rather Go
Blind" obsc 27 vs "Nights Like These" obsc 72). The winner marker must be able to
plot **two** points at the same x, not average them into one misleading value —
confirmed the dot-based winner marker in 4b handles this natively (two dots, same
x, different y) where a single second *line* would not.

## Open areas (not yet decided — flag for a follow-up pass)
- **Scope-bar interactivity & persistence:** the canvas shows the scope bar
  (league + season pills) visually in the Mash Co. vocabulary, but its real
  click-to-switch behavior and whether the selection deep-links (`?league=&season=`)
  vs. persists locally (like `panelState.ts`) was not exercised interactively in
  this pass — recommend deep-linking to match the existing `?tab=` convention,
  but confirm before implementation.
- **Sparse/early-league states:** not yet designed as a dedicated canvas. The real
  data used throughout already has partial coverage (tags 44/112, energy 101/112,
  album art 108/112 in Second Best) which the callouts/bars/matrix all degrade
  around gracefully by omission — but a league with e.g. 2 rounds total (a proper
  "not enough data yet" floor) hasn't been mocked. Recommend a quick follow-up
  pass once the four locked decisions are implemented.
- **Genre-tag normalization:** aggressive merge was used for the D3 mockups
  (casing/near-dupe merge, era/mood tags like "80s"/"female vocalists" dropped).
  This taxonomy (`rock`, `alt rock`, `electronic`, `hip-hop`, `punk`, `pop`,
  `metal`, `new wave` for Second Best) is a first pass, not a finalized mapping —
  expect iteration once it's run across more leagues.
