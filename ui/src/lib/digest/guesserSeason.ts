// ── The Guessers · season panel derivations ─────────────────────────────────
// Everything the four-tab season panel renders is computed HERE, from
// `GuesserData.seasonGrid` alone, so the numbers can be unit-tested away from
// the markup. The component does layout; this file does arithmetic.
//
// The grid gives us one direction only — each ROW is a guesser and its
// `guesses[]` are the guesses they made. Three of the four tabs are about the
// other direction (how often the room names YOU right), which is the same
// guesses re-grouped by `actualName`. That inversion is the whole module.
//
// Source of truth for the intended output: design/design_handoff_guesser_viz.

import type { GuesserGrid, GuesserGridRow } from '../db/guesserInsights.js';

/** Fewer than this many attempts and we never print a percentage (D2). */
export const MIN_RATE_SAMPLE = 3;
/** Fewer than this many guesses aimed at you and you get no Targets row. */
export const MIN_TARGET_SAMPLE = 3;

/** One guess, seen from the target's side. */
export interface IncomingGuess {
  roundLabel: string;
  /** Full name of the player who made the guess. */
  guesser: string;
  /** Who they named (== the target when `correct`). */
  guessedName: string;
  correct: boolean;
}

export interface PipCell {
  label: string;
  /** 0 = they made no resolvable guess that round. */
  attempts: number;
  correct: number;
  tone: 'moss' | 'amber' | 'ember' | 'out';
  /** True for a hand-authored cell override (Jensen's 1-of-infinity), which gets a halo. */
  overridden: boolean;
  title: string;
}

export interface IncomingPip {
  guesser: string;
  correct: boolean;
  title: string;
}

export interface PlayerCard {
  playerId: number;
  name: string;
  short: string;
  attempts: number;
  correct: number;
  /** `18/38 · 47%` / `1/2` (small sample, no %) / `never guessed`. */
  figure: string;
  figureTone: 'moss' | 'amber' | 'ember' | 'quiet';
  cells: PipCell[];
  incoming: IncomingPip[];
}

export interface FieldDot {
  /** 0–1 across the plot; root-scaled so one 38-guess season can't crush the rest. */
  x: number;
  /** 0–1 up the plot = hit rate. */
  y: number;
  /** Names sharing this exact spot — plotted once, labelled together. */
  names: string[];
  attempts: number;
  correct: number;
  rate: number;
  /** Small sample (< MIN_RATE_SAMPLE attempts): dimmed, no percentage. */
  thin: boolean;
  tone: 'moss' | 'amber' | 'ember' | 'quiet';
  label: string;
  title: string;
}

export interface TargetRow {
  name: string;
  short: string;
  correct: number;
  attempts: number;
  rate: number;
  tone: 'moss' | 'amber' | 'ember';
  /** Who they're most often mistaken for; null when they've never been missed. */
  mistakenFor: string | null;
}

export interface ThrowOff {
  name: string;
  short: string;
  /** Times somebody aimed a guess at them and named the wrong person. */
  misses: number;
}

export interface ConfusionPair {
  hub: string;
  spokes: { name: string; count: number }[];
}

export interface SeasonPanel {
  cards: PlayerCard[];
  field: FieldDot[];
  targets: TargetRow[];
  /** Targets held back from the list for too thin a sample, e.g. `Matt (2)`. */
  targetsHeldBack: { short: string; attempts: number }[];
  ghost: TargetRow | null;
  transparent: TargetRow | null;
  throwOffs: ThrowOff[];
  interchangeables: ConfusionPair | null;
  defaultGuess: { short: string; count: number } | null;
  /** Total wrong guesses — the denominator behind "a quarter of the misses". */
  totalMisses: number;
}

/**
 * Rooms call people by the name that is unambiguous in that room, which is
 * usually the first name — except when it isn't. Two Daves play Boarz, so both
 * become surnames; Paletz has gone by his surname since before the league.
 * Overrides are per league because a nickname is a fact about one room.
 */
const SHORT_OVERRIDES: Record<string, Record<string, string>> = {
  'boarz-ii-men': { 'Darren Paletz': 'Paletz' },
};

/**
 * Short display names for a roster, resolved against the whole roster at once:
 * a first name is only usable if nobody else in the room shares it.
 */
export function shortNames(names: string[], leagueSlug = ''): Map<string, string> {
  const overrides = SHORT_OVERRIDES[leagueSlug] ?? {};
  const firsts = new Map<string, number>();
  for (const n of names) {
    const f = n.trim().split(/\s+/)[0] ?? n;
    firsts.set(f, (firsts.get(f) ?? 0) + 1);
  }
  const out = new Map<string, string>();
  for (const n of names) {
    const parts = n.trim().split(/\s+/);
    const first = parts[0] ?? n;
    if (overrides[n]) out.set(n, overrides[n]);
    else if ((firsts.get(first) ?? 0) > 1 && parts.length > 1) out.set(n, parts[parts.length - 1]);
    else out.set(n, first);
  }
  return out;
}

function rateTone(correct: number, attempts: number): 'moss' | 'amber' | 'ember' {
  if (attempts === 0 || correct === 0) return 'ember';
  return correct / attempts >= 0.5 ? 'moss' : 'amber';
}

/** Invert the grid: every guess re-filed under the player it was aimed at. */
export function incomingByTarget(grid: GuesserGrid): Map<string, IncomingGuess[]> {
  const out = new Map<string, IncomingGuess[]>();
  for (const row of grid.rows) {
    for (const g of row.guesses) {
      const list = out.get(g.actualName) ?? [];
      list.push({
        roundLabel: g.roundLabel,
        guesser: row.name,
        guessedName: g.guessedName,
        correct: g.correct,
      });
      out.set(g.actualName, list);
    }
  }
  return out;
}

function cardFigure(row: GuesserGridRow): { figure: string; tone: PlayerCard['figureTone'] } {
  if (row.attempts === 0) return { figure: 'never guessed', tone: 'quiet' };
  const frac = `${row.correct}/${row.attempts}`;
  // Under three guesses a percentage is a coin-flip dressed as a measurement.
  if (row.attempts < MIN_RATE_SAMPLE) return { figure: frac, tone: 'quiet' };
  return {
    figure: `${frac} · ${Math.round((row.correct / row.attempts) * 100)}%`,
    tone: rateTone(row.correct, row.attempts),
  };
}

export function buildSeasonPanel(grid: GuesserGrid, leagueSlug = ''): SeasonPanel {
  const incoming = incomingByTarget(grid);
  // Everyone who has ever guessed OR been guessed at — the full roster as the
  // season knows it. A player with an empty guessing row is a finding (D3).
  const everyone = Array.from(new Set([...grid.rows.map((r) => r.name), ...incoming.keys()]));
  const shorts = shortNames(everyone, leagueSlug);
  const short = (n: string) => shorts.get(n) ?? n;

  // ── Tab 1 · by player ────────────────────────────────────────────────────
  const cards: PlayerCard[] = grid.rows.map((row) => {
    const { figure, tone } = cardFigure(row);
    const cells: PipCell[] = grid.rounds.map((r, i) => {
      const c = row.cells[i] ?? null;
      if (!c || c.attempts === 0) {
        return {
          label: r.label,
          attempts: 0,
          correct: 0,
          tone: 'out',
          overridden: false,
          title: `R${r.label}: no guess`,
        };
      }
      return {
        label: r.label,
        attempts: c.attempts,
        correct: c.correct,
        tone: rateTone(c.correct, c.attempts),
        overridden: !!c.display,
        title: c.display
          ? `R${r.label}: ${c.display}${c.note ? ' — see note' : ''}`
          : `R${r.label}: ${c.correct}/${c.attempts} right`,
      };
    });
    const inc = (incoming.get(row.name) ?? []).map((g) => ({
      guesser: g.guesser,
      correct: g.correct,
      title:
        `R${g.roundLabel}: ${short(g.guesser)} guessed you: ` +
        (g.correct ? 'nailed you' : `thought you were ${short(g.guessedName)}`),
    }));
    return {
      playerId: row.playerId,
      name: row.name,
      short: short(row.name),
      attempts: row.attempts,
      correct: row.correct,
      figure,
      figureTone: tone,
      cells,
      incoming: inc,
    };
  });

  // ── Tab 2 · the field ────────────────────────────────────────────────────
  // Root-scaled x: the gap between 2 and 7 guesses matters more than the gap
  // between 30 and 38, and one prolific guesser must not flatten everyone else
  // into the left wall.
  const players = grid.rows.filter((r) => r.attempts > 0);
  const maxAttempts = Math.max(1, ...players.map((r) => r.attempts));
  const spots = new Map<string, FieldDot>();
  for (const r of players) {
    const rate = r.correct / r.attempts;
    const x = Math.sqrt(r.attempts) / Math.sqrt(maxAttempts);
    const key = `${x.toFixed(3)}|${rate.toFixed(3)}`;
    const thin = r.attempts < MIN_RATE_SAMPLE;
    const existing = spots.get(key);
    if (existing) {
      // Two players at the identical spot get ONE dot and a shared label —
      // overprinted names read as a single unreadable smear otherwise.
      existing.names.push(short(r.name));
      existing.label = existing.names.join(' · ');
      existing.title = `${existing.names.join(', ')} — ${r.correct}/${r.attempts}`;
      continue;
    }
    spots.set(key, {
      x,
      y: rate,
      names: [short(r.name)],
      attempts: r.attempts,
      correct: r.correct,
      rate,
      thin,
      tone: thin ? 'quiet' : rateTone(r.correct, r.attempts),
      label: short(r.name),
      title: `${short(r.name)} — ${r.correct}/${r.attempts} (${Math.round(rate * 100)}%)`,
    });
  }
  const field = Array.from(spots.values()).sort((a, b) => b.attempts - a.attempts);

  // ── Tab 4 · targets ──────────────────────────────────────────────────────
  const allTargets: TargetRow[] = Array.from(incoming.entries()).map(([name, list]) => {
    const correct = list.filter((g) => g.correct).length;
    const wrong = new Map<string, number>();
    for (const g of list) {
      if (g.correct) continue;
      wrong.set(g.guessedName, (wrong.get(g.guessedName) ?? 0) + 1);
    }
    // "Mistaken for X" is only a fact when X leads outright. A three-way tie at
    // one guess each has no answer, and picking one alphabetically would invent
    // a pattern out of noise.
    const ranked = Array.from(wrong.entries()).sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    );
    const top = ranked.length && (ranked.length === 1 || ranked[0][1] > ranked[1][1]) ? ranked[0] : null;
    const rate = correct / list.length;
    return {
      name,
      short: short(name),
      correct,
      attempts: list.length,
      rate,
      tone: rate >= 0.6 ? 'moss' : rate >= 0.34 ? 'amber' : 'ember',
      mistakenFor: top ? short(top[0]) : null,
    };
  });
  const byRate = (a: TargetRow, b: TargetRow) => a.rate - b.rate || a.name.localeCompare(b.name);
  const targets = allTargets.filter((t) => t.attempts >= MIN_TARGET_SAMPLE).sort(byRate);
  const targetsHeldBack = allTargets
    .filter((t) => t.attempts < MIN_TARGET_SAMPLE)
    .sort((a, b) => b.attempts - a.attempts)
    .map((t) => ({ short: t.short, attempts: t.attempts }));

  // ── Tab 3 · carrot box ───────────────────────────────────────────────────
  // The two poles of being guessed, both drawn from the SAME measured list the
  // Targets tab shows, so the cards can never disagree with the rows below.
  const ghost = targets.length ? targets[0] : null;
  const transparent = targets.length ? targets[targets.length - 1] : null;

  const throwOffs: ThrowOff[] = allTargets
    .map((t) => ({ name: t.name, short: t.short, misses: t.attempts - t.correct }))
    .filter((t) => t.misses > 0)
    .sort((a, b) => b.misses - a.misses || a.name.localeCompare(b.name));

  const pairCounts = new Map<string, number>();
  const blurtCounts = new Map<string, number>();
  let totalMisses = 0;
  for (const row of grid.rows) {
    for (const g of row.guesses) {
      if (g.correct) continue;
      totalMisses++;
      blurtCounts.set(g.guessedName, (blurtCounts.get(g.guessedName) ?? 0) + 1);
      const pair = [g.guessedName, g.actualName].sort().join(' ');
      pairCounts.set(pair, (pairCounts.get(pair) ?? 0) + 1);
    }
  }
  const pairs = Array.from(pairCounts.entries())
    .map(([k, count]) => ({ a: k.split(' ')[0], b: k.split(' ')[1], count }))
    .sort((x, y) => y.count - x.count || x.a.localeCompare(y.a));

  // "The interchangeables": one player the room swaps with two others. Only a
  // real hub qualifies — if the top two pairs share nobody, there is no hub and
  // we draw the single strongest pair instead of inventing a third leg.
  let interchangeables: ConfusionPair | null = null;
  if (pairs.length) {
    const [p1, p2] = pairs;
    const shared = p2 ? [p1.a, p1.b].find((n) => n === p2.a || n === p2.b) : undefined;
    if (shared && p2) {
      const spoke1 = p1.a === shared ? p1.b : p1.a;
      const spoke2 = p2.a === shared ? p2.b : p2.a;
      interchangeables = {
        hub: short(shared),
        spokes: [
          { name: short(spoke1), count: p1.count },
          { name: short(spoke2), count: p2.count },
        ],
      };
    } else {
      interchangeables = { hub: short(p1.a), spokes: [{ name: short(p1.b), count: p1.count }] };
    }
  }

  // "The default guess": the name people blurt when stumped. This counts wrong
  // guesses NAMING them — the opposite direction from the Targets tab, which is
  // how often their own songs get pegged. Both can be true of the same person.
  const blurt = Array.from(blurtCounts.entries()).sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  )[0];
  const defaultGuess = blurt ? { short: short(blurt[0]), count: blurt[1] } : null;

  return {
    cards,
    field,
    targets,
    targetsHeldBack,
    ghost,
    transparent,
    throwOffs,
    interchangeables,
    defaultGuess,
    totalMisses,
  };
}
