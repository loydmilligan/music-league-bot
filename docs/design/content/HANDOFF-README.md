# Content screen — operator side of the b-side — handoff package

This package changes the **music-league-bot operator app** (`mlb37.mattmariani.com`)
to drive the **b-side** consumer sites. It is the operator counterpart to
the `dashboard-handoff` package (which is the public site itself). Build
that one too — this package only covers the operator controls that publish
and update it.

## The change in one line

The sidebar's **"Digest"** item becomes **"Content"**, split into two tabs:

- **Digest** — the existing generate → refine → finalize pipeline, unchanged.
- **Archive** — manage each league's shareable **b-side** site: publish a
  first site, or add a finalized round to its archive. Always on the same
  unguessable slug, all season.

## Why a tab, not a regenerate-every-week job

The b-side archive does **not** rebuild on a schedule. When a round's
digest is finalized (on the Digest tab), that round becomes **available to
add** to its league's b-side. The Archive tab surfaces that with an
**"update ready"** badge (on the tab and on the league's row). The operator
opens an **update modal**, chooses what recomputes, hits **Generate**, and
the existing site updates **in place on the same slug** — members never get
a new link. A **reshare card** is produced so the operator can announce in
the chat that a new digest hit the archive.

## What's in this folder

```
content-handoff/
├── README.md                                   ← you are here
├── handoff/
│   └── Implementation prompt.md                ← paste this into Claude Code
└── reference/
    ├── Music League Bot - Content Screen.html  ← open in a browser — visual target (4 artboards)
    ├── ml-content.jsx                           ← Content screen: sidebar, tabs, archive list, update modal, reshare
    ├── ml-content-styles.css                    ← every .ct-* class (+ .ml-nav-badge)
    ├── ml-content-data.jsx                      ← league b-side state, pending digests, update-section plan
    ├── ml-digest-refine.jsx                     ← PipelineStrip + RoundPicker (reused by the Digest tab) + the regen-modal idiom
    ├── ml-digest-data.jsx / ml-digest-styles.css ← digest pipeline data + .dg-modal / .dg-pipeline CSS (modal shell reused)
    ├── ml-shared.jsx                            ← Sidebar / BrandMark reference (already in your repo)
    ├── ml-data.jsx                              ← LEAGUES fixture (already in your repo)
    ├── ml-styles.css / orc-tower-styles.css / colors_and_type.css  ← app shell, .mash-btn, tokens (already in your repo)
    ├── design-canvas.jsx                        ← review-canvas wrapper (NOT shipped)
    └── m-l-favicon-32x32.png
```

## The four artboards (in the visual target)

1. **Archive tab** — the league list. Two leagues "update ready" (pulp
   rows), one "up to date" (voting still open, no new digest), one "not
   published" (dashed row → first publish). The tab shows a count badge.
2. **Update modal** — adds R-14 to Vinyl scramblers. One required "add to
   timeline" entry + five recompute rows (superlatives, stats,
   fingerprints, moments, overlap), each a **refresh / hold / lock**
   decision; steerable rows get a "↻ steer this rewrite" affordance.
   Announce choice + same-slug guarantee at the bottom.
3. **Published** — green success banner + the reshare card ("the b/side ·
   new in the archive") with Send to WhatsApp / Copy card / Copy link.
4. **Digest tab** — the existing pipeline strip + round picker, unchanged.

## Where each file goes in your repo

| From here | To your repo |
|---|---|
| `reference/ml-content-styles.css` | `src/lib/content/content.css` (or scoped to the route) |
| `reference/ml-content.jsx` | Port to your framework's components under the Content route |
| `reference/ml-content-data.jsx` | `docs/design/content/` — reference for the league b-side read/write shape |
| `reference/*` (everything else) | `docs/design/content/` — keep as reference, do not serve |

## What to do

1. Open `reference/Music League Bot - Content Screen.html` in a browser and
   walk all four artboards (drag to pan; click an artboard's label to open
   it fullscreen).
2. Build the `dashboard-handoff` (public b-side) package first or alongside
   — this operator screen writes the read-model that package reads.
3. Paste `handoff/Implementation prompt.md` into Claude Code, with: *"read
   the files in docs/design/content/ first — especially ml-content.jsx, the
   .css, and ml-content-data.jsx for the update-plan shape."*

## Notes for Claude Code

- **`design-canvas.jsx` is the review wrapper — do NOT ship it.** Each
  `<ContentScreen>` is a real operator screen (dark `.ml-app` shell).
- The **Digest tab is the existing pipeline** — don't rebuild it. This
  package only adds the tab chrome around it and the whole Archive tab.
- **Same slug, all season.** An archive update never mints a new slug; it
  refreshes the existing site. The slug only changes on a deliberate
  rotation (see the b-side package).
- **Refresh / hold / lock** is the per-section contract: refresh recomputes
  from the new round, hold keeps the current version, lock pins it so it
  never auto-updates. Persist the choice per section per league.
- One accent (`--mash-pulp`) + four states (moss, amber, ember, sky) +
  neutral scale. The 🔒 / ↻ / ✓ glyphs are operator-chrome UI only (same as
  the existing digest screen) — never in the public b-side body.
