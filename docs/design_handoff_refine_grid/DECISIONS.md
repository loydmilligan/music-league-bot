# Decision log — C3 Refine Grid

Settled with Matt on the option canvas, 2026-09-01. Each entry: the decision, what was chosen, and why. Canvas ids (e.g. `d4a`) reference `Refine Grid — Option Canvas.dc.html`.

## Three things fixed going in (not reopened)
- **Comprehensive build**, not a minimal first pass.
- **Whole board reachable without navigation** — the hard requirement all layout decisions serve.
- **State control cycles `possible → prime → locked` and wraps** back to possible.

---

## D1 — State control · chosen: **d1a, state-carrying rail + current-state chip**
A mono chip that **shows the current state** and is itself the click target; rail weight + glyph (`○ ◐ ●`) + label carry state without relying on color; `locked` gets the accent and a thicker 3px rail so it reads as the terminal, consequential step.
- **Over d1b** (next-action button, the `flipSeasonStatus` shape): that button shows the *next* verb while you're scanning for the *current* state — two things to parse per row.
- **Over d1c** (segmented 3-position): too wide across ~30 rows, and it invites direct-jump clicks that break the deliberate wrap.
- **Over d1d** (glyph-only toggle): fails the no-color / no-label legibility bar at row height.

## D2 — Candidate picker · chosen: **d2c, always-visible roster strip** (overrides the spec's typeahead)
Each of the 9 roster names is a click-to-add pill under the song, and **the strip is also the availability display** — you see who's free/dimmed/taken at the moment of choosing.
- **Push-back on the spec's d2a typeahead:** for 9–13 local names a typeahead is a keystroke + context-switch per add, must be built from nothing (no chip input exists in the repo), and hides availability until after you choose. Not worth it at this roster size.
- **Over d2b** (`AssignPopover` filter-and-toggle): availability is legible but it's click-to-open, click-to-add, then it hides.
- **Escape hatch:** if a roster ever exceeds ~12, add a filter box above the strip (the d2d hybrid). Never add remote search.

## D3 — Availability treatment · chosen: **d3b, opacity + typed tag + strike**
`dimmed` = amber-dashed rail + `◐ prime · #n` tag (~74% opacity); `taken` = `line-through` + `● locked · #n` tag (~45% opacity). **Three independent signals carry advisory-vs-hard; opacity only reinforces, never carries** — meeting the functional a11y requirement that the two never read the same. The tag names *where* the player is committed so Matt can jump there.
- **Over d3a** (opacity ladder only): advisory vs hard becomes a difference of degree — a glance can't tell 60% from 30%. Fails the bar.
- **d3c** (where-committed badge, no dimming) is folded in as the tag, not used alone — naming without demotion leaves a taken player looking fully active.
- **Propagation:** availability is re-derived server-side and re-read after the write; the transition is a re-render with a one-shot ~700ms accent flash on changed rows (no animation library).

## D4 — Board density · chosen: **d4a, summary at rest, expand on click**
At rest a candidate row is one line (name · state chip · availability tag · factors/notes dots · certainty bar+value · reserved model slot). Clicking the row opens the three-field editor **in place** — no modal, no navigation, scroll kept. All 9 songs fit on a laptop without scrolling.
- **Over d4b** (all fields always visible, columnar): honest but every row is ~40px, the text columns are cramped at board width, and the board runs tall and busy fast (~2× d4a height at full length).
- **Over d4c** (two-pane, editor on the right): densest board but it splits attention (edit here, consequence there) and only one candidate is editable at a time — fights "reason across the whole board at once."

## D5 — Conflict & completeness · chosen: **d5c, inline markers + one roll-up line**
One mono roll-up line keeps the gut-phase register (`N of 9 locked · …`), and a quiet inline marker sits on **both** sides of a conflict (`⚠ also #6`) so Matt never hunts across 30 rows. Ember for hard conflict (duplicate lock), amber for incompleteness (no candidate). Informative, never blocking — duplicates are permitted while editing and gated only at submit (spec §6).
- **Over d5a** (single line, the incumbent): one rolled-up line makes you hunt for *which* rows conflict.
- **Over d5b** (persistent summary panel): richer, but it's a second place to look and introduces a bordered-card pattern the flat app avoids.

## D6 — Claimed slot · chosen: **d6a, standing availability ledger (sticky side rail)**
A pinned 244px rail listing every player's availability in one place — directly serves success-criterion #1 ("who's still free?") and doubles as the songs-vs-players supply count that makes the unsatisfiable end-state legible. Same rail treatment as candidate rows, so it reads as part of the app.
- **Over d6b** (horizontal strip above the board): scrolls off the top as you work; the ledger is most useful *while* reasoning, which argues for pinning it.

---

## §13 unknowns — resolved

- **Gut pick visible? → Yes, as a quiet non-editable marker** (`gut · <Name>`, mono, faint, right of the song title). Matt weighed the anchoring risk and chose always-visible over reveal-on-demand for simplicity. It must **not** look editable — the gut slate is hard-locked (spec §7.1); the refine board is a separate, still-editable layer.
- **Factors: free text or structured? → Free text, as shipped** (`factors: string`). No data-layer change. Row is designed so a structured chip vocabulary *could* replace the textarea later without relayout, but that's not this build.
- **Distinct "no idea / skip" state? → No.** Empty = "not yet." A song with no candidates shows the `no candidates yet` line; nothing more is needed mid-process.
- **Refine replaces the gut slate, or appears below it? → Replaces** the gut `<ol>` in the tab when `phase === 'refine'` (the gut phase is shown collapsed above only for context in the prototype).
- **Display order within a song → status (locked → prime → possible), then certainty desc.** UI choice; `candidatesForSong` returns arbitrary order.

## Project D seam (deliberate)
AI likelihood %/reasoning is **out of scope for C3** (Project D) but lands in this same board later. The design **reserves space** for it — a hairline-separated slot on each resting row (dashed placeholder now) and a labeled reserved box in the expanded editor — so D drops in as a second mono value beside Matt's own certainty without a reflow. Matt asked that the space be held now.
