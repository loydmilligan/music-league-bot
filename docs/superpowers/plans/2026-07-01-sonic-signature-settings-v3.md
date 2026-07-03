# Sonic Signature settings v3 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the dropped Taste Waveform "look" knobs (palette, line style, nodes, axis order, band, amplitude), an in-panel league→player full-profile preview, a league separation score, and collapsible settings panels.

**Architecture:** All render/math changes live in the pure engine `taste-waveform.ts`, which exists as **two identical copies** (`ui/` and `bside/`) that must stay in lockstep. The settings API validates + persists the new fields and applies them to every live `read_model.taste.settings` (existing path, unchanged mechanics). The settings-panel UI (`settings/setup`) gains the look controls, pickers, preview, and separation readout. A new generic `CollapsiblePanel` wraps every section in both settings tabs.

**Tech Stack:** SvelteKit (adapter-node, Svelte 5 runes), TypeScript (ESM, `.js` import specifiers), better-sqlite3, Zod, Vitest.

## Global Constraints

- **Two engine copies stay identical:** every change to `ui/src/lib/taste-waveform/taste-waveform.ts` is applied verbatim to `bside/src/lib/taste-waveform/taste-waveform.ts`. Same for any exported type.
- **Back-compat is mandatory:** all new `TasteSettings` defaults must reproduce the current render exactly. `amplitude` default is **`1.0`** (not the toy's 1.2). Consumers already merge `{ ...DEFAULT_TASTE_SETTINGS, ...loaded }`, so old `read_model.taste.settings` blobs stay valid.
- **ESM imports:** intra-package imports use `.js` specifiers (e.g. `from './taste-waveform.js'`).
- **Test runner:** `cd ui && npm run test` (Vitest, `vitest run`). Type gate: `cd ui && npm run check`.
- **No new colors beyond the three palettes** defined here (`neon`/`cool`/`spectrum`).
- **Commit after every task.** Do not `git push` (project policy).
- **Settings remain system-wide** — no per-player persistence.

---

## File structure

- `ui/src/lib/taste-waveform/taste-waveform.ts` — engine (types, THEMES, ORDERS, buildChart, separation). **Mirror in** `bside/src/lib/taste-waveform/taste-waveform.ts`.
- `ui/src/lib/taste-waveform/taste-waveform.test.ts` — **new** engine unit tests (ui copy only).
- `ui/src/lib/db/settings.ts` — DRY `DEFAULT_TASTE_SETTINGS` to import from the engine.
- `ui/src/routes/api/settings/taste/+server.ts` — extend Zod schema.
- `ui/src/routes/api/settings/taste/server.test.ts` — **new** API validation test.
- `ui/src/lib/components/panelState.ts` — **new** pure localStorage helper for collapse state.
- `ui/src/lib/components/panelState.test.ts` — **new** unit test.
- `ui/src/lib/components/CollapsiblePanel.svelte` — **new** generic collapsible wrapper.
- `ui/src/routes/settings/+page.svelte` — wrap App Settings panels.
- `ui/src/routes/settings/setup/+page.svelte` — wrap ML Setup panels + add look controls, pickers, preview, separation readout.

---

### Task 1: Engine — settings fields, THEMES, ORDERS, palette/order resolution

**Files:**
- Modify: `ui/src/lib/taste-waveform/taste-waveform.ts` (types L47–71; engine scope ~L137–139)
- Mirror: `bside/src/lib/taste-waveform/taste-waveform.ts` (identical edits)
- Modify: `ui/src/lib/db/settings.ts:6-9` (DRY the default)
- Test: `ui/src/lib/taste-waveform/taste-waveform.test.ts` (new)

**Interfaces:**
- Produces: extended `TasteSettings` (adds `palette`, `lineStyle`, `nodeStyle`, `order`, `band`, `bandOpacity`, `amplitude`); exported `PaletteName`, `LineStyle`, `NodeStyle`, `OrderName`; exported const maps `THEMES`, `ORDERS`; unchanged `tasteEngine(LG, settings)` signature.

- [ ] **Step 1: Write the failing test**

Create `ui/src/lib/taste-waveform/taste-waveform.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  tasteEngine, THEMES, ORDERS, DEFAULT_TASTE_SETTINGS,
  type LeagueData, type TasteSettings,
} from './taste-waveform.js';

// Minimal 2-player league. axes: [obscurity,energy,mood,tempo,lyrical].
// rows: [songIdx, interaction(0=sub,1=vote), points, roundId, hasComment, leagueId].
const LG: LeagueData = {
  axes: [[20, 80, 60, 70, 90], [80, 30, 40, 30, 10], [50, 50, 50, 50, 50]],
  players: [
    { name: 'Alice Ex', rows: [[0, 0, 0, 1, 0, 1], [1, 0, 0, 2, 0, 1]] },
    { name: 'Bob Ry',   rows: [[2, 0, 0, 1, 0, 1], [1, 0, 0, 2, 0, 1]] },
  ],
};
const S = (o: Partial<TasteSettings> = {}): TasteSettings => ({ ...DEFAULT_TASTE_SETTINGS, ...o });

describe('palette + order maps', () => {
  it('exposes the three palettes with a traits array and above color', () => {
    for (const p of ['neon', 'cool', 'spectrum'] as const) {
      expect(THEMES[p].traits).toHaveLength(6);
      expect(THEMES[p].above).toMatch(/^#[0-9a-f]{6}$/i);
    }
    expect(THEMES.neon.traits[0]).toBe('#ff5bbe'); // == legacy TRAITS[0]
  });
  it('exposes the four axis orders', () => {
    expect(ORDERS.alt).toEqual([0, 4, 3, 2, 1]);
    expect(ORDERS.raw).toEqual([0, 1, 2, 3, 4]);
    expect(ORDERS['lyric-last']).toEqual([0, 2, 3, 1, 4]);
    expect(ORDERS['lyric-first']).toEqual([4, 0, 1, 2, 3]);
  });
});

describe('axis order changes chrome label sequence', () => {
  it('alt puts WORDY (axis4) before HYPE (axis1); raw reverses that', () => {
    const alt = tasteEngine(LG, S({ order: 'alt' })).buildChart(0, 322, 150, { chrome: true });
    const raw = tasteEngine(LG, S({ order: 'raw' })).buildChart(0, 322, 150, { chrome: true });
    expect(alt.indexOf('WORDY')).toBeLessThan(alt.indexOf('HYPE'));
    expect(raw.indexOf('HYPE')).toBeLessThan(raw.indexOf('WORDY'));
  });
});

describe('defaults preserve the current render', () => {
  it('default palette=neon, order=alt still draws the thick strand at width 4.5', () => {
    const svg = tasteEngine(LG, S()).buildChart(0, 322, 150);
    expect(svg).toContain('stroke-width="4.5"'); // strand stroke unchanged
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npm run test -- taste-waveform`
Expected: FAIL — `THEMES`/`ORDERS` not exported; new settings fields missing.

- [ ] **Step 3: Implement — types, maps, resolution**

In `ui/src/lib/taste-waveform/taste-waveform.ts`:

Replace the `TasteSettings` interface + default (currently L47–61) with:

```ts
export type SignalMode = 'all' | 'subs' | 'top' | 'frac';
export type PaletteName = 'neon' | 'cool' | 'spectrum';
export type LineStyle = 'strand' | 'solid' | 'none';
export type NodeStyle = 'glow' | 'dot' | 'none';
export type OrderName = 'alt' | 'raw' | 'lyric-last' | 'lyric-first';

export interface TasteSettings {
	signal: SignalMode;
	votePct: number;
	negatives: boolean;
	dnPct: number;
	lyrWeight: number;
	spread: number;
	scopeAll: boolean;
	showLabels: boolean; showKey: boolean; showRead: boolean; showChips: boolean; showLeagueAvg: boolean;
	// v3 look knobs
	palette: PaletteName;
	lineStyle: LineStyle;
	nodeStyle: NodeStyle;
	order: OrderName;
	band: boolean;
	bandOpacity: number;
	amplitude: number;
}
export const DEFAULT_TASTE_SETTINGS: TasteSettings = {
	signal: 'frac', votePct: 5, negatives: true, dnPct: 100, lyrWeight: 0.45, spread: 1.15, scopeAll: true,
	showLabels: true, showKey: true, showRead: true, showChips: true, showLeagueAvg: false,
	palette: 'neon', lineStyle: 'strand', nodeStyle: 'glow', order: 'alt', band: false, bandOpacity: 0.04, amplitude: 1.0,
};
```

Replace the locked constants block for `TRAITS` and `ORDER` (currently L66 and L70) with the maps (keep `POLES`, `REPEL`, `aA` as-is):

```ts
export const THEMES: Record<PaletteName, { traits: string[]; above: string }> = {
	neon:     { traits: ['#ff5bbe', '#ffd23a', '#5affd0', '#5a8cff', '#ff5b6e', '#b65bff'], above: '#5affd0' },
	cool:     { traits: ['#5aa3ff', '#3fb6c4', '#3ec27a', '#6a8cff', '#4ad0d9', '#5ad0a0'], above: '#7fd0ff' },
	spectrum: { traits: ['#ff5b2e', '#e8a83a', '#5aa3ff', '#3ec27a', '#e6566c', '#3fb6c4'], above: '#5aa3ff' },
};
export const ORDERS: Record<OrderName, number[]> = {
	alt: [0, 4, 3, 2, 1], raw: [0, 1, 2, 3, 4], 'lyric-last': [0, 2, 3, 1, 4], 'lyric-first': [4, 0, 1, 2, 3],
};
```

Inside `tasteEngine(LG, settings)`, right after `const st = settings;` (L138), add the per-build resolution:

```ts
	const TH = THEMES[st.palette] ?? THEMES.neon;
	const TRAITS = TH.traits;
	const ORDER = ORDERS[st.order] ?? ORDERS.alt;
```

(These shadow the removed module constants; `TRAITS`/`ORDER` are only referenced inside `buildChart`, so no other call site changes.)

- [ ] **Step 4: DRY the db default**

In `ui/src/lib/db/settings.ts`, delete the local `DEFAULT_TASTE_SETTINGS` (L6–9) and import it:

```ts
import { DEFAULT_TASTE_SETTINGS, type TasteSettings } from '../taste-waveform/taste-waveform.js';
```

Leave `getTasteSettings` body unchanged (it already spreads `DEFAULT_TASTE_SETTINGS`).

- [ ] **Step 5: Mirror into bside**

Apply the identical type/map/resolution edits (Step 3) to `bside/src/lib/taste-waveform/taste-waveform.ts`. (bside has no `db/settings.ts`.)

- [ ] **Step 6: Run tests + typecheck**

Run: `cd ui && npm run test -- taste-waveform && npm run check`
Expected: PASS; svelte-check clean.

- [ ] **Step 7: Commit**

```bash
git add ui/src/lib/taste-waveform/taste-waveform.ts ui/src/lib/taste-waveform/taste-waveform.test.ts ui/src/lib/db/settings.ts bside/src/lib/taste-waveform/taste-waveform.ts
git commit -m "feat(taste-waveform): palette + axis-order settings, THEMES/ORDERS maps"
```

---

### Task 2: Engine — buildChart honors lineStyle, nodeStyle, amplitude, band

**Files:**
- Modify: `ui/src/lib/taste-waveform/taste-waveform.ts` (`buildChart`, ~L196–250)
- Mirror: `bside/src/lib/taste-waveform/taste-waveform.ts`
- Test: `ui/src/lib/taste-waveform/taste-waveform.test.ts` (append)

**Interfaces:**
- Consumes: `st.lineStyle`, `st.nodeStyle`, `st.amplitude`, `st.band`, `st.bandOpacity`, `TH`, `TRAITS`, `ORDER` (Task 1).
- Produces: no signature change; `BuildChartOpts.nodes` is now ignored (superseded by `st.nodeStyle`) — leave the field in the interface for back-compat but stop reading it.

- [ ] **Step 1: Write the failing tests** (append to the test file)

```ts
describe('lineStyle', () => {
  const base = { chrome: false } as const;
  it('strand (default) draws the gradient strand at width 4.5', () => {
    expect(tasteEngine(LG, S({ lineStyle: 'strand' })).buildChart(0, 322, 150, base)).toContain('stroke-width="4.5"');
  });
  it('none omits the thick strand', () => {
    expect(tasteEngine(LG, S({ lineStyle: 'none' })).buildChart(0, 322, 150, base)).not.toContain('stroke-width="4.5"');
  });
  it('solid draws a flat above-color line at width 3', () => {
    const svg = tasteEngine(LG, S({ lineStyle: 'solid', palette: 'cool' })).buildChart(0, 322, 150, base);
    expect(svg).toContain('stroke-width="3"');
    expect(svg).toContain('#7fd0ff'); // cool.above, literal (not gradient)
  });
});

describe('nodeStyle', () => {
  it('glow (default) emits the r=8 halo circle', () => {
    expect(tasteEngine(LG, S({ nodeStyle: 'glow' })).buildChart(0, 322, 150, { chrome: false })).toContain('r="8"');
  });
  it('none emits no node circles', () => {
    const svg = tasteEngine(LG, S({ nodeStyle: 'none' })).buildChart(0, 322, 150, { chrome: false });
    expect(svg).not.toContain('r="8"');
    expect(svg).not.toContain('r="3.4"');
  });
  it('dot emits a single r=3.4 dot', () => {
    const svg = tasteEngine(LG, S({ nodeStyle: 'dot' })).buildChart(0, 322, 150, { chrome: false });
    expect(svg).toContain('r="3.4"');
    expect(svg).not.toContain('r="8"');
  });
});

describe('amplitude + band', () => {
  it('amplitude changes the geometry', () => {
    const a = tasteEngine(LG, S({ amplitude: 1.0 })).buildChart(0, 322, 150, { chrome: false });
    const b = tasteEngine(LG, S({ amplitude: 1.8 })).buildChart(0, 322, 150, { chrome: false });
    expect(a).not.toBe(b);
  });
  it('band draws a filled above-color area at bandOpacity', () => {
    const svg = tasteEngine(LG, S({ band: true, bandOpacity: 0.04, palette: 'neon' })).buildChart(0, 322, 150, { chrome: false });
    expect(svg).toContain('fill="#5affd0"');
    expect(svg).toContain('opacity="0.04"');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd ui && npm run test -- taste-waveform`
Expected: FAIL — solid/dot/band/amplitude branches not implemented.

- [ ] **Step 3: Implement in buildChart**

(a) **amplitude** — change the `scale` line (currently L199) to:

```ts
		const padX = W * 0.06, padY = H * (chrome ? 0.17 : 0.1), cy = H / 2, scale = (H / 2 - padY) / 50 * (st.amplitude ?? 1);
```

(b) **band** — insert immediately BEFORE the `let sk = 0;` sample loop (currently ~L233):

```ts
		if (st.band) {
			const pctf = (arr: number[], p: number): number => {
				if (!arr.length) return 0;
				const a = arr.slice().sort((x, y) => x - y); const i = (a.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
				return a[lo] + (a[hi] - a[lo]) * (i - lo);
			};
			const cols = ORDER.map((_idx, k) => rows.filter((s) => s[5] > 0).map((s) => devAt(k, s)));
			const p10 = cols.map((c) => pctf(c, 0.1)), p90 = cols.map((c) => pctf(c, 0.9));
			const top = p90.map((d, k) => ({ x: xk(k), y: yd(d), dev: d }));
			const bot = p10.map((d, k) => ({ x: xk(k), y: yd(d), dev: d })).reverse();
			const bandD = seg(top, ORDER).map((s) => s.d).join(' ') + ' L ' + bot.map((p) => p.x.toFixed(1) + ' ' + p.y.toFixed(1)).join(' L ') + ' Z';
			kids.push(svgEl('path', { d: bandD, fill: TH.above, opacity: st.bandOpacity }));
		}
```

(c) **lineStyle** — replace the two unconditional avg-strand `forEach` lines (currently L246–247) with:

```ts
		if (st.lineStyle === 'strand') {
			avgSegs.forEach((sg) => kids.push(svgEl('path', { d: sg.d, fill: 'none', stroke: '#07090c', strokeWidth: H < 70 ? 4 : 6.5, opacity: 0.45, strokeLinecap: 'round' })));
			avgSegs.forEach((sg) => kids.push(svgEl('path', { d: sg.d, fill: 'none', stroke: strokeOf(sg), strokeWidth: H < 70 ? 3 : 4.5, opacity: 0.92, strokeLinecap: 'round' })));
		} else if (st.lineStyle === 'solid') {
			avgSegs.forEach((sg) => kids.push(svgEl('path', { d: sg.d, fill: 'none', stroke: '#07090c', strokeWidth: H < 70 ? 3.5 : 6, opacity: 0.5, strokeLinecap: 'round' })));
			avgSegs.forEach((sg) => kids.push(svgEl('path', { d: sg.d, fill: 'none', stroke: TH.above, strokeWidth: H < 70 ? 2 : 3, opacity: 0.95, strokeLinecap: 'round' })));
		}
		// lineStyle === 'none' → draw nothing
```

(d) **nodeStyle** — replace the node line (currently L248, `if (opts.nodes !== false) avgPts.forEach(...)`) with:

```ts
		if (st.nodeStyle !== 'none') avgPts.forEach((p, k) => {
			const c = applyBright(TRAITS[ORDER[k]], Math.min(1, Math.abs(avgDev[k]) / cm[k]));
			if (st.nodeStyle === 'glow') {
				kids.push(svgEl('circle', { cx: p.x, cy: p.y, r: H < 70 ? 5 : 8, fill: c, opacity: 0.15 }));
				kids.push(svgEl('circle', { cx: p.x, cy: p.y, r: H < 70 ? 1.7 : 2.1, fill: mix(c, '#ffffff', 0.3), opacity: 0.95 }));
			} else {
				kids.push(svgEl('circle', { cx: p.x, cy: p.y, r: 3.4, fill: TRAITS[ORDER[k]], stroke: '#07090c', strokeWidth: 1.4 }));
			}
		});
```

> Note: the `avgSegs` / `avgPts` / `avgDev` / `cm` locals are already computed just above these lines (current L245) — do not duplicate them.

- [ ] **Step 4: Mirror into bside** — apply (a)–(d) identically to `bside/src/lib/taste-waveform/taste-waveform.ts`.

- [ ] **Step 5: Run tests + typecheck**

Run: `cd ui && npm run test -- taste-waveform && npm run check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add ui/src/lib/taste-waveform/taste-waveform.ts ui/src/lib/taste-waveform/taste-waveform.test.ts bside/src/lib/taste-waveform/taste-waveform.ts
git commit -m "feat(taste-waveform): lineStyle/nodeStyle/amplitude/band render knobs"
```

---

### Task 3: Engine — separation score

**Files:**
- Modify: `ui/src/lib/taste-waveform/taste-waveform.ts` (`TasteEngine` interface L126–135; return object L253)
- Mirror: `bside/src/lib/taste-waveform/taste-waveform.ts`
- Test: `ui/src/lib/taste-waveform/taste-waveform.test.ts` (append)

**Interfaces:**
- Produces: `TasteEngine.separation(): number` — mean Euclidean distance over all unordered player pairs in the engine's `sig6` space; `0` when `< 2` players. The panel computes the "×N vs all-votes" multiplier by dividing this by a second engine built with `signal:'all'`.

- [ ] **Step 1: Write the failing test** (append)

```ts
describe('separation()', () => {
  it('returns 0 for a single-player league', () => {
    const solo: LeagueData = { axes: LG.axes, players: [LG.players[0]] };
    expect(tasteEngine(solo, S()).separation()).toBe(0);
  });
  it('is the mean pairwise sig6 distance (positive for distinct players)', () => {
    const sep = tasteEngine(LG, S()).separation();
    expect(sep).toBeGreaterThan(0);
    // two players → exactly one pair → equals that pair's distance
    const eng = tasteEngine(LG, S());
    const a = eng.sig6(0), b = eng.sig6(1);
    const d = Math.sqrt(a.reduce((s, _v, k) => s + (a[k] - b[k]) ** 2, 0));
    expect(sep).toBeCloseTo(d, 6);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd ui && npm run test -- taste-waveform`
Expected: FAIL — `separation` not a function.

- [ ] **Step 3: Implement**

Add to the `TasteEngine` interface (after `buildChart`):

```ts
	separation: () => number;
```

Inside `tasteEngine`, just before the `return { ... }` (L253), add:

```ts
	const separation = (): number => {
		if (nP < 2) return 0;
		const sigs = PLAYERS.map((_, i) => sig6(i));
		let sum = 0, cnt = 0;
		for (let i = 0; i < nP; i++) for (let j = i + 1; j < nP; j++) {
			let d = 0; for (let k = 0; k < 6; k++) { const df = sigs[i][k] - sigs[j][k]; d += df * df; }
			sum += Math.sqrt(d); cnt++;
		}
		return cnt ? sum / cnt : 0;
	};
```

Add `separation` to the returned object:

```ts
	return { nP, name: (pi) => PLAYERS[pi].name, sig6, nameOf, proseFor, chipsFor, leagueAvg: () => leagueSig.slice(), buildChart, separation };
```

- [ ] **Step 4: Mirror into bside** — identical edits.

- [ ] **Step 5: Run tests + typecheck**

Run: `cd ui && npm run test -- taste-waveform && npm run check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add ui/src/lib/taste-waveform/taste-waveform.ts ui/src/lib/taste-waveform/taste-waveform.test.ts bside/src/lib/taste-waveform/taste-waveform.ts
git commit -m "feat(taste-waveform): separation() mean pairwise fingerprint distance"
```

---

### Task 4: API — extend the taste settings Zod schema

**Files:**
- Modify: `ui/src/routes/api/settings/taste/+server.ts:11-24` (`TasteSettingsSchema`)
- Test: `ui/src/routes/api/settings/taste/server.test.ts` (new)

**Interfaces:**
- Consumes: `TasteSettings` (Task 1).
- Produces: POST accepts + validates the seven new fields; unchanged `{ ok, patched }` response and apply-to-live behavior.

- [ ] **Step 1: Write the failing test**

Create `ui/src/routes/api/settings/taste/server.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// Rebuild the schema shape here to assert its contract without a live DB.
// This mirrors TasteSettingsSchema in +server.ts; keep in sync.
import { TasteSettingsSchema } from './+server.js';

const full = {
  signal: 'frac', votePct: 5, negatives: true, dnPct: 100, lyrWeight: 0.45, spread: 1.15, scopeAll: true,
  showLabels: true, showKey: true, showRead: true, showChips: true, showLeagueAvg: false,
  palette: 'cool', lineStyle: 'solid', nodeStyle: 'dot', order: 'raw', band: true, bandOpacity: 0.06, amplitude: 1.4,
};

describe('TasteSettingsSchema', () => {
  it('accepts a full v3 settings object', () => {
    expect(TasteSettingsSchema.safeParse(full).success).toBe(true);
  });
  it('rejects an unknown palette', () => {
    expect(TasteSettingsSchema.safeParse({ ...full, palette: 'rainbow' }).success).toBe(false);
  });
  it('rejects out-of-range amplitude', () => {
    expect(TasteSettingsSchema.safeParse({ ...full, amplitude: 9 }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd ui && npm run test -- settings/taste`
Expected: FAIL — `TasteSettingsSchema` is not exported; new fields absent.

- [ ] **Step 3: Implement**

In `ui/src/routes/api/settings/taste/+server.ts`, **export** the schema and add the fields:

```ts
export const TasteSettingsSchema = z.object({
	signal: z.enum(['all', 'subs', 'top', 'frac']),
	votePct: z.number().min(0).max(25),
	negatives: z.boolean(),
	dnPct: z.number().min(0).max(150),
	lyrWeight: z.number().min(0).max(1),
	spread: z.number().min(1).max(1.6),
	scopeAll: z.boolean(),
	showLabels: z.boolean(),
	showKey: z.boolean(),
	showRead: z.boolean(),
	showChips: z.boolean(),
	showLeagueAvg: z.boolean(),
	palette: z.enum(['neon', 'cool', 'spectrum']),
	lineStyle: z.enum(['strand', 'solid', 'none']),
	nodeStyle: z.enum(['glow', 'dot', 'none']),
	order: z.enum(['alt', 'raw', 'lyric-last', 'lyric-first']),
	band: z.boolean(),
	bandOpacity: z.number().min(0).max(0.3),
	amplitude: z.number().min(0.6).max(2.2),
});
```

(The rest of the handler is unchanged — it already reads `parsed.data` and patches all sites.)

- [ ] **Step 4: Run tests + typecheck**

Run: `cd ui && npm run test -- settings/taste && npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/src/routes/api/settings/taste/+server.ts ui/src/routes/api/settings/taste/server.test.ts
git commit -m "feat(settings): validate v3 taste look knobs in POST schema"
```

---

### Task 5: CollapsiblePanel component + panelState helper

**Files:**
- Create: `ui/src/lib/components/panelState.ts`
- Create: `ui/src/lib/components/panelState.test.ts`
- Create: `ui/src/lib/components/CollapsiblePanel.svelte`

**Interfaces:**
- Produces:
  - `loadPanelOpen(id: string, defaultOpen?: boolean, storage?: StorageLike): boolean`
  - `savePanelOpen(id: string, open: boolean, storage?: StorageLike): void`
  - `<CollapsiblePanel id title {glyph?} {subtitle?} {defaultOpen?}>` with a default slot for the body.

- [ ] **Step 1: Write the failing test**

Create `ui/src/lib/components/panelState.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { loadPanelOpen, savePanelOpen } from './panelState.js';

function fakeStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => (m.has(k) ? m.get(k)! : null), setItem: (k: string, v: string) => void m.set(k, v) };
}

describe('panelState', () => {
  it('returns defaultOpen when nothing is stored', () => {
    const s = fakeStorage();
    expect(loadPanelOpen('x', false, s)).toBe(false);
    expect(loadPanelOpen('y', true, s)).toBe(true);
  });
  it('round-trips a saved value, overriding the default', () => {
    const s = fakeStorage();
    savePanelOpen('x', true, s);
    expect(loadPanelOpen('x', false, s)).toBe(true);
    savePanelOpen('x', false, s);
    expect(loadPanelOpen('x', true, s)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd ui && npm run test -- panelState`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement panelState**

Create `ui/src/lib/components/panelState.ts`:

```ts
export interface StorageLike {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

const KEY = (id: string): string => `tw-panel:${id}`;

function resolve(storage?: StorageLike): StorageLike | null {
	if (storage) return storage;
	if (typeof localStorage !== 'undefined') return localStorage;
	return null;
}

export function loadPanelOpen(id: string, defaultOpen = false, storage?: StorageLike): boolean {
	const s = resolve(storage);
	if (!s) return defaultOpen;
	const v = s.getItem(KEY(id));
	return v === null ? defaultOpen : v === '1';
}

export function savePanelOpen(id: string, open: boolean, storage?: StorageLike): void {
	const s = resolve(storage);
	if (!s) return;
	s.setItem(KEY(id), open ? '1' : '0');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ui && npm run test -- panelState`
Expected: PASS.

- [ ] **Step 5: Implement CollapsiblePanel.svelte**

Create `ui/src/lib/components/CollapsiblePanel.svelte`:

```svelte
<script lang="ts">
  import { loadPanelOpen, savePanelOpen } from './panelState.js';

  let { id, title, glyph = '', subtitle = '', defaultOpen = false, children } = $props<{
    id: string; title: string; glyph?: string; subtitle?: string; defaultOpen?: boolean;
    children?: import('svelte').Snippet;
  }>();

  let open = $state(defaultOpen);

  $effect(() => { open = loadPanelOpen(id, defaultOpen); });

  function toggle() { open = !open; savePanelOpen(id, open); }
</script>

<section class="bg-surface border border-border-muted rounded-xl mb-6 overflow-hidden">
  <button
    type="button"
    onclick={toggle}
    class="w-full flex items-center justify-between gap-3 px-6 py-4 text-left hover:bg-white/[0.02] transition-colors"
    aria-expanded={open}
  >
    <span class="flex items-center gap-3 min-w-0">
      {#if glyph}<span class="text-fg-faint text-lg leading-none">{glyph}</span>{/if}
      <span class="min-w-0">
        <span class="block text-lg font-bold text-fg truncate">{title}</span>
        {#if subtitle}<span class="block text-xs text-fg-faint truncate">{subtitle}</span>{/if}
      </span>
    </span>
    <span class="font-mono text-fg-faint text-lg leading-none flex-none">{open ? '−' : '+'}</span>
  </button>
  {#if open}
    <div class="px-6 pb-6 pt-1">
      {@render children?.()}
    </div>
  {/if}
</section>
```

- [ ] **Step 6: Typecheck**

Run: `cd ui && npm run check`
Expected: PASS (no svelte-check errors for the new component).

- [ ] **Step 7: Commit**

```bash
git add ui/src/lib/components/panelState.ts ui/src/lib/components/panelState.test.ts ui/src/lib/components/CollapsiblePanel.svelte
git commit -m "feat(settings): CollapsiblePanel + persisted collapse state helper"
```

---

### Task 6: Wrap App Settings (`/settings`) panels in CollapsiblePanel

**Files:**
- Modify: `ui/src/routes/settings/+page.svelte` (each `<section>` panel: Email ingestion ~L546, Song metadata queue ~L550, Rating weights ~L809, Rating weights legacy ~L900, ZIP import ~L936, Debug mode ~L1064)

**Interfaces:**
- Consumes: `<CollapsiblePanel>` (Task 5).

- [ ] **Step 1: Import the component**

In the `<script>` block of `ui/src/routes/settings/+page.svelte`, add:

```ts
  import CollapsiblePanel from '$lib/components/CollapsiblePanel.svelte';
```

- [ ] **Step 2: Convert each panel**

For every top-level settings `<section>...</section>` panel, replace the outer `<section class="...">` wrapper and its internal header `<h2>` with a `CollapsiblePanel`, moving the title into the `title` prop and keeping the panel body as the slot. Pattern (apply per panel, using a stable `id` and the existing heading text):

```svelte
<CollapsiblePanel id="app-email-ingestion" title="Email ingestion status">
  <!-- existing panel body (everything that was inside the section, minus the old header row) -->
</CollapsiblePanel>
```

Use these ids/titles (one per existing panel):
- `app-email-ingestion` — "Email ingestion status"
- `app-metadata-queue` — "Song metadata queue"
- `app-rating-weights` — "Rating weights"
- `app-rating-weights-legacy` — "Rating weights (legacy)"
- `app-zip-import` — "ZIP import & rescan"
- `app-debug-mode` — "Debug mode"

Leave the page `<h1>` and `<SettingsTabs />` outside/above the panels. `defaultOpen` is omitted everywhere (defaults to collapsed).

- [ ] **Step 3: Typecheck**

Run: `cd ui && npm run check`
Expected: PASS.

- [ ] **Step 4: Visual smoke** (dev server, unique port)

Run: `cd ui && npm run dev -- --host --port 5180`
Open `http://192.168.4.217:5180/settings`. Confirm: every panel renders collapsed; clicking a header expands it and the `+` flips to `−`; the panel body works as before; reloading preserves each panel's open/closed state. Stop the dev server (kill the npm parent) when done.

- [ ] **Step 5: Commit**

```bash
git add ui/src/routes/settings/+page.svelte
git commit -m "feat(settings): collapsible App Settings panels, collapsed by default"
```

---

### Task 7: Wrap Music League Setup (`/settings/setup`) panels in CollapsiblePanel

**Files:**
- Modify: `ui/src/routes/settings/setup/+page.svelte` (sections: Leagues & Seasons ~L646, Round management ~L740, ML competitor roster ~L1014, Player roster ~L1144, Bulk-set deadlines ~L1579, Sonic Signature settings ~L1749)

**Interfaces:**
- Consumes: `<CollapsiblePanel>` (Task 5).

- [ ] **Step 1: Import the component**

In the `<script>` of `ui/src/routes/settings/setup/+page.svelte`, add:

```ts
  import CollapsiblePanel from '$lib/components/CollapsiblePanel.svelte';
```

- [ ] **Step 2: Convert each panel**

Same pattern as Task 6. ids/titles:
- `mls-leagues-seasons` — "Leagues & Seasons"
- `mls-round-management` — "Round management"
- `mls-competitor-roster` — "ML competitor roster"
- `mls-player-roster` — "Player roster"
- `mls-bulk-deadlines` — "Bulk-set deadlines for a season"
- `mls-sonic-signature` — "Sonic Signature settings"

Keep the page `<h1>` and `<SettingsTabs />` above the panels. All default collapsed. The Sonic Signature panel's internal content (data controls + live preview) stays intact inside its `CollapsiblePanel` slot — Tasks 8–10 edit that content, not the wrapper.

- [ ] **Step 3: Typecheck**

Run: `cd ui && npm run check`
Expected: PASS.

- [ ] **Step 4: Visual smoke**

Run: `cd ui && npm run dev -- --host --port 5180`
Open `http://192.168.4.217:5180/settings/setup`. Confirm all six panels collapse/expand and persist. Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add ui/src/routes/settings/setup/+page.svelte
git commit -m "feat(settings): collapsible Music League Setup panels, collapsed by default"
```

---

### Task 8: "Configure the look" controls in the Sonic Signature panel

**Files:**
- Modify: `ui/src/routes/settings/setup/+page.svelte` (Sonic Signature panel body + script `tasteSettings` state ~L518–531)

**Interfaces:**
- Consumes: extended `TasteSettings` (Task 1); existing `tasteSettings` `$state`, `sampleEng` `$derived`, and `saveTasteSettings()`.
- Produces: bound look controls that mutate `tasteSettings` (saved via the existing Save/apply-to-live button).

- [ ] **Step 1: Confirm the binding target**

The panel already holds `let tasteSettings = $state<TasteSettings>(...)` seeded from `DEFAULT_TASTE_SETTINGS` and merged with the loaded settings; the live preview `sampleEng` is `$derived` from it. The new fields already exist on the object (Task 1 default), so no new state is needed — only controls.

- [ ] **Step 2: Add the controls markup**

Inside the Sonic Signature panel, add a "Configure the look" subsection alongside the existing data controls (place it after the existing look toggles for `showLabels`/`showKey`/etc., before the live-preview column). Bind each control to `tasteSettings`:

```svelte
<div class="mt-6">
  <div class="font-mono text-[10px] tracking-widest uppercase text-fg-faint mb-3">Configure the look</div>

  <!-- Palette -->
  <div class="mb-4">
    <div class="text-sm text-fg-muted mb-1.5">Palette</div>
    <div class="flex gap-1.5">
      {#each ['neon', 'cool', 'spectrum'] as p}
        <button type="button" class="flex-1 px-2 py-1.5 rounded-md text-xs font-mono border"
          class:border-accent={tasteSettings.palette === p}
          class:text-accent={tasteSettings.palette === p}
          class:border-border-muted={tasteSettings.palette !== p}
          onclick={() => (tasteSettings.palette = p as typeof tasteSettings.palette)}>{p}</button>
      {/each}
    </div>
  </div>

  <!-- Line style -->
  <div class="mb-4">
    <div class="text-sm text-fg-muted mb-1.5">Line style</div>
    <div class="flex gap-1.5">
      {#each ['strand', 'solid', 'none'] as ls}
        <button type="button" class="flex-1 px-2 py-1.5 rounded-md text-xs font-mono border"
          class:border-accent={tasteSettings.lineStyle === ls}
          class:text-accent={tasteSettings.lineStyle === ls}
          class:border-border-muted={tasteSettings.lineStyle !== ls}
          onclick={() => (tasteSettings.lineStyle = ls as typeof tasteSettings.lineStyle)}>{ls}</button>
      {/each}
    </div>
  </div>

  <!-- Nodes -->
  <div class="mb-4">
    <div class="text-sm text-fg-muted mb-1.5">Nodes</div>
    <div class="flex gap-1.5">
      {#each ['glow', 'dot', 'none'] as ns}
        <button type="button" class="flex-1 px-2 py-1.5 rounded-md text-xs font-mono border"
          class:border-accent={tasteSettings.nodeStyle === ns}
          class:text-accent={tasteSettings.nodeStyle === ns}
          class:border-border-muted={tasteSettings.nodeStyle !== ns}
          onclick={() => (tasteSettings.nodeStyle = ns as typeof tasteSettings.nodeStyle)}>{ns}</button>
      {/each}
    </div>
  </div>

  <!-- Axis order -->
  <div class="mb-4">
    <div class="text-sm text-fg-muted mb-1.5">Axis order</div>
    <select class="w-full bg-surface border border-border-muted rounded-md px-2 py-1.5 text-sm"
      bind:value={tasteSettings.order}>
      <option value="alt">alt</option>
      <option value="raw">raw</option>
      <option value="lyric-last">lyric-last</option>
      <option value="lyric-first">lyric-first</option>
    </select>
  </div>

  <!-- Band + opacity -->
  <div class="mb-4">
    <label class="flex items-center gap-2 text-sm text-fg-muted">
      <input type="checkbox" bind:checked={tasteSettings.band} /> Band
    </label>
    {#if tasteSettings.band}
      <div class="mt-2">
        <div class="flex justify-between text-xs text-fg-faint mb-1"><span>Band opacity</span><span>{tasteSettings.bandOpacity.toFixed(2)}</span></div>
        <input type="range" min="0" max="0.3" step="0.01" class="w-full" bind:value={tasteSettings.bandOpacity} />
      </div>
    {/if}
  </div>

  <!-- Amplitude -->
  <div class="mb-4">
    <div class="flex justify-between text-xs text-fg-faint mb-1"><span>Amplitude</span><span>{tasteSettings.amplitude.toFixed(2)}×</span></div>
    <input type="range" min="0.6" max="2.2" step="0.05" class="w-full" bind:value={tasteSettings.amplitude} />
  </div>
</div>
```

> `bind:value` on the range inputs yields numbers in Svelte 5; `bindOpacity`/`amplitude` stay numeric. `border-accent`/`text-accent` follow the existing Tailwind token classes used elsewhere in this file — if those exact utility names differ, match the active-state classes already used by the existing data-control buttons in this panel.

- [ ] **Step 3: Typecheck**

Run: `cd ui && npm run check`
Expected: PASS.

- [ ] **Step 4: Visual smoke**

Run: `cd ui && npm run dev -- --host --port 5180`
Open `/settings/setup` → Sonic Signature panel. Confirm each look control visibly changes the live preview: palette recolors; line style switches strand/solid/hides the thick line; nodes glow/dot/hide; axis order reorders columns; band shows a soft fill; amplitude scales height. Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add ui/src/routes/settings/setup/+page.svelte
git commit -m "feat(settings): Configure-the-look controls (palette/line/nodes/order/band/amplitude)"
```

---

### Task 9: League → Player pickers + full-profile preview

**Files:**
- Modify: `ui/src/routes/settings/setup/+page.svelte` (script ~L518–548 for state + derivations; Sonic Signature preview column ~L1894–1908)

**Interfaces:**
- Consumes: `sampleBlock: TasteBlock` (already fetched from `/api/history/taste`), `scopedLeague(block, settings, leagueId)`, `tasteEngine`, and the page's already-loaded `leagues` list (used by the Leagues & Seasons panel); `TasteWaveform` component (already imported).
- Produces: `selectedLeagueId`, `selectedPlayerIdx` state driving a scoped engine + hero-variant preview.

- [ ] **Step 1: Add picker state + derivations**

In the `<script>`, near the existing taste-preview state (`sampleBlock`, `sampleEng`), add:

```ts
  let selectedLeagueId = $state<number | null>(null);
  let selectedPlayerIdx = $state(0);

  // Players present in the selected league (rows carry leagueId at index 5).
  const leaguePlayers = $derived(
    sampleBlock && selectedLeagueId != null
      ? sampleBlock.players
          .map((p, i) => ({ p, i }))
          .filter(({ p }) => p.rows.some((r) => r[5] === selectedLeagueId))
      : (sampleBlock ? sampleBlock.players.map((p, i) => ({ p, i })) : []),
  );

  // Engine scoped to the chosen league (or all leagues when none chosen).
  const previewEng = $derived(
    sampleBlock
      ? tasteEngine(scopedLeague(sampleBlock, { ...tasteSettings, scopeAll: selectedLeagueId == null }, selectedLeagueId ?? undefined), tasteSettings)
      : null,
  );

  // Index of the selected player within the scoped engine's player list.
  const previewPlayerIdx = $derived.by(() => {
    if (!sampleBlock || !previewEng) return 0;
    const targetName = sampleBlock.players[selectedPlayerIdx]?.name;
    for (let i = 0; i < previewEng.nP; i++) if (previewEng.name(i) === targetName) return i;
    return 0;
  });
```

Set a sensible default once leagues load — after `leagues` is available, initialize `selectedLeagueId` to the first league's id and `selectedPlayerIdx` to the first eligible player. Add to the end of `loadTasteSettings()` (or an `$effect`):

```ts
  $effect(() => {
    if (selectedLeagueId == null && leagues.length > 0) selectedLeagueId = leagues[0].id;
  });
```

> If the page's `leagues` objects use a field other than `id`/`name`, use the actual field names (check the Leagues & Seasons panel markup, ~L657).

- [ ] **Step 2: Add the picker markup + swap the preview**

In the preview column (currently renders `sampleEng`/`sampleBlock.players[0]`), add pickers above and render the hero profile for the selected player:

```svelte
<div class="mb-3 flex gap-2">
  <select class="flex-1 bg-surface border border-border-muted rounded-md px-2 py-1.5 text-sm"
    bind:value={selectedLeagueId}>
    {#each leagues as lg}<option value={lg.id}>{lg.name}</option>{/each}
  </select>
  <select class="flex-1 bg-surface border border-border-muted rounded-md px-2 py-1.5 text-sm"
    bind:value={selectedPlayerIdx}>
    {#each leaguePlayers as lp}<option value={lp.i}>{lp.p.name}</option>{/each}
  </select>
</div>

{#if previewEng && previewEng.nP > 0}
  <TasteWaveform
    variant="hero"
    engine={previewEng}
    playerIdx={previewPlayerIdx}
    settings={tasteSettings}
    name={previewEng.name(previewPlayerIdx)}
  />
{:else}
  <span class="font-mono text-[10px] text-fg-faint">no players in this league yet</span>
{/if}
```

> Match `TasteWaveform`'s actual prop names by checking its existing usage in this file (~L1899–1906) and its `$props` in `ui/src/lib/taste-waveform/TasteWaveform.svelte` — use `variant="hero"` so the archetype + read + chips render. Keep whatever prop the component uses for the player index and settings.

- [ ] **Step 3: Typecheck**

Run: `cd ui && npm run check`
Expected: PASS.

- [ ] **Step 4: Visual smoke**

Run: `cd ui && npm run dev -- --host --port 5180`
Open `/settings/setup` → Sonic Signature. Confirm: league dropdown lists the 3 leagues; player dropdown updates to that league's players; selecting a player renders the full hero profile (waveform + archetype name + read + chips); switching leagues re-scopes and the archetype text can change. Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add ui/src/routes/settings/setup/+page.svelte
git commit -m "feat(settings): league→player picker with full-profile preview"
```

---

### Task 10: Separation score readout

**Files:**
- Modify: `ui/src/routes/settings/setup/+page.svelte` (script: separation derivation; preview column: readout markup)

**Interfaces:**
- Consumes: `previewEng` (Task 9), `tasteEngine`, `scopedLeague`, `TasteEngine.separation()` (Task 3).

- [ ] **Step 1: Add the separation derivation**

In the `<script>`, add a derivation that also computes the `signal:'all'` baseline for the current league:

```ts
  const separation = $derived.by(() => {
    if (!sampleBlock || !previewEng || previewEng.nP < 2) return null;
    const scope = { ...tasteSettings, scopeAll: selectedLeagueId == null };
    const lg = scopedLeague(sampleBlock, scope, selectedLeagueId ?? undefined);
    const score = tasteEngine(lg, tasteSettings).separation();
    const baseline = tasteEngine(lg, { ...tasteSettings, signal: 'all' }).separation();
    const mult = baseline > 0 ? score / baseline : 1;
    return { score, mult };
  });
```

- [ ] **Step 2: Add the readout markup**

Above (or below) the preview, add:

```svelte
{#if separation}
  <div class="mt-4 flex items-start justify-between gap-4 border-t border-border-muted pt-3">
    <div>
      <div class="font-mono text-[9.5px] tracking-widest uppercase text-fg-faint">Separation score</div>
      <div class="flex items-baseline gap-2 mt-0.5">
        <span class="text-3xl font-extrabold text-fg leading-none">{separation.score.toFixed(1)}</span>
        <span class="font-mono text-xs text-fg-muted">{separation.mult.toFixed(2)}× vs all-votes</span>
      </div>
    </div>
    <div class="text-[11px] text-fg-faint max-w-[240px] leading-snug text-right">
      Mean distance between every pair of fingerprints. Higher = more distinct people.
    </div>
  </div>
{/if}
```

- [ ] **Step 3: Typecheck**

Run: `cd ui && npm run check`
Expected: PASS.

- [ ] **Step 4: Visual smoke**

Run: `cd ui && npm run dev -- --host --port 5180`
Open `/settings/setup` → Sonic Signature. Confirm: the separation number renders for the selected league; changing **Signal source** (all → subs → frac) visibly moves the number and the `×N vs all-votes` multiplier (subs should be higher than all). Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add ui/src/routes/settings/setup/+page.svelte
git commit -m "feat(settings): league separation score readout in Sonic Signature panel"
```

---

### Task 11: Verify bside gear removal, deploy, and assert live

**Files:**
- Verify only: `bside/src/routes/ProfileScreen.svelte`, `bside/src/lib/atoms/ShareOverlay.svelte`
- Deploy: repo root (main checkout, `master`)

**Interfaces:** none (integration/deploy).

- [ ] **Step 1: Confirm no settings affordance in bside**

Run: `grep -rniE 'cog|gear|⚙|settings|localStorage|sigPrefs' bside/src | grep -viE 'read_model|import|type|comment'`
Expected: no interactive settings control on the waveform (v2 Task 4 removed the per-profile cog). If any stray affordance remains, remove it and commit before deploying.

- [ ] **Step 2: Full test + typecheck gate**

Run: `cd ui && npm run test && npm run check`
Expected: all Vitest suites PASS; svelte-check clean.

- [ ] **Step 3: Build bside + copy assets (per deploy playbook)**

```bash
cd bside && npm run build
cd /home/loydmilligan/Projects/music-league-bot
TS=$(git log -1 --format=%cd --date=format:%Y%m%d-%H%M)
cp digests/_bside/bside.js "digests/_bside/bside.js.bak-$TS-v3" && cp digests/_bside/bside.css "digests/_bside/bside.css.bak-$TS-v3"
cp bside/dist/bside.js digests/_bside/bside.js && cp bside/dist/bside.css digests/_bside/bside.css
```

- [ ] **Step 4: Merge to master (if on a branch) + prod build/swap from main checkout**

```bash
docker compose build bot-ui && docker compose up -d --force-recreate bot-ui
```

- [ ] **Step 5: Apply settings to live read_models**

```bash
curl -sf http://192.168.4.217:3002/api/settings/taste | \
  curl -sf -X POST http://192.168.4.217:3002/api/settings/taste -H 'Content-Type: application/json' -d @-
```
Expected: `{"ok":true,"patched":3}`.

- [ ] **Step 6: Assert the client bundle actually rebuilt (mandatory)**

```bash
curl -sf http://192.168.4.217:3002/settings/setup | grep -o 'Configure the look' | head -1
docker compose exec -T bot-ui sh -c "grep -rl 'Configure the look' /app/ui/build/client/_app/immutable | head -1"
docker compose exec -T bot-ui sh -c "grep -o 'separation\|Amplitude' /app/digests/_bside/bside.js | sort -u | head"
```
Expected: the new UI string is present in a served/in-container bundle chunk (a 200 on the route is NOT sufficient — grep the bundle content).

- [ ] **Step 7: Visual confirm**

Open `mlb37.mattmariani.com` → Settings → Music League Setup. Confirm panels collapse, look controls work, player picker + separation score render; open a live bside profile and confirm no settings gear.

- [ ] **Step 8: Report status** (do not push per policy; surface the ahead-of-origin count).

---

## Self-Review

**Spec coverage:**
- Spec §1 in-panel player select → Task 9. §2 remove bside gear → Task 11 Step 1 (verify). §3 look knobs (palette/line/nodes/order/band/amplitude) → Tasks 1–2 (engine) + Task 8 (controls). §4 collapsible panels both tabs → Tasks 5–7. §5 separation score → Task 3 (engine) + Task 10 (readout). API/persistence §B → Task 4. bside mirroring → Global Constraints + every engine task's mirror step. Testing §Testing → per-task Vitest + check + smoke, plus Task 11 gate. All covered.

**Placeholder scan:** No TBD/TODO. Every code step shows full code. The two "match the actual prop/field names" notes (Tasks 8/9) point at concrete existing usages to copy, not vague instructions.

**Type consistency:** `TasteSettings` fields (Task 1) match the Zod enums (Task 4) and the control bindings (Task 8). `separation(): number` (Task 3) matches its use in Tasks 9/10. `THEMES`/`ORDERS`/`DEFAULT_TASTE_SETTINGS` names consistent across engine, db, and tests. `loadPanelOpen`/`savePanelOpen`/`StorageLike` consistent between helper, test, and component.

**Scope:** Single cohesive feature, one implementation plan.
