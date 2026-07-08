// Pure presentation logic for the League Research tab (sprint-26). Kept DOM-free
// so the heatmap intensity ramp, auto-callouts, drift SVG geometry, and genre
// normalization/tornado math are all unit-testable. Ported from the design
// handoff's renderVals()/buildCallouts() with the documented tweaks:
//   - D2: base Points matrix + auto callouts, NO lens toggle (per README/DECISION_LOG,
//     which override the .dc.html Final markup's leftover lens buttons).
//   - D4: winner dots support genuine ties (winners is an array per round).

// ─────────────────────────── Heatmap ───────────────────────────

export interface MatrixCell {
  points: number | null; // SUM of points voter→submitter; null = never voted
  count: number; // number of vote rows
  obscurity: number | null; // avg obscurity of the songs voter rewarded submitter
  energy: number | null;
}
/** matrix[voterIdx][submitterIdx]; null = diagonal (self). */
export type Matrix = (MatrixCell | null)[][];

/** Intensity bucket 1..5 for a positive point total (data-p on .dgA-mx-cell). 0 for zero. */
export function pointIntensity(points: number, maxPoints: number): number {
  if (points <= 0) return 0;
  const m = maxPoints > 0 ? maxPoints : 1;
  return Math.min(5, Math.max(1, Math.ceil((points / m) * 5)));
}

export interface Callout {
  tag: string;
  text: string;
}

/** 1–2 auto-surfaced sentences: strongest one-way bond + strongest deep-cuts pair. */
export function buildCallouts(matrix: Matrix, roster: string[]): Callout[] {
  const edges: Array<{ v: string; s: string } & MatrixCell> = [];
  for (let r = 0; r < roster.length; r++) {
    for (let c = 0; c < roster.length; c++) {
      if (r === c) continue;
      const cell = matrix[r]?.[c];
      if (cell && cell.points != null) edges.push({ v: roster[r], s: roster[c], ...cell });
    }
  }
  if (!edges.length) return [];
  edges.sort((a, b) => b.points! - a.points!);
  const top = edges[0];
  const obscureFan = edges
    .filter((e) => e.obscurity != null && e.obscurity >= 60)
    .sort((a, b) => b.points! - a.points!)[0];
  const out: Callout[] = [
    {
      tag: 'strongest bond',
      text: `${top.v} → ${top.s}: ${top.points} pts across ${top.count} votes — the single strongest one-way relationship in the league.`,
    },
  ];
  out.push({
    tag: 'rewards obscure',
    text: obscureFan
      ? `${obscureFan.v} → ${obscureFan.s}: ${obscureFan.points} pts at avg obscurity ${obscureFan.obscurity} — consistently rewards this player's deep cuts.`
      : 'no strong obscure-leaning pair found this scope.',
  });
  return out;
}

// ─────────────────────────── Drift (D4) ───────────────────────────

export interface DriftRound {
  season: number;
  medianObsc: number; // 0..100
  winners: number[]; // obscurity of the round's winning song(s); >1 = tie
  seasonStart: boolean;
}
export interface DriftGeometry {
  width: number;
  height: number;
  medianAreaPolygon: string;
  winnerDots: Array<{ x: number; y: number }>;
  seasonBoundaries: Array<{ x: number; labelX: number; label: string }>;
}

// viewBox + plot padding, verbatim from the handoff's renderVals().
export const DRIFT_W = 600;
export const DRIFT_H = 200;
const PAD_L = 10,
  PAD_R = 10,
  PAD_T = 15,
  PAD_B = 30;

export function driftGeometry(rounds: DriftRound[]): DriftGeometry {
  const plotW = DRIFT_W - PAD_L - PAD_R;
  const plotH = DRIFT_H - PAD_T - PAD_B;
  const n = rounds.length;
  const xAt = (i: number) => (n <= 1 ? PAD_L + plotW / 2 : PAD_L + (i / (n - 1)) * plotW);
  const yAt = (obsc: number) => PAD_T + (1 - obsc / 100) * plotH;

  const medianPts = rounds.map((d, i) => `${xAt(i)},${yAt(d.medianObsc)}`).join(' ');
  const medianAreaPolygon = n
    ? `${xAt(0)},${yAt(0)} ${medianPts} ${xAt(n - 1)},${yAt(0)}`
    : '';
  const winnerDots = rounds.flatMap((d, i) => d.winners.map((w) => ({ x: xAt(i), y: yAt(w) })));
  const seasonBoundaries = rounds
    .map((d, i) => ({ d, i }))
    .filter(({ d }) => d.seasonStart)
    .map(({ d, i }) => ({ x: xAt(i), labelX: xAt(i) + 4, label: `S${d.season}` }));

  return { width: DRIFT_W, height: DRIFT_H, medianAreaPolygon, winnerDots, seasonBoundaries };
}

// ─────────────────────────── Genre (D3) ───────────────────────────

// Aggressive normalization: raw Last.fm tag → curated canonical genre, or null
// (dropped). Era/mood/demographic/artist tags are intentionally absent from the
// map, so they normalize to null and never compete for a top-8 slot. Extend the
// map as new leagues surface real tags. Rules per the DECISION_LOG.
const GENRE_SYNONYMS: Record<string, string> = {};
const register = (canon: string, raws: string[]) => {
  GENRE_SYNONYMS[canon] = canon;
  for (const r of raws) GENRE_SYNONYMS[r] = canon;
};
register('rock', ['classic rock', 'hard rock', 'pop rock', 'soft rock', 'rock n roll', 'rock and roll', "rock 'n' roll", 'garage rock', 'blues rock', 'psychedelic rock', 'arena rock', 'southern rock']);
register('alt rock', ['alternative', 'alternative rock', 'indie', 'indie rock', 'indie pop', 'grunge', 'shoegaze', 'britpop', 'post-rock', 'post rock', 'lo-fi', 'lo fi']);
register('pop', ['dance pop', 'dance-pop', 'power pop', 'art pop', 'electropop', 'k-pop', 'j-pop']);
register('hip-hop', ['hip hop', 'hiphop', 'rap', 'trap', 'gangsta rap', 'conscious hip hop', 'boom bap']);
register('electronic', ['edm', 'house', 'techno', 'trance', 'dance', 'trip-hop', 'trip hop', 'downtempo', 'ambient', 'idm', 'drum and bass', 'dubstep', 'electronica']);
register('punk', ['punk rock', 'pop punk', 'hardcore', 'hardcore punk', 'ska punk', 'emo', 'post-hardcore', 'skate punk']);
register('metal', ['heavy metal', 'metalcore', 'deathcore', 'industrial', 'death metal', 'black metal', 'thrash metal', 'nu metal', 'doom metal', 'progressive metal']);
register('new wave', ['post-punk', 'post punk', 'synthpop', 'synth-pop', 'synth pop', 'synthwave', 'darkwave']);
register('soul', ['r&b', 'rnb', 'r and b', 'funk', 'motown', 'neo-soul', 'neo soul', 'disco']);
register('country', ['folk', 'americana', 'alt-country', 'alt country', 'bluegrass', 'folk rock']);
register('jazz', ['blues', 'swing', 'bossa nova', 'jazz fusion']);

/** Normalize a raw tag to a canonical genre, or null if it's not a curated genre. */
export function normalizeGenre(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const key = raw.toLowerCase().trim().replace(/\s+/g, ' ');
  return GENRE_SYNONYMS[key] ?? null;
}

/** Top-N canonical genres by combined submit+vote frequency (stable tie-break by name). */
export function topGenres(
  submitCounts: Record<string, number>,
  voteCounts: Record<string, number>,
  n = 8,
): string[] {
  const all = new Set([...Object.keys(submitCounts), ...Object.keys(voteCounts)]);
  return [...all]
    .sort((a, b) => {
      const fb = (submitCounts[b] ?? 0) + (voteCounts[b] ?? 0);
      const fa = (submitCounts[a] ?? 0) + (voteCounts[a] ?? 0);
      return fb - fa || a.localeCompare(b);
    })
    .slice(0, n);
}

export interface GenreTally {
  submitCounts: Record<string, number>;
  submitTotal: number;
  voteCounts: Record<string, number>;
  voteTotal: number;
}

/** Sum every player's genre tallies into one league-wide "All players" tally. */
export function aggregateGenre(byPlayer: Record<string, GenreTally>): GenreTally {
  const out: GenreTally = { submitCounts: {}, submitTotal: 0, voteCounts: {}, voteTotal: 0 };
  for (const g of Object.values(byPlayer)) {
    out.submitTotal += g.submitTotal;
    out.voteTotal += g.voteTotal;
    for (const [k, v] of Object.entries(g.submitCounts)) out.submitCounts[k] = (out.submitCounts[k] ?? 0) + v;
    for (const [k, v] of Object.entries(g.voteCounts)) out.voteCounts[k] = (out.voteCounts[k] ?? 0) + v;
  }
  return out;
}

export interface TornadoBar {
  label: string;
  submitPct: number;
  votePct: number;
}

/** Diverging bars: submit-share (of total submits) vs vote-share (of total positive votes). */
export function tornadoBars(
  topTags: string[],
  submitCounts: Record<string, number>,
  submitTotal: number,
  voteCounts: Record<string, number>,
  voteTotal: number,
): TornadoBar[] {
  const pct = (v: number, total: number) => (total > 0 ? Math.round((v / total) * 100) : 0);
  return topTags.map((t) => ({
    label: t,
    submitPct: pct(submitCounts[t] ?? 0, submitTotal),
    votePct: pct(voteCounts[t] ?? 0, voteTotal),
  }));
}
