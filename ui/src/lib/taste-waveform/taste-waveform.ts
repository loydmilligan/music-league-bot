/**
 * taste-waveform.ts — Sonic Signature engine (framework-agnostic).
 *
 * Ported VERBATIM from the approved reference (taste-waveform-package,
 * "Sonic Signature - Final.dc.html" → data-dc-script). The math functions
 * (weightsFor, songset, statDevs, eclect, sig6, leagueSig/relDev, nameOf,
 * proseFor, chipsFor, buildChart) are the locked implementation — do not retune.
 * Only buildChart's rendering was adapted from React `el()` to an SVG string so
 * it drops into Svelte `{@html}` / innerHTML in both bside/ and ui/.
 *
 * The signature is computed client-side from raw interactions + live settings,
 * league-relative (archetypes compare each player to their league mean). See
 * IMPLEMENTATION.md in the package for the full spec.
 */

// ── input shapes ─────────────────────────────────────────────────────────────
/** per-song 5-tuple: [obscurity, energy, mood, tempo, lyrical] (0..100) */
export type SongAxes = [number, number, number, number, number];
/**
 * interaction row: [songIndex, interaction(0=sub,1=vote), points, roundId, hasComment]
 * A 6th element (leagueId) may be present for scope filtering; the engine ignores it.
 */
export type InteractionRow = number[];
export interface LeaguePlayer { name: string; rows: InteractionRow[]; }
export interface LeagueData {
	rounds?: string[];
	axes: SongAxes[];
	meta?: { title: string; artist: string }[];
	players: LeaguePlayer[];
}

/** The read_model.taste block (rows carry leagueId at [5]). */
export interface TasteBlock { axes: SongAxes[]; players: LeaguePlayer[]; }

/**
 * Apply the "use all leagues" setting. When off, keep only rows from the current
 * league and drop players with nothing left. When on (default), pass through.
 */
export function scopedLeague(taste: TasteBlock, settings: TasteSettings, currentLeagueId?: number): LeagueData {
	if (settings.scopeAll || currentLeagueId == null) return { axes: taste.axes, players: taste.players };
	const players = taste.players
		.map((p) => ({ name: p.name, rows: p.rows.filter((r) => r[5] === currentLeagueId) }))
		.filter((p) => p.rows.length > 0);
	return { axes: taste.axes, players };
}

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

export interface BuildChartOpts { chrome?: boolean; nodes?: boolean; sample?: number; leagueAvg?: number[]; }

// ── locked constants (verbatim) ──────────────────────────────────────────────
export const THEMES: Record<PaletteName, { traits: string[]; above: string }> = {
	neon:     { traits: ['#ff5bbe', '#ffd23a', '#5affd0', '#5a8cff', '#ff5b6e', '#b65bff'], above: '#5affd0' },
	cool:     { traits: ['#5aa3ff', '#3fb6c4', '#3ec27a', '#6a8cff', '#4ad0d9', '#5ad0a0'], above: '#7fd0ff' },
	spectrum: { traits: ['#ff5b2e', '#e8a83a', '#5aa3ff', '#3ec27a', '#e6566c', '#3fb6c4'], above: '#5aa3ff' },
};
export const ORDERS: Record<OrderName, number[]> = {
	alt: [0, 4, 3, 2, 1], raw: [0, 1, 2, 3, 4], 'lyric-last': [0, 2, 3, 1, 4], 'lyric-first': [4, 0, 1, 2, 3],
};
const POLES: Record<number, [string, string]> = {
	0: ['POP', 'HIPSTER'], 1: ['HYPE', 'CHILL'], 2: ['BRIGHT', 'DARK'], 3: ['FAST', 'SLOW'], 4: ['WORDY', 'INSTR'],
};
const REPEL = '#e6566c';
const aA = (idx: number, v: number): number => (idx === 0 ? 50 - v : v - 50);

const FAM: Record<string, [string, string, string, string]> = {
	'0+': ['The Tuned-In', 'The Hitseeker', 'The Chart Rider', 'The Populist'],
	'0-': ['The Digger', 'The Crate Digger', 'The Deep Diver', 'The Archivist'],
	'1+': ['The Igniter', 'The Firestarter', 'The Firebrand', 'The Wildfire'],
	'1-': ['The Mellow', 'The Slow Hand', 'The Unwinder', 'The Tranquil'],
	'2+': ['The Bright Side', 'The Sunbeam', 'The Daydreamer', 'The Radiant'],
	'2-': ['The Dusk', 'The Night Owl', 'The Shadow', 'The Abyss'],
	'3+': ['The Quickstep', 'The Sprinter', 'The Racer', 'The Redliner'],
	'3-': ['The Amble', 'The Slow Burner', 'The Drifter', 'The Glacier'],
	'4+': ['The Talker', 'The Wordsmith', 'The Storyteller', 'The Librettist'],
	'4-': ['The Hummer', 'The Instrumentalist', 'The Texturalist', 'The Wordless'],
	'5+': ['The Sampler', 'The Omnivore', 'The Wanderer', 'The Shapeshifter'],
	'5-': ['The Loyalist', 'The Purist', 'The Devotee', 'The Monk'],
};
const AXP = [
	{ aboveS: 'unafraid of a chart-topper', aboveL: 'fine with a crowd-pleaser', belowS: 'living for deep cuts nobody else found', belowL: 'leaning obscure' },
	{ aboveS: 'wanting it loud and moving', aboveL: 'skewing hyped', belowS: 'keeping it low and easy', belowL: 'skewing chilled' },
	{ aboveS: 'bright and major-key', aboveL: 'leaning bright', belowS: 'pulled toward the dark and minor', belowL: 'a touch dark' },
	{ aboveS: 'taken at a quick clip', aboveL: 'a touch up-tempo', belowS: 'taken slow', belowL: 'a touch slow' },
	{ aboveS: 'picking songs with something to say', aboveL: 'usually with words', belowS: 'letting the instruments talk', belowL: 'often instrumental' },
	{ aboveS: 'refusing one genre', aboveL: 'wandering between genres', belowS: 'locked in one lane', belowL: 'mostly one lane' },
];
const tierOf = (m: number): number => (m < 5 ? 0 : m < 11 ? 1 : m < 19 ? 2 : 3);

// ── color helpers (verbatim) ─────────────────────────────────────────────────
const hx = (c: string): number[] => { c = c.replace('#', ''); return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)]; };
const rh = (r: number[]): string => '#' + r.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const mix = (a: string, b: string, t: number): string => { const A = hx(a), B = hx(b); return rh([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]); };

// ── tiny SVG string builder (replaces React el() in buildChart) ──────────────
const ATTR_MAP: Record<string, string> = {
	stopColor: 'stop-color', strokeWidth: 'stroke-width', strokeDasharray: 'stroke-dasharray',
	strokeLinecap: 'stroke-linecap', textAnchor: 'text-anchor', letterSpacing: 'letter-spacing',
	fontFamily: 'font-family', fontSize: 'font-size',
};
const esc = (s: unknown): string => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function styleStr(o: Record<string, unknown>): string {
	return Object.entries(o).map(([k, v]) => `${k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}:${typeof v === 'number' && !/opacity|zIndex|flex/i.test(k) ? v + 'px' : v}`).join(';');
}
function svgEl(name: string, attrs: Record<string, unknown>, children: string | string[] = ''): string {
	const parts: string[] = [];
	for (const [k, v] of Object.entries(attrs)) {
		if (k === 'key' || v == null) continue;
		if (k === 'style' && typeof v === 'object') { parts.push(`style="${esc(styleStr(v as Record<string, unknown>))}"`); continue; }
		parts.push(`${ATTR_MAP[k] || k}="${esc(v)}"`);
	}
	const inner = Array.isArray(children) ? children.join('') : children;
	const a = parts.join(' ');
	return inner === '' ? `<${name} ${a}/>` : `<${name} ${a}>${inner}</${name}>`;
}

// ── the engine — bound to one league's data + settings ───────────────────────
export interface TasteEngine {
	nP: number;
	name: (pi: number) => string;
	sig6: (pi: number) => number[];
	nameOf: (pi: number) => string;
	proseFor: (pi: number) => string;
	chipsFor: (pi: number) => string[];
	leagueAvg: () => number[];
	buildChart: (pi: number, W: number, H: number, opts?: BuildChartOpts) => string;
	separation: () => number;
}

export function tasteEngine(LG: LeagueData, settings: TasteSettings): TasteEngine {
	const st = settings;
	const TH = THEMES[st.palette] ?? THEMES.neon;
	const TRAITS = TH.traits;
	const ORDER = ORDERS[st.order] ?? ORDERS.alt;
	const PLAYERS = LG.players, AXT = LG.axes, nP = PLAYERS.length;
	const short = (nm: string): string => nm.split(' ')[0];

	const weightsFor = (rows: InteractionRow[], pm: { mode: SignalMode; frac: number; neg: boolean; dn: number }): number[] => {
		const topBest: Record<number, number> = {};
		if (pm.mode === 'top') { rows.forEach(([, it, pts, rid]) => { if (it === 1 && pts > 0) topBest[rid] = Math.max(topBest[rid] == null ? -1e9 : topBest[rid], pts); }); }
		return rows.map(([, it, pts, rid]) => {
			if (it === 0) return 1;
			if (pts < 0) return pm.neg ? pm.dn * pts : 0;
			if (pts > 0) { if (pm.mode === 'subs') return 0; if (pm.mode === 'all') return 1; if (pm.mode === 'top') return pts === topBest[rid] ? 1 : 0; if (pm.mode === 'frac') return pm.frac * pts; }
			return 0;
		});
	};
	const curP = { mode: st.signal, frac: st.votePct / 100, neg: st.negatives, dn: st.dnPct / 100 };
	// weighted song: [obscurity, energy, mood, tempo, lyricalDamped, weight, isSubmission]
	const songset = (pi: number): number[][] => {
		const lw = st.lyrWeight; const rows = PLAYERS[pi].rows, W = weightsFor(rows, curP), out: number[][] = [];
		rows.forEach((row, i) => { const w = W[i]; if (w === 0) return; const a = AXT[row[0]]; out.push([a[0], a[1], a[2], a[3], 50 + (a[4] - 50) * lw, w, row[1] === 0 ? 1 : 0]); });
		return out;
	};
	const statDevs = (rows: number[][]): number[] => {
		if (!rows.length) return [0, 0, 0, 0, 0];
		return [0, 1, 2, 3, 4].map((idx) => { let ws = 0, sm = 0; rows.forEach((s) => { ws += Math.abs(s[5]); sm += aA(idx, s[idx]) * s[5]; }); return ws ? sm / ws : 0; });
	};
	const eclect = (rows: number[][]): number => {
		const inc = rows.filter((r) => r[5] > 0); if (inc.length < 2) return 50;
		const sd = (a: number[]): number => { const mu = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - mu) * (y - mu), 0) / a.length); };
		let s = 0; for (let i = 0; i < 5; i++) s += sd(inc.map((r) => r[i]));
		return Math.max(0, Math.min(100, (s / 5) * 3.4));
	};
	const ssCache: Record<number, number[][]> = {}, dCache: Record<number, number[]> = {};
	const setOf = (pi: number): number[][] => ssCache[pi] || (ssCache[pi] = songset(pi));
	const devVec = (pi: number): number[] => dCache[pi] || (dCache[pi] = statDevs(setOf(pi)));
	const sig6 = (pi: number): number[] => { const dv = devVec(pi); const V = [0, 1, 2, 3, 4].map((i) => (i === 0 ? 50 - dv[i] : 50 + dv[i])); V.push(eclect(setOf(pi))); return V; };
	const leagueSig = [0, 1, 2, 3, 4, 5].map((k) => { let s = 0; PLAYERS.forEach((_, i) => (s += sig6(i)[k])); return s / nP; });
	const relDev = (V: number[]): number[] => V.map((_, i) => aA(i, V[i]) - aA(i, leagueSig[i]));

	const nameOf = (pi: number): string => {
		const V = sig6(pi), dv = relDev(V); const rk = [0, 1, 2, 3, 4, 5].slice().sort((a, b) => Math.abs(dv[b]) - Math.abs(dv[a]));
		const i = rk[0]; const key = i + (dv[i] >= 0 ? '+' : '-'); return FAM[key][tierOf(Math.abs(dv[i]))];
	};
	const proseFor = (pi: number): string => {
		const V = sig6(pi), dv = relDev(V); const rk = [0, 1, 2, 3, 4, 5].slice().sort((a, b) => Math.abs(dv[b]) - Math.abs(dv[a]));
		const nm = nameOf(pi); const strong = rk.filter((i) => Math.abs(dv[i]) >= 6).slice(0, 3);
		const ph = (i: number): string => { const d = dv[i], m = Math.abs(d), pole = d >= 0 ? 'above' : 'below'; return (AXP[i] as Record<string, string>)[pole + (m >= 16 ? 'S' : 'L')]; };
		const cls = strong.map(ph);
		const bodyt = cls.length >= 2 ? cls.slice(0, -1).join(', ') + ', and ' + cls[cls.length - 1] : (cls[0] || "right in the league's pocket");
		return short(PLAYERS[pi].name) + ' is ' + nm + ' — ' + bodyt + '.';
	};
	const chipsFor = (pi: number): string[] => {
		const V = sig6(pi), dv = relDev(V); const rk = [0, 1, 2, 3, 4, 5].slice().sort((a, b) => Math.abs(dv[b]) - Math.abs(dv[a])).slice(0, 3);
		return rk.map((i) => { const lab = i < 5 ? (aA(i, V[i]) >= 0 ? POLES[i][0] : POLES[i][1]) : (dv[i] >= 0 ? 'OMNIVORE' : 'PURIST'); return lab + ' ' + Math.round(V[i]); });
	};

	const TX = (rawDev: number): number => { const p = 1 / st.spread, sg = rawDev < 0 ? -1 : 1; return sg * 50 * Math.pow(Math.min(Math.abs(rawDev), 50) / 50, p); };
	const applyBright = (base: string, t: number): string => { const dim = mix(base, '#0a0d13', 0.58), bri = mix(base, '#ffffff', 0.20); return mix(dim, bri, t); };

	const buildChart = (pi: number, W: number, H: number, opts: BuildChartOpts = {}): string => {
		const chrome = opts.chrome !== false;
		const rows = setOf(pi); const kids: string[] = [];
		const padX = W * 0.06, padY = H * (chrome ? 0.17 : 0.1), cy = H / 2, scale = (H / 2 - padY) / 50 * (st.amplitude ?? 1);
		const n = ORDER.length, xk = (k: number): number => padX + k * (W - 2 * padX) / (n - 1), yd = (d: number): number => cy - d * scale;
		const devAt = (k: number, s: number[]): number => TX(aA(ORDER[k], s[ORDER[k]]));
		const cm = ORDER.map((_idx, k) => { let m = 8; for (const s of rows) { const a = Math.abs(devAt(k, s)); if (a > m) m = a; } return m; });
		interface Seg { d: string; devL: number; devR: number; idxL: number; idxR: number; kL: number; kR: number; }
		interface Pt { x: number; y: number; dev: number; }
		const seg = (P: Pt[], idxs: number[]): Seg[] => {
			const out: Seg[] = [];
			for (let i = 0; i < P.length - 1; i++) {
				const p0 = P[i - 1] || P[i], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2] || P[i + 1];
				const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6, c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
				out.push({ d: 'M ' + p1.x.toFixed(1) + ' ' + p1.y.toFixed(1) + ' C ' + c1x.toFixed(1) + ' ' + c1y.toFixed(1) + ' ' + c2x.toFixed(1) + ' ' + c2y.toFixed(1) + ' ' + p2.x.toFixed(1) + ' ' + p2.y.toFixed(1), devL: p1.dev, devR: p2.dev, idxL: idxs[i], idxR: idxs[i + 1], kL: i, kR: i + 1 });
			}
			return out;
		};
		const gradDefs: string[] = [], gradMap: Record<string, string> = {}; let gradN = 0;
		const gradFor = (cA: string, cB: string): string => {
			const key = cA + cB + pi + W; if (gradMap[key]) return gradMap[key];
			const id = 'g' + pi + '_' + W + '_' + (gradN++);
			gradDefs.push(svgEl('linearGradient', { id, gradientUnits: 'objectBoundingBox', x1: 0, y1: 0, x2: 1, y2: 0 }, [
				svgEl('stop', { offset: '0%', stopColor: cA }), svgEl('stop', { offset: '20%', stopColor: cA }),
				svgEl('stop', { offset: '80%', stopColor: cB }), svgEl('stop', { offset: '100%', stopColor: cB }),
			]));
			gradMap[key] = id; return id;
		};
		const strokeOf = (s: Seg): string => { const tL = Math.round(Math.min(1, Math.abs(s.devL) / cm[s.kL]) * 14) / 14, tR = Math.round(Math.min(1, Math.abs(s.devR) / cm[s.kR]) * 14) / 14; return 'url(#' + gradFor(applyBright(TRAITS[s.idxL], tL), applyBright(TRAITS[s.idxR], tR)) + ')'; };
		if (chrome) {
			for (let k = 0; k < n; k++) {
				kids.push(svgEl('line', { x1: xk(k), y1: padY * 0.5, x2: xk(k), y2: H - padY * 0.5, stroke: mix(TRAITS[ORDER[k]], '#0d1116', 0.6), strokeWidth: 1 }));
				kids.push(svgEl('text', { x: xk(k), y: padY * 0.6, fill: TRAITS[ORDER[k]], fontFamily: 'var(--font-mono)', fontSize: Math.max(7, W * 0.018), textAnchor: 'middle', letterSpacing: '0.04em', opacity: 0.85 }, POLES[ORDER[k]][0]));
				kids.push(svgEl('text', { x: xk(k), y: H - padY * 0.28, fill: '#5a6773', fontFamily: 'var(--font-mono)', fontSize: Math.max(7, W * 0.018), textAnchor: 'middle', letterSpacing: '0.04em' }, POLES[ORDER[k]][1]));
			}
			kids.push(svgEl('line', { x1: padX * 0.5, y1: cy, x2: W - padX * 0.5, y2: cy, stroke: '#3a4451', strokeWidth: 1, strokeDasharray: '4 4', opacity: 0.7 }));
		}
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
		let sk = 0; const total = rows.length, N = Math.min(opts.sample || 90, total), step = total / Math.max(1, N), sample: number[][] = [];
		for (let i = 0; i < N; i++) sample.push(rows[Math.floor(i * step)]);
		sample.forEach((s) => {
			const neg = s[5] < 0; const pts = ORDER.map((_idx, k) => ({ x: xk(k), y: yd(devAt(k, s)), dev: devAt(k, s) }));
			const segs = seg(pts, ORDER); const mag = Math.min(1, Math.abs(s[5])); const op = (chrome ? 0.15 : 0.2) * (0.35 + 0.65 * mag) * (neg ? 1.5 : 1);
			segs.forEach((sg) => kids.push(svgEl('path', { d: sg.d, fill: 'none', stroke: neg ? REPEL : strokeOf(sg), strokeWidth: neg ? 1.1 : 0.9, opacity: op.toFixed(3), strokeLinecap: 'round', strokeDasharray: neg ? '2 2' : undefined })));
		});
		if (opts.leagueAvg) {
			const laDev = ORDER.map((idx) => TX(aA(idx, opts.leagueAvg![idx])));
			const laPts = laDev.map((d, k) => ({ x: xk(k), y: yd(d), dev: d }));
			seg(laPts, ORDER).forEach((sg) => kids.push(svgEl('path', { d: sg.d, fill: 'none', stroke: '#5a6773', strokeWidth: 1.5, opacity: 0.5, strokeLinecap: 'round', strokeDasharray: '3 4' })));
		}
		const V = sig6(pi); const avgDev = ORDER.map((idx) => TX(aA(idx, V[idx]))); const avgPts = avgDev.map((d, k) => ({ x: xk(k), y: yd(d), dev: d })); const avgSegs = seg(avgPts, ORDER);
		if (st.lineStyle === 'strand') {
			avgSegs.forEach((sg) => kids.push(svgEl('path', { d: sg.d, fill: 'none', stroke: '#07090c', strokeWidth: H < 70 ? 4 : 6.5, opacity: 0.45, strokeLinecap: 'round' })));
			avgSegs.forEach((sg) => kids.push(svgEl('path', { d: sg.d, fill: 'none', stroke: strokeOf(sg), strokeWidth: H < 70 ? 3 : 4.5, opacity: 0.92, strokeLinecap: 'round' })));
		} else if (st.lineStyle === 'solid') {
			avgSegs.forEach((sg) => kids.push(svgEl('path', { d: sg.d, fill: 'none', stroke: '#07090c', strokeWidth: H < 70 ? 3.5 : 6, opacity: 0.5, strokeLinecap: 'round' })));
			avgSegs.forEach((sg) => kids.push(svgEl('path', { d: sg.d, fill: 'none', stroke: TH.above, strokeWidth: H < 70 ? 2 : 3, opacity: 0.95, strokeLinecap: 'round' })));
		}
		// lineStyle === 'none' → draw nothing
		if (st.nodeStyle !== 'none') avgPts.forEach((p, k) => {
			const c = applyBright(TRAITS[ORDER[k]], Math.min(1, Math.abs(avgDev[k]) / cm[k]));
			if (st.nodeStyle === 'glow') {
				kids.push(svgEl('circle', { cx: p.x, cy: p.y, r: H < 70 ? 5 : 8, fill: c, opacity: 0.15 }));
				kids.push(svgEl('circle', { cx: p.x, cy: p.y, r: H < 70 ? 1.7 : 2.1, fill: mix(c, '#ffffff', 0.3), opacity: 0.95 }));
			} else {
				kids.push(svgEl('circle', { cx: p.x, cy: p.y, r: 3.4, fill: TRAITS[ORDER[k]], stroke: '#07090c', strokeWidth: 1.4 }));
			}
		});
		kids.push(svgEl('defs', {}, gradDefs));
		return svgEl('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'xMidYMid meet', style: { display: 'block', width: '100%', height: 'auto', maxWidth: W + 'px', overflow: 'visible' } }, kids);
	};

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

	return { nP, name: (pi) => PLAYERS[pi].name, sig6, nameOf, proseFor, chipsFor, leagueAvg: () => leagueSig.slice(), buildChart, separation };
}
