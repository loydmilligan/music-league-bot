# Kickoff prompt — Guess-the-Submitter season visual

Paste this to Claude Code, working in `music-league-bot`.

---

You're implementing a new season visual at the bottom of the digest's **Guesser** section.
Read `design_handoff_guesser_viz/README.md` first — it is the spec — and open the four PNGs
in `visuals/` for appearance. The HTML in `design/` is a **reference prototype**, not code to
copy; recreate it in the real app.

**Where it goes.** Bottom of the Guesser section, inside `GuesserLeaderboard.svelte`
(`ui/src/lib/digest/GuesserLeaderboard.svelte`, `.gsl-*` scoped styles), after the existing
single-player ledger. Keep the `DigestSection` shell and the `.dg-section-wrap` /
`data-section-kind="guesser"` export contract intact — the section already exports as a
standalone PNG and that must keep working.

**Stack.** SvelteKit 2 / Svelte 5 runes (`$state`, `$derived`), TypeScript, scoped `<style>`,
hand-rolled SVG/CSS (no chart library — don't add one). Tokens only, from
`ui/src/lib/shortlist/colors_and_type.css` — never a raw hex.

**Data.** Everything comes from `getGuesserData(db, roundId).seasonGrid`
(`ui/src/lib/db/guesserInsights.ts`). Build the four derived structures listed in the README's
"Data contract" from `seasonGrid.rows[].guesses`. Test against BOTH states in
`data/guesser-viz-data.json`: `live_round150` and the sparse `thin_earlySeason`.

**Build in this order:**
1. **By player** (default tab) — the 10 dual-direction cards. Get the two-pip language right
   first (▶ bright/solid guessing, ⊙ pastel + guesser-coloured ring), with native `title`
   tooltips on every pip. This is the heart of the feature.
2. **Field** — the √-scaled volume × accuracy quadrant with the small-sample shade.
3. **Targets** — the anonymous-first spot-rate meters.
4. **Carrot box** — Ghost/Decoy cards, throw-off bars, the two SVG confusion motifs.

**Honour the three data caveats (README → Data dependencies):**
- The **Decoy** pull-quote is **hand-flagged** — wire it to a new comment-flag field
  (reuse the `gridNotes` override mechanism); until then keep it curated.
- The hatched **"landed"** bar segment is **illustrative** — render throw-off bars from real
  data and only add the hatch once the ballot join exists.
- **Chat-frequency** ("clues given") is a **v2 idea — do not build it now.**

**Export (D5).** Tabs are web-only. In the `?export=1` static render, the four panels must
**stack vertically** (all visible) rather than hide behind tabs, since the PNG captures one
DOM state. Tooltips are `title`-only so they flatten to nothing cleanly.

**Constraints.** Dark only; ~400px phone width plus the wide/export size; colour is never the
only channel (figures + tooltips carry the same fact); accent semantics fixed
(moss=right, ember=wrong, amber=middling, pulp=brand). Don't touch the matcher
(`guessResolver.ts`), the single-player ledger, the export pipeline, or any token values.

Start with the By-player tab and show me that before moving on.
