# Sonic Signature v2 — comprehension, sharing, system settings

**Date:** 2026-07-01 · **Status:** approved, ready for implementation
**Supersedes parts of:** the shipped v1 (commit `3d21188`) — the per-profile settings cog + per-player
localStorage, and the minimal share card.

## Goal

Make the Taste Waveform card *comprehensible* (not just a shiny object), let people **share it as an
image** without screenshotting, and move its controls to **one system-wide setting** in the admin
Settings tab. The engine math and archetype system are unchanged.

## 1. Card = "rich" (direction C), with element toggles

The card (both the in-app hero and the shared image) defaults to the fully-labeled, self-explanatory
layout:

- **Labeled axes** — pole labels on (POP↔HIPSTER, WORDY↔INSTR, FAST↔SLOW, BRIGHT↔DARK, HYPE↔CHILL),
  i.e. `buildChart(..., { chrome: true })`.
- **Archetype name** + **trait chips with values** (e.g. `HYPE 62 · WORDY 58 · SLOW 48`).
- **One-line read** (`proseFor`).
- **Key** — a small caption: `━ your average · faint = your songs · - - downvotes`.

Each element is **individually toggleable** (see §2 display toggles): axis labels, legend/key, read,
chips, league-average line. When a toggle is off, the element is omitted and the card reflows.

**One renderer, driven by options.** A single `<TasteWaveform variant="card">` (and the `hero`) reads
the resolved display settings and shows/hides elements accordingly — no separate "rich vs minimal"
components.

## 2. Settings = one system-wide config (not per-player)

**Location:** the ui app **Settings → App-setup** tab (`ui/src/routes/settings/setup`), with a **live
sample waveform** that re-renders as controls change (uses the client engine with the pending values —
no round-trip).

**Two groups of controls:**
- **Engine knobs** (unchanged set): signal source, voteFraction, count-downvotes + impact, lyrical
  impact, spread, all-leagues.
- **Display toggles** (new): axis labels, key/legend, read paragraph, trait chips, league-average line.

**Persistence + flow:**
- Stored in the existing `settings` table (key/value), read via `getSettings`-style helper. One new
  settings blob, e.g. keys under `taste_*` (or a single JSON `taste_settings`).
- **Baked into `read_model.taste.settings`** at publish time (buildReadModel + the update path), so
  bside — a different origin — applies them. Resolved server-side from the `settings` table.
- **Save also patches** `read_model.taste.settings` into every published `read_model.json` immediately
  (cheap, no LLM — same mechanism used to patch the taste block on deploy), so a settings change takes
  effect on live profiles without a full republish.
- **bside reads `read_model.taste.settings`** instead of localStorage. The per-player `localStorage`
  path and `tasteSettings.svelte.ts` in bside are removed; the `TasteSettings.svelte` overlay + the
  per-profile ⚙ cog are removed.

**TasteSettings type** gains the display toggles:
`{ signal, votePct, negatives, dnPct, lyrWeight, spread, scopeAll,
   showLabels, showKey, showRead, showChips, showLeagueAvg }`.
The engine already ignores unknown fields; the display toggles are consumed by the component/renderer,
not the math.

## 3. Image sharing = client-side render

- A **Share button** on the card (hero + the sharecard) rasterizes the card DOM to a PNG **in the
  browser** (via a small dependency, e.g. `html-to-image`, added to bside only).
- On success: if `navigator.canShare({ files })` → **native share sheet** (WhatsApp, etc.); else
  **download** the PNG (`sonic-signature-<name>.png`).
- No server, works on the static no-login site.
- **Risk to verify:** fonts (Google Fonts) and SVG gradients must rasterize true. Mitigation: embed/
  inline what's needed; verify the produced PNG visually before calling done. If a gradient/font issue
  is unfixable client-side, fall back to §2's publish-time pre-render for the shared image only (not
  chosen now, but the escape hatch).

## 4. Alignment / comparison

- The y-scale is already fixed and shared across players (deviation × spread), so cards are already
  directly comparable — no change needed there.
- Comprehension of the comparison comes from: **labeled axes** (default on) and an optional
  **league-average reference line** — a faint line at the league mean drawn behind the player's
  average, so each person reads as a deviation from the pack. This is a **renderer extension** to
  `buildChart` (draw the league-average polyline when `showLeagueAvg` and a `leagueAvg` vector is
  provided). The engine already computes `leagueSig`; expose it so the component can pass the average
  vector to `buildChart`.

## 5. Cleanup

- Remove: bside `tasteSettings.svelte.ts`, `atoms/TasteSettings.svelte`, the ⚙ cog + `settingsOpen`
  state in `ProfileScreen.svelte`.
- The ShareOverlay signature path stays (it now shows the rich card + the Share/Download action).

## Components / files touched

- **bside:** `taste-waveform/taste-waveform.ts` (buildChart league-avg line; read display settings),
  `TasteWaveform.svelte` (toggle-driven elements + Share button), `taste-waveform.css` (`.tw-*` for
  labels/key/legend), `ProfileScreen.svelte` (remove cog), `ShareOverlay.svelte` (Share/Download),
  `types.ts` (`TasteBlock.settings`), + `html-to-image` dep. Remove `tasteSettings.svelte.ts`,
  `atoms/TasteSettings.svelte`.
- **ui:** `dashboard/tasteData.ts` or `buildReadModel.ts` (resolve settings from `settings` table →
  `read_model.taste.settings`), the update path, a settings-apply endpoint (patch live read_models on
  Save), `settings/setup/+page.svelte` (the App-setup controls + live sample), `db/settings.ts` +
  `schema.ts` DEFAULT_SETTINGS (the `taste_*` keys), a shared `TasteWaveform` for the live sample.
- **shared:** the same `TasteWaveform.svelte` + engine already exist in both apps (duplicated per the
  isolation constraint) — keep them in sync.

## Success criteria

- The card reads as self-explanatory: a non-player can tell what each axis means and where the person
  sits, from the image alone.
- Tapping Share produces a true-to-screen PNG and offers native share / download.
- Changing a setting in the App-setup tab updates the live sample instantly and, on Save, the live
  profiles (after the cheap patch) — one config for everyone, no per-profile cog.

## Out of scope (follow-ups)

- Archetype dedup within a league (still pending from v1).
- Embedding marks into the exported digest PNG (surface D effect).
