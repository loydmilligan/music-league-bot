import type { SeasonTimeline, RoundStandingSnapshot, VotePair } from './seasonTimeline.js';

export interface MoverSignal {
  player: string; fromRank: number; toRank: number; rankDelta: number;
  roundPoints: number; total: number;
}
export interface StreakSignal {
  player: string; direction: 'surging' | 'cooling' | 'coasting'; rounds: number; detail: string;
}
export interface DiscoveryShiftSignal {
  player: string; direction: 'went-safe' | 'went-obscure'; detail: string;
}
export interface RivalrySignal {
  kind: 'reciprocal-downvote' | 'spot-trading'; players: [string, string];
  rounds: number[]; detail: string;
}
export interface UpcomingTension {
  contenders: { player: string; total: number; gapToLeader: number }[];
  nextRound: { roundNumber: number; name: string } | null;
}
export interface SeasonSignals {
  asOfRound: { roundNumber: number; name: string } | null;
  bigMover: MoverSignal | null;
  faller: MoverSignal | null;
  streaks: StreakSignal[];
  discoveryShifts: DiscoveryShiftSignal[];
  rivalries: RivalrySignal[];
  upcomingTension: UpcomingTension | null;
  /** Players negatively spotlit this update (faller + rivalry participants). Used to suppress repeat pile-on in narration. */
  punchingBagGuard: string[];
}

export interface SeasonSignalsOpts {
  nextRound?: { roundNumber: number; name: string } | null;
}

function computeMovers(t: SeasonTimeline): { bigMover: MoverSignal | null; faller: MoverSignal | null } {
  const latest = t.standingsByRound[t.standingsByRound.length - 1];
  if (!latest) return { bigMover: null, faller: null };
  const moved = latest.standings
    .filter(s => s.prevRank != null)
    .map(s => ({ s, delta: (s.prevRank as number) - s.rank }));
  if (moved.length === 0) return { bigMover: null, faller: null };

  const up = [...moved].filter(m => m.delta > 0).sort((a, b) => b.delta - a.delta || a.s.rank - b.s.rank)[0];
  const down = [...moved].filter(m => m.delta < 0).sort((a, b) => a.delta - b.delta || b.s.rank - a.s.rank)[0];

  const toSig = (m: { s: RoundStandingSnapshot['standings'][0]; delta: number }): MoverSignal => ({
    player: m.s.name, fromRank: m.s.prevRank as number, toRank: m.s.rank, rankDelta: m.delta,
    roundPoints: m.s.roundPoints, total: m.s.currentTotal,
  });

  return { bigMover: up ? toSig(up) : null, faller: down ? toSig(down) : null };
}

function computeStreaks(t: SeasonTimeline): StreakSignal[] {
  const byPlayer = new Map<string, number[]>();
  for (const snap of t.standingsByRound) {
    for (const s of snap.standings) {
      if (!byPlayer.has(s.name)) byPlayer.set(s.name, []);
      byPlayer.get(s.name)!.push(s.rank);
    }
  }
  const out: StreakSignal[] = [];
  for (const [player, ranks] of byPlayer) {
    if (ranks.length < 3) continue;
    let run = 0, dir = 0;
    for (let i = ranks.length - 1; i > 0; i--) {
      const step = ranks[i - 1] - ranks[i];
      const d = Math.sign(step);
      if (d === 0) break;
      if (dir === 0) { dir = d; run = 1; }
      else if (d === dir) run++;
      else break;
    }
    if (run >= 2) {
      out.push({
        player, direction: dir > 0 ? 'surging' : 'cooling', rounds: run,
        detail: `${run} straight rounds ${dir > 0 ? 'climbing' : 'sliding'}`,
      });
    }
  }
  return out.sort((a, b) => b.rounds - a.rounds);
}

const SHIFT_THRESHOLD = 20;

function computeDiscoveryShifts(t: SeasonTimeline): DiscoveryShiftSignal[] {
  const rounds = t.rounds;
  if (rounds.length < 2) return [];
  const latestId = rounds[rounds.length - 1].roundId;
  const prevId = rounds[rounds.length - 2].roundId;
  const latest = t.tastemakerByRound.get(latestId);
  const prev = t.tastemakerByRound.get(prevId);
  if (!latest || !prev) return [];

  const prevScore = new Map(prev.players.map(p => [p.name, p.tastemakerScore]));
  const out: DiscoveryShiftSignal[] = [];
  for (const p of latest.players) {
    const before = prevScore.get(p.name);
    if (before == null) continue;
    const delta = p.tastemakerScore - before;
    if (Math.abs(delta) < SHIFT_THRESHOLD) continue;
    out.push({
      player: p.name,
      direction: delta < 0 ? 'went-safe' : 'went-obscure',
      detail: `tastemaker score ${before} -> ${p.tastemakerScore}`,
    });
  }
  return out;
}

function pairKey(a: string, b: string): string { return [a, b].sort().join(' '); }

function computeRivalries(t: SeasonTimeline): RivalrySignal[] {
  const downvotes = t.votePairs.filter(p => p.points < 0 && p.voterName !== p.targetName);
  const directed = new Map<string, Set<number>>();
  for (const d of downvotes) {
    const k = `${d.voterName} ${d.targetName}`;
    if (!directed.has(k)) directed.set(k, new Set());
    directed.get(k)!.add(d.roundNumber);
  }
  const out: RivalrySignal[] = [];
  const seen = new Set<string>();
  for (const [k, rounds] of directed) {
    const [voter, target] = k.split(' ');
    const rev = directed.get(`${target} ${voter}`);
    if (!rev) continue;
    const key = pairKey(voter, target);
    if (seen.has(key)) continue;
    seen.add(key);
    const allRounds = [...new Set([...rounds, ...rev])].sort((a, b) => a - b);
    out.push({
      kind: 'reciprocal-downvote',
      players: [voter, target].sort() as [string, string],
      rounds: allRounds,
      detail: `traded downvotes across ${allRounds.length} round(s)`,
    });
  }

  // Spot-trading: pairs who flip rank order (A above B → B above A) across ≥2 round boundaries.
  const ranksByPlayer = new Map<string, Map<number, number>>(); // player → roundNumber → rank
  for (const snap of t.standingsByRound) {
    for (const s of snap.standings) {
      if (!ranksByPlayer.has(s.name)) ranksByPlayer.set(s.name, new Map());
      ranksByPlayer.get(s.name)!.set(snap.roundNumber, s.rank);
    }
  }
  const players = [...ranksByPlayer.keys()];
  const seenST = new Set<string>();
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const a = players[i], b = players[j];
      const ranksA = ranksByPlayer.get(a)!;
      const ranksB = ranksByPlayer.get(b)!;
      const sharedRounds = t.standingsByRound
        .map(s => s.roundNumber)
        .filter(rn => ranksA.has(rn) && ranksB.has(rn))
        .sort((x, y) => x - y);
      if (sharedRounds.length < 2) continue;
      let swaps = 0;
      const swapRounds: number[] = [];
      for (let k = 1; k < sharedRounds.length; k++) {
        const rPrev = sharedRounds[k - 1];
        const rCurr = sharedRounds[k];
        const aWasBefore = ranksA.get(rPrev)! < ranksB.get(rPrev)!; // lower rank = better
        const aIsBefore  = ranksA.get(rCurr)! < ranksB.get(rCurr)!;
        if (aWasBefore !== aIsBefore) {
          swaps++;
          if (!swapRounds.includes(rPrev)) swapRounds.push(rPrev);
          swapRounds.push(rCurr);
        }
      }
      if (swaps < 2) continue;
      const key = pairKey(a, b);
      if (seenST.has(key)) continue;
      seenST.add(key);
      const uniqueSwapRounds = [...new Set(swapRounds)].sort((x, y) => x - y);
      out.push({
        kind: 'spot-trading',
        players: [a, b].sort() as [string, string],
        rounds: uniqueSwapRounds,
        detail: `swapped standings position ${swaps} time(s)`,
      });
    }
  }

  return out;
}

function computeUpcomingTension(
  t: SeasonTimeline, nextRound: SeasonSignalsOpts['nextRound'],
): UpcomingTension | null {
  const latest = t.standingsByRound[t.standingsByRound.length - 1];
  if (!latest || latest.standings.length === 0) return null;
  const leaderTotal = latest.standings[0].currentTotal;
  const contenders = latest.standings.slice(0, 3).map(s => ({
    player: s.name, total: s.currentTotal, gapToLeader: leaderTotal - s.currentTotal,
  }));
  return { contenders, nextRound: nextRound ?? null };
}

export function computeSeasonSignals(t: SeasonTimeline, opts: SeasonSignalsOpts = {}): SeasonSignals {
  const latest = t.standingsByRound[t.standingsByRound.length - 1];
  const { bigMover, faller } = computeMovers(t);
  const rivalries = computeRivalries(t);
  const rivalryPlayers = [...new Set(rivalries.flatMap(r => r.players))];
  const punchingBagGuard = [...new Set([...(faller ? [faller.player] : []), ...rivalryPlayers])];
  return {
    asOfRound: latest ? { roundNumber: latest.roundNumber, name: latest.name } : null,
    bigMover, faller,
    streaks: computeStreaks(t),
    discoveryShifts: computeDiscoveryShifts(t),
    rivalries,
    upcomingTension: computeUpcomingTension(t, opts.nextRound ?? null),
    punchingBagGuard,
  };
}

import type Database from 'better-sqlite3';
import { buildSeasonTimeline } from './seasonTimeline.js';
import { getActiveSeasonId } from '../db/activeRound.js';

/** DB entry point: assemble the timeline + resolve next round, then compute signals. */
export function computeSeasonSignalsForLeague(db: Database.Database, leagueId: number): SeasonSignals {
  const tl = buildSeasonTimeline(db, leagueId);
  let nextRound: SeasonSignalsOpts['nextRound'] = null;
  const seasonId = getActiveSeasonId(db, leagueId);
  if (seasonId != null && tl.rounds.length > 0) {
    const lastScored = tl.rounds[tl.rounds.length - 1].roundId;
    const nr = db.prepare(
      `SELECT round_number AS rn, name FROM rounds
       WHERE season_id = ? AND id > ? ORDER BY round_number IS NULL, round_number, id LIMIT 1`,
    ).get(seasonId, lastScored) as { rn: number | null; name: string } | undefined;
    if (nr) nextRound = { roundNumber: nr.rn ?? tl.rounds.length + 1, name: nr.name };
  }
  return computeSeasonSignals(tl, { nextRound });
}
