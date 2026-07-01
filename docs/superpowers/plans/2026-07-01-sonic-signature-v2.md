# Sonic Signature v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Taste Waveform card self-explanatory, shareable as an image, and driven by one system-wide config in the admin Settings tab (no per-profile cog).

**Architecture:** The framework-agnostic engine (`taste-waveform.ts`, duplicated in `bside/` and `ui/`) gains display-toggle awareness + an optional league-average line in `buildChart`. Settings resolve server-side from the `settings` table into `read_model.taste.settings`; bside reads that (localStorage removed). The card component renders elements per the toggles. Sharing rasterizes the card client-side via `html-to-image` → Web Share / download.

**Tech Stack:** Svelte 5 (bside = plain Vite SPA, ui = SvelteKit), better-sqlite3, zod, `html-to-image` (new, bside only), puppeteer-core (existing, for verification screenshots).

## Global Constraints

- Engine math is LOCKED — do not retune `weightsFor/songset/statDevs/eclect/sig6/leagueSig/relDev/nameOf/proseFor/chipsFor`. Only additive changes (league-avg line, reading settings).
- `bside/` and `ui/` are isolated packages — the shared `taste-waveform.ts` + `TasteWaveform.svelte` are DUPLICATED; edit both copies identically.
- bside is a static, no-login site (different origin from ui) → it cannot read admin localStorage; system settings reach it only via `read_model.taste.settings`.
- Mashco tokens + `.tw-*` prefix only. Downvote/repel = `#e6566c`. No new colors.
- Both apps must `npm run check` at 0 errors before each commit.
- Commit locally on `master`; do NOT push.

---

### Task 1: Extend TasteSettings with display toggles + league-average line in the engine

**Files:**
- Modify: `bside/src/lib/taste-waveform/taste-waveform.ts` AND `ui/src/lib/taste-waveform/taste-waveform.ts` (identical edits)

**Interfaces:**
- Produces: `TasteSettings` now includes `showLabels, showKey, showRead, showChips, showLeagueAvg: boolean`; `DEFAULT_TASTE_SETTINGS` sets all true except `showLeagueAvg` (default false). `TasteEngine` gains `leagueAvg: () => number[]` (the 6-axis league mean) and `buildChart(pi, W, H, opts)` accepts `opts.leagueAvg?: number[]` — when present, draws a faint dashed reference polyline at those axis values behind the player's average.

- [ ] **Step 1: Add the display toggles to the type + defaults**

In both `taste-waveform.ts`, extend:
```ts
export interface TasteSettings {
	signal: SignalMode; votePct: number; negatives: boolean; dnPct: number;
	lyrWeight: number; spread: number; scopeAll: boolean;
	showLabels: boolean; showKey: boolean; showRead: boolean; showChips: boolean; showLeagueAvg: boolean;
}
export const DEFAULT_TASTE_SETTINGS: TasteSettings = {
	signal: 'frac', votePct: 5, negatives: true, dnPct: 100, lyrWeight: 0.45, spread: 1.15, scopeAll: true,
	showLabels: true, showKey: true, showRead: true, showChips: true, showLeagueAvg: false,
};
```

- [ ] **Step 2: Expose the league average from the engine**

In `tasteEngine(...)`, after `leagueSig` is computed, add to the returned object:
```ts
leagueAvg: () => leagueSig.slice(),
```
and add `leagueAvg: () => number[];` to the `TasteEngine` interface.

- [ ] **Step 3: Draw the league-average line in buildChart**

Add to `BuildChartOpts`: `leagueAvg?: number[];`. Inside `buildChart`, immediately BEFORE the player-average block (`const V = sig6(pi); const avgDev = ...`), insert:
```ts
if (opts.leagueAvg) {
	const laDev = ORDER.map((idx) => TX(aA(idx, opts.leagueAvg![idx])));
	const laPts = laDev.map((d, k) => ({ x: xk(k), y: yd(d), dev: d }));
	seg(laPts, ORDER).forEach((sg) => kids.push(svgEl('path', { d: sg.d, fill: 'none', stroke: '#5a6773', strokeWidth: 1.5, opacity: 0.5, strokeLinecap: 'round', strokeDasharray: '3 4' })));
}
```
(Uses the existing `TX`, `aA`, `ORDER`, `xk`, `yd`, `seg`, `svgEl` in scope.)

- [ ] **Step 4: Verify both apps typecheck**

Run: `cd bside && npm run check` then `cd ../ui && npm run check`
Expected: 0 errors each.

- [ ] **Step 5: Verify the line renders (harness)**

Reuse the render pattern (esbuild a tiny script importing `tasteEngine` + package `league-data.js`, call `buildChart(4, 320, 150, { chrome: true, leagueAvg: eng.leagueAvg() })`, screenshot via puppeteer-core to a temp PNG). Confirm a faint dashed reference line appears behind Mara's average.

- [ ] **Step 6: Commit**

```bash
git add bside/src/lib/taste-waveform/taste-waveform.ts ui/src/lib/taste-waveform/taste-waveform.ts
git commit -m "feat(taste-waveform): display toggles + league-average reference line"
```

---

### Task 2: Toggle-driven rich card + Share action in TasteWaveform.svelte

**Files:**
- Modify: `bside/src/lib/taste-waveform/TasteWaveform.svelte` AND `ui/src/lib/taste-waveform/TasteWaveform.svelte` (identical)
- Modify: `bside/src/lib/taste-waveform/taste-waveform.css` AND `ui/src/lib/taste-waveform/taste-waveform.css` (identical) — add `.tw-key`, `.tw-legend`
- Modify: `bside/package.json` — add `html-to-image` dependency

**Interfaces:**
- Consumes: `TasteEngine.leagueAvg`, `TasteSettings` display toggles.
- Produces: `<TasteWaveform>` gains props `settings: TasteSettings` (drives which elements show + passes `leagueAvg`), and `onshare?: () => void`. The `card` and `hero` variants render: labeled chart (settings.showLabels → chrome), chips (showChips), read (showRead), key caption (showKey), league-avg line (showLeagueAvg). A Share button appears when `onshare` is provided.

- [ ] **Step 1: Add html-to-image to bside**

Run: `cd bside && npm install html-to-image`
Confirm it lands in `bside/package.json` dependencies.

- [ ] **Step 2: Rewrite the card/hero variants to be toggle-driven**

In both `TasteWaveform.svelte`, add `settings` (defaulting to `DEFAULT_TASTE_SETTINGS`) and `onshare` to Props. Compute:
```ts
const svg = $derived(engine.buildChart(pi, dims.w, dims.h, {
	chrome: settings.showLabels && variant !== 'row' && variant !== 'mark',
	nodes: true,
	leagueAvg: settings.showLeagueAvg ? engine.leagueAvg() : undefined,
}));
const chips = $derived(settings.showChips ? engine.chipsFor(pi) : []);
```
For the `card` variant body, render (in order): head, archetype name, wave, `{#if settings.showChips}` chips, `{#if settings.showRead}` read, `{#if settings.showKey}` `<div class="tw-key">━ your average · faint = your songs · - - downvotes</div>`, then a Share row `{#if onshare}<button class="tw-share" onclick={onshare}>Share</button>`, then foot. Mirror the show-flags in `hero`.

- [ ] **Step 3: Add the CSS**

In both `taste-waveform.css` add:
```css
.tw-key { font-family:'JetBrains Mono',monospace; font-size:8.5px; color:var(--fg-quiet); text-align:center; margin:6px 0; }
.tw-share { font-family:'JetBrains Mono',monospace; font-size:11px; text-transform:uppercase; letter-spacing:.06em; width:100%; padding:8px; margin-top:8px; border-radius:var(--r-3); border:1px solid var(--mash-pulp); background:var(--mash-pulp-soft,#ff5b2e22); color:var(--mash-pulp); cursor:pointer; }
```

- [ ] **Step 4: Verify both apps typecheck**

Run: `cd bside && npm run check` && `cd ../ui && npm run check` → 0 errors.

- [ ] **Step 5: Commit**

```bash
git add bside/src/lib/taste-waveform ui/src/lib/taste-waveform bside/package.json bside/package-lock.json
git commit -m "feat(taste-waveform): toggle-driven rich card + share button"
```

---

### Task 3: Resolve system settings server-side into read_model.taste.settings

**Files:**
- Modify: `ui/src/lib/db/schema.ts` (DEFAULT_SETTINGS: add `taste_settings` JSON key)
- Modify: `ui/src/lib/db/settings.ts` (a `getTasteSettings(db)` helper)
- Modify: `ui/src/lib/dashboard/tasteData.ts` (TasteBlock gains `settings`)
- Modify: `ui/src/lib/dashboard/buildReadModel.ts` (TasteBlockSchema.settings; attach resolved settings)
- Modify: `ui/src/routes/api/content/[leagueId]/update/+server.ts` (same attach)
- Modify: `bside/src/lib/types.ts` (`TasteBlock.settings?`)

**Interfaces:**
- Produces: `getTasteSettings(db): TasteSettings` reads the `taste_settings` JSON row (falls back to DEFAULT_TASTE_SETTINGS). `read_model.taste.settings: TasteSettings`.

- [ ] **Step 1: Add the settings key + helper**

`schema.ts` DEFAULT_SETTINGS: add `taste_settings: JSON.stringify(DEFAULT_TASTE_SETTINGS-equivalent object)` (inline the object; DEFAULT lives in taste-waveform.ts which ui can't import into schema cheaply — inline the literal). `settings.ts`: add
```ts
export function getTasteSettings(db: Database.Database): TasteSettings {
	const row = db.prepare("SELECT value FROM settings WHERE key='taste_settings'").get() as { value: string } | undefined;
	try { return { ...DEFAULTS, ...(row ? JSON.parse(row.value) : {}) }; } catch { return { ...DEFAULTS }; }
}
```
where `DEFAULTS` = the literal default object (7 knobs + 5 toggles).

- [ ] **Step 2: Thread settings into the taste block**

`tasteData.ts`: `TasteBlock` gains `settings: TasteSettings`. `buildTasteData(db, members, settings)` takes settings and returns it in the block. `buildReadModel.ts` + the update path: `const tasteSettings = getTasteSettings(db); const taste = buildTasteData(db, members, tasteSettings);`. Extend `TasteBlockSchema` with `settings: z.object({...}).passthrough()` (or a permissive object). `bside/types.ts` `TasteBlock` gains `settings?: {...}`.

- [ ] **Step 3: Verify ui typecheck + a build produces settings**

Run: `cd ui && npm run check` → 0 errors. Then esbuild-run a harness that calls `buildTasteData` and asserts `.settings` is present.

- [ ] **Step 4: Commit**

```bash
git add ui/src/lib/db ui/src/lib/dashboard bside/src/lib/types.ts ui/src/routes/api/content
git commit -m "feat(taste-waveform): resolve system settings into read_model.taste.settings"
```

---

### Task 4: bside reads read_model settings; remove per-profile cog + localStorage

**Files:**
- Modify: `bside/src/routes/ProfileScreen.svelte` (use `readModel.taste.settings`; remove cog + settingsOpen; pass settings to `<TasteWaveform>`; wire `onshare`)
- Modify: `bside/src/lib/atoms/ShareOverlay.svelte` (pass settings; wire Share/Download)
- Delete: `bside/src/lib/tasteSettings.svelte.ts`, `bside/src/lib/atoms/TasteSettings.svelte`

**Interfaces:**
- Consumes: `readModel.taste.settings` (fallback `DEFAULT_TASTE_SETTINGS`).

- [ ] **Step 1: Swap settings source + remove the cog**

In `ProfileScreen.svelte`: `import { DEFAULT_TASTE_SETTINGS } from '../lib/taste-waveform/taste-waveform.js';` `const tset = $derived(readModel.taste?.settings ?? DEFAULT_TASTE_SETTINGS);` Use `tset` in `scopedLeague(readModel.taste, tset, ...)` and pass `settings={tset}` to `<TasteWaveform variant="hero">`. Remove `tasteSettings` import, `settingsOpen` state, the ⚙ button, and the `<TasteSettings>` mount.

- [ ] **Step 2: Delete the dead files**

Run: `git rm bside/src/lib/tasteSettings.svelte.ts bside/src/lib/atoms/TasteSettings.svelte`

- [ ] **Step 3: Verify bside typecheck**

Run: `cd bside && npm run check` → 0 errors (fix any dangling import).

- [ ] **Step 4: Commit**

```bash
git add -A bside/src
git commit -m "refactor(taste-waveform): bside reads system settings from read_model; remove per-profile cog"
```

---

### Task 5: Client-side image share (Share/Download)

**Files:**
- Create: `bside/src/lib/shareImage.ts` (rasterize + share/download helper)
- Modify: `bside/src/lib/atoms/ShareOverlay.svelte` + `ProfileScreen.svelte` (wire `onshare` → shareImage on the card element)

**Interfaces:**
- Produces: `shareCardImage(node: HTMLElement, filename: string): Promise<void>` — `toPng(node)` via html-to-image, then `navigator.canShare({files})` ? `navigator.share(...)` : download anchor.

- [ ] **Step 1: Write the helper**

```ts
import { toPng } from 'html-to-image';
export async function shareCardImage(node: HTMLElement, filename: string): Promise<void> {
	const dataUrl = await toPng(node, { pixelRatio: 2, cacheBust: true, backgroundColor: '#0d1116' });
	const res = await fetch(dataUrl); const blob = await res.blob();
	const file = new File([blob], filename, { type: 'image/png' });
	if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file] }); return; } catch { /* fall through to download */ } }
	const a = document.createElement('a'); a.href = dataUrl; a.download = filename; a.click();
}
```

- [ ] **Step 2: Wire it**

In `ShareOverlay.svelte` signature branch: `bind:this` the card wrapper, pass `onshare={() => shareCardImage(cardEl, 'sonic-signature-' + payload.who + '.png')}` to `<TasteWaveform variant="card">`. In `ProfileScreen.svelte` hero, either reuse the existing ShareOverlay path (preferred — the openWaveShare already routes to the rich card in the overlay) or add a direct share on the hero card element.

- [ ] **Step 3: Verify typecheck + a real rasterization**

Run: `cd bside && npm run check` → 0 errors. Then: build bside, load a live profile in puppeteer, click Share, intercept the generated dataURL / download, save the PNG, and visually confirm the card rasterized true (fonts + gradient present, not blank).

- [ ] **Step 4: Commit**

```bash
git add bside/src/lib/shareImage.ts bside/src/lib/atoms/ShareOverlay.svelte bside/src/routes/ProfileScreen.svelte bside/package.json
git commit -m "feat(taste-waveform): client-side card image share/download"
```

---

### Task 6: Admin Settings App-setup tab + live sample + apply-to-live

**Files:**
- Modify: `ui/src/routes/settings/setup/+page.svelte` (the controls + a live `<TasteWaveform>` sample)
- Create: `ui/src/routes/api/settings/taste/+server.ts` (GET current, POST save → write `settings` table + patch live read_models)
- Modify: `ui/src/lib/dashboard/publish.ts` or a small `applyTasteSettings.ts` (patch `read_model.taste.settings` into every published read_model + dashboard_sites, cheap, no LLM)

**Interfaces:**
- Consumes: `getTasteSettings`, `TasteWaveform`, sample league data (fetch `/api/history/taste`).
- Produces: POST `/api/settings/taste` body = `TasteSettings` → persists + patches → 200.

- [ ] **Step 1: The save/apply endpoint**

`POST /api/settings/taste`: validate body (zod), `INSERT OR REPLACE INTO settings(key,value) VALUES('taste_settings', ?)`, then for each `dashboard_sites` row read `digests/<slug>/read_model.json`, set `rm.taste.settings = body`, write back + update `dashboard_sites.read_model`. `GET` returns `getTasteSettings(db)`.

- [ ] **Step 2: The App-setup controls + live sample**

In `settings/setup/+page.svelte` add a "Taste Waveform" panel: the engine controls (segmented signal, sliders, toggles) bound to a local `settings` state; a live `<TasteWaveform variant="card" engine={sampleEng} pi={0} settings={settings}>` where `sampleEng = tasteEngine(sampleBlock, settings)` from `/api/history/taste`; a Save button → POST. Reuse the control styling from the removed `TasteSettings.svelte` (copy the markup) + add the 5 display toggles.

- [ ] **Step 3: Verify ui typecheck + endpoint**

Run: `cd ui && npm run check` → 0 errors. Curl POST a settings body to a running dev/prod instance, confirm 200 + the read_model.json `taste.settings` changed.

- [ ] **Step 4: Commit**

```bash
git add ui/src/routes/settings/setup ui/src/routes/api/settings ui/src/lib/dashboard
git commit -m "feat(settings): system-wide Taste Waveform config with live sample + apply-to-live"
```

---

### Task 7: Deploy + verify live

- [ ] **Step 1:** `cd bside && npm run build` → copy `dist/bside.js` + `dist/bside.css` to `digests/_bside/` (back up current as `*.bak-<ts>`).
- [ ] **Step 2:** `docker compose build bot-ui && docker compose up -d --force-recreate bot-ui` from the main checkout on `master`.
- [ ] **Step 3:** Patch `read_model.taste.settings` into the 3 live leagues (run the settings POST once, or the in-container patch) so the rich card + toggles are live.
- [ ] **Step 4 (assert):** grep served `digests/_bside/bside.js` for a new UI string (`tw-key` / `Share`); grep `/app/ui/build/client` for the settings panel; screenshot a live profile → confirm rich card + Share button; click Share → confirm a true PNG.
- [ ] **Step 5:** Report status. Do not push (per policy).

---

## Self-Review

- **Spec coverage:** §1 rich card+toggles → Task 2; §2 system settings → Tasks 3+6; §3 image share → Tasks 2+5; §4 league-avg line → Task 1; §5 cleanup → Task 4. All covered.
- **Placeholders:** none — each step has concrete code/commands.
- **Type consistency:** `TasteSettings` (Task 1) is the single source used in 2/3/4/6; `leagueAvg()` (Task 1) consumed in Task 2; `read_model.taste.settings` (Task 3) consumed in Tasks 4/6.
