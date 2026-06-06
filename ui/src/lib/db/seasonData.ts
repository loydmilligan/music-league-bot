import type Database from 'better-sqlite3';
import { computeStandings } from './standings.js';

// ── Season-aggregation layer (sprint-21 season-recap) ───────────────────────
// Pure data — NO LLM. Produces compact, per-section "season slices" scoped to
// rounds ≤ a given round (cumulative, sprint-14 model). Recap mode
// (recap-generate-wiring) swaps round data → these slices; data-section framing
// reads the standings/stat-strip slices. All metrics are grounded in raw
// votes/submissions so the LLM narrates real numbers, never invents them.
//
// Scope: a competitor's points = points their *submitted* songs earned from
// other players' votes; season totals accumulate over rounds (ordered by id)
// up to and including the digest's round. Tunable defaults are the TOP_N /
// thresholds below.

const PODIUM_TOP_N = 8; // season standout tracks (spec: 5–8)
const VILLAIN_TOP_N = 6; // lowest-scoring tracks
const CONSENSUS_TOP_N = 6; // broadest-agreement darlings
const QUOTES_POOL_N = 25; // candidate vote-comments for the quotes section to pick from
const RECURRING_MIN_SUBS = 3; // min submissions to qualify as a "recurring low-scorer"
const RECURRING_TOP_N = 3;

export interface SeasonRoundRef {
  id: number;
  number: number; // 1-based position within the season
  name: string;
}

export interface SeasonContext {
  seasonId: number;
  seasonNumber: number;
  league: { id: number; name: string };
  /** e.g. "Hip Jammers S2" — matches the tastemaker payload's `season`. */
  seasonLabel: string;
  /** The digest's round (the cumulative scope boundary). */
  roundId: number;
  /** 1-based position of `roundId` within the season (e.g. 10). */
  throughRound: number;
  /** Total rounds that exist in the season (≥ throughRound mid-season). */
  totalRounds: number;
  /** Rounds ≤ roundId, chronological. */
  rounds: SeasonRoundRef[];
  /** Cumulative season leader as of roundId (the "champion" when final). */
  champion: { name: string; total: number } | null;
  relContext: string;
}

export interface SeasonSong {
  artist: string;
  title: string;
  album: string | null;
  submitter: string | null;
  round: string; // theme name of the round it was submitted in
  roundNumber: number;
  points: number; // cumulative points the song earned
  voters: number; // distinct players who gave it points
  mean: number; // avg points across its voters
  variance: number; // population variance of per-voter points (agreement spread)
}

export interface SeasonPodiumSlice {
  songs: Array<{ rank: number } & Omit<SeasonSong, 'mean' | 'variance'>>;
}

export interface SeasonVillainSlice {
  /** Lowest-net tracks of the season (no downvotes in this league → lowest points). */
  lowest: Array<Omit<SeasonSong, 'mean' | 'variance'>>;
  /** Players whose submissions consistently underperformed (playful "villain"). */
  recurringLowScorers: Array<{
    submitter: string;
    avgPoints: number;
    submissions: number;
    worstSong: { title: string; points: number } | null;
  }>;
}

export interface SeasonConsensusSlice {
  /** High-scoring tracks with broad + even support (many voters, low variance). */
  songs: Array<Omit<SeasonSong, 'album'>>;
}

export interface SeasonQuotesSlice {
  comments: Array<{
    voter: string;
    song: string;
    artist: string;
    round: string;
    points: number; // what this voter gave the song
    comment: string;
  }>;
}

export interface SeasonFlowSlice {
  /** Per-round cumulative snapshot, chronological. */
  rounds: Array<{
    number: number;
    name: string;
    leader: string | null; // cumulative #1 as of this round
    leaderTotal: number;
    topSong: { title: string; artist: string; submitter: string | null; points: number } | null;
  }>;
  leadChanges: number; // times the cumulative #1 changed across the season
  finalLeader: string | null;
}

export interface SeasonStatStripSlice {
  songs: number; // total submissions across the season
  votes: number; // total vote rows cast
  rounds: number; // rounds ≤ roundId
  players: number; // distinct submitters
  totalPointsAwarded: number;
  avgVotesPerRound: number;
  biggestRound: { number: number; name: string; totalVotes: number } | null;
}

export interface SeasonData {
  context: SeasonContext;
  podium: SeasonPodiumSlice;
  villain: SeasonVillainSlice;
  consensus: SeasonConsensusSlice;
  quotes: SeasonQuotesSlice;
  flow: SeasonFlowSlice;
  statStrip: SeasonStatStripSlice;
}

interface RawSeasonSong extends SeasonSong {
  roundId: number;
  submitterRaw: string | null;
}

/** Resolve season + the chronological round-id sequence up to (incl) roundId. */
function seasonScope(db: Database.Database, roundId: number) {
  const target = db
    .prepare(
      `SELECT r.id, r.season_id, s.season_number AS sn, s.league_id, l.name AS league_name
       FROM rounds r JOIN seasons s ON s.id = r.season_id JOIN leagues l ON l.id = s.league_id
       WHERE r.id = ?`,
    )
    .get(roundId) as
    | { id: number; season_id: number; sn: number; league_id: number; league_name: string }
    | undefined;
  if (!target) throw new Error(`round not found: ${roundId}`);

  const allRounds = db
    .prepare('SELECT id, name FROM rounds WHERE season_id = ? ORDER BY id')
    .all(target.season_id) as { id: number; name: string }[];
  const idx = allRounds.findIndex((r) => r.id === roundId);
  const upTo = allRounds.slice(0, idx + 1);
  const rounds: SeasonRoundRef[] = upTo.map((r, i) => ({ id: r.id, number: i + 1, name: r.name }));

  return {
    seasonId: target.season_id,
    seasonNumber: target.sn,
    league: { id: target.league_id, name: target.league_name },
    seasonLabel: `${target.league_name} S${target.sn}`,
    throughRound: idx + 1,
    totalRounds: allRounds.length,
    rounds,
    roundIdsUpTo: upTo.map((r) => r.id),
  };
}

/** One pass: every real submission ≤ roundId with cumulative points + agreement stats. */
function seasonSongs(db: Database.Database, roundIds: number[], roundNumberById: Map<number, string>, roundOrdinalById: Map<number, number>): RawSeasonSong[] {
  if (!roundIds.length) return [];
  const ph = roundIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT m.id AS sid, m.artists AS artists, m.title, m.album, c.name AS submitter,
              m.round_id AS round_id,
              COALESCE(SUM(v.points), 0) AS points,
              COUNT(v.points) AS voters,
              COALESCE(SUM(v.points * v.points), 0) AS sumsq
       FROM ml_submissions m
       LEFT JOIN competitors c ON c.id = m.competitor_id
       LEFT JOIN votes v ON v.round_id = m.round_id AND v.spotify_uri = m.spotify_uri
       WHERE m.round_id IN (${ph}) AND m.competitor_id IS NOT NULL
       GROUP BY m.id`,
    )
    .all(...roundIds) as {
    sid: number;
    artists: string;
    title: string;
    album: string | null;
    submitter: string | null;
    round_id: number;
    points: number;
    voters: number;
    sumsq: number;
  }[];

  return rows.map((r) => {
    const points = Number(r.points);
    const voters = Number(r.voters);
    const mean = voters > 0 ? points / voters : 0;
    const variance = voters > 0 ? Math.max(0, Number(r.sumsq) / voters - mean * mean) : 0;
    return {
      artist: (r.artists.split(',')[0] ?? r.artists).trim(),
      title: r.title,
      album: r.album,
      submitter: r.submitter,
      submitterRaw: r.submitter,
      round: roundNumberById.get(r.round_id) ?? '',
      roundNumber: roundOrdinalById.get(r.round_id) ?? 0,
      roundId: r.round_id,
      points,
      voters,
      mean: +mean.toFixed(2),
      variance: +variance.toFixed(2),
    };
  });
}

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function strip(s: RawSeasonSong): Omit<SeasonSong, 'mean' | 'variance'> {
  return {
    artist: s.artist, title: s.title, album: s.album, submitter: s.submitter,
    round: s.round, roundNumber: s.roundNumber, points: s.points, voters: s.voters,
  };
}

export function gatherSeasonData(db: Database.Database, roundId: number): SeasonData {
  const scope = seasonScope(db, roundId);
  const roundNumberById = new Map(scope.rounds.map((r) => [r.id, r.name]));
  const roundOrdinalById = new Map(scope.rounds.map((r) => [r.id, r.number]));
  const songs = seasonSongs(db, scope.roundIdsUpTo, roundNumberById, roundOrdinalById);

  // ── champion / final standings (reuse the sprint-14 cumulative model) ──────
  const finalStandings = computeStandings(db, roundId);
  const champion = finalStandings.length
    ? { name: finalStandings[0].name, total: finalStandings[0].currentTotal }
    : null;

  // ── podium: season top-N by cumulative points ─────────────────────────────
  const byPoints = [...songs].sort((a, b) => b.points - a.points || b.voters - a.voters);
  const podium: SeasonPodiumSlice = {
    songs: byPoints.slice(0, PODIUM_TOP_N).map((s, i) => ({ rank: i + 1, ...strip(s) })),
  };

  // ── villain: lowest-net tracks + recurring low-scorer ─────────────────────
  const lowest = [...songs]
    .sort((a, b) => a.points - b.points || a.voters - b.voters)
    .slice(0, VILLAIN_TOP_N)
    .map(strip);
  const bySubmitter = new Map<string, RawSeasonSong[]>();
  for (const s of songs) {
    if (!s.submitter) continue;
    (bySubmitter.get(s.submitter) ?? bySubmitter.set(s.submitter, []).get(s.submitter)!).push(s);
  }
  const recurringLowScorers = [...bySubmitter.entries()]
    .filter(([, list]) => list.length >= RECURRING_MIN_SUBS)
    .map(([submitter, list]) => {
      const total = list.reduce((a, s) => a + s.points, 0);
      const worst = [...list].sort((a, b) => a.points - b.points)[0];
      return {
        submitter,
        avgPoints: +(total / list.length).toFixed(2),
        submissions: list.length,
        worstSong: worst ? { title: worst.title, points: worst.points } : null,
      };
    })
    .sort((a, b) => a.avgPoints - b.avgPoints)
    .slice(0, RECURRING_TOP_N);
  const villain: SeasonVillainSlice = { lowest, recurringLowScorers };

  // ── consensus: high-scoring + broad/even support ──────────────────────────
  const med = median(songs.map((s) => s.points));
  const consensus: SeasonConsensusSlice = {
    songs: [...songs]
      .filter((s) => s.points >= med && s.voters >= 2)
      .sort((a, b) => b.voters - a.voters || a.variance - b.variance || b.points - a.points)
      .slice(0, CONSENSUS_TOP_N)
      .map((s) => ({
        artist: s.artist, title: s.title, submitter: s.submitter, round: s.round,
        roundNumber: s.roundNumber, points: s.points, voters: s.voters, mean: s.mean, variance: s.variance,
      })),
  };

  // ── quotes: ranked pool of season vote-comments ───────────────────────────
  const ph = scope.roundIdsUpTo.map(() => '?').join(',');
  const commentRows = scope.roundIdsUpTo.length
    ? (db
        .prepare(
          `SELECT cv.name AS voter, m.title AS song, m.artists AS artist, r.name AS round,
                  v.points, v.comment
           FROM votes v
           JOIN competitors cv ON cv.id = v.voter_id
           JOIN ml_submissions m ON m.round_id = v.round_id AND m.spotify_uri = v.spotify_uri
           JOIN rounds r ON r.id = v.round_id
           WHERE v.round_id IN (${ph}) AND v.comment IS NOT NULL AND TRIM(v.comment) <> ''`,
        )
        .all(...scope.roundIdsUpTo) as {
        voter: string; song: string; artist: string; round: string; points: number; comment: string;
      }[])
    : [];
  const quotes: SeasonQuotesSlice = {
    comments: commentRows
      .map((c) => ({ ...c, artist: (c.artist.split(',')[0] ?? c.artist).trim(), comment: c.comment.trim() }))
      // rank by substance (length) as a token-light proxy; the LLM picks the best.
      .sort((a, b) => b.comment.length - a.comment.length)
      .slice(0, QUOTES_POOL_N),
  };

  // ── flow: round-by-round cumulative progression + themes ──────────────────
  const flowRounds = scope.rounds.map((r) => {
    const standings = computeStandings(db, r.id);
    const leader = standings[0] ?? null;
    const roundTop = byPoints.length
      ? [...songs].filter((s) => s.roundId === r.id).sort((a, b) => b.points - a.points)[0]
      : null;
    return {
      number: r.number,
      name: r.name,
      leader: leader?.name ?? null,
      leaderTotal: leader?.currentTotal ?? 0,
      topSong: roundTop
        ? { title: roundTop.title, artist: roundTop.artist, submitter: roundTop.submitter, points: roundTop.points }
        : null,
    };
  });
  let leadChanges = 0;
  for (let i = 1; i < flowRounds.length; i++) {
    if (flowRounds[i].leader && flowRounds[i].leader !== flowRounds[i - 1].leader) leadChanges++;
  }
  const flow: SeasonFlowSlice = {
    rounds: flowRounds,
    leadChanges,
    finalLeader: flowRounds.length ? flowRounds[flowRounds.length - 1].leader : null,
  };

  // ── stat-strip: season totals ─────────────────────────────────────────────
  const votesPerRound = scope.rounds.map((r) => ({
    number: r.number,
    name: r.name,
    totalVotes: (db.prepare('SELECT COUNT(*) AS n FROM votes WHERE round_id = ?').get(r.id) as { n: number }).n,
  }));
  const biggestRound = votesPerRound.length
    ? [...votesPerRound].sort((a, b) => b.totalVotes - a.totalVotes)[0]
    : null;
  const totalVotes = votesPerRound.reduce((a, r) => a + r.totalVotes, 0);
  const statStrip: SeasonStatStripSlice = {
    songs: songs.length,
    votes: totalVotes,
    rounds: scope.rounds.length,
    players: new Set(songs.map((s) => s.submitter).filter(Boolean)).size,
    totalPointsAwarded: songs.reduce((a, s) => a + s.points, 0),
    avgVotesPerRound: scope.rounds.length ? +(totalVotes / scope.rounds.length).toFixed(1) : 0,
    biggestRound,
  };

  const context: SeasonContext = {
    seasonId: scope.seasonId,
    seasonNumber: scope.seasonNumber,
    league: scope.league,
    seasonLabel: scope.seasonLabel,
    roundId,
    throughRound: scope.throughRound,
    totalRounds: scope.totalRounds,
    rounds: scope.rounds,
    champion,
    relContext:
      (db.prepare('SELECT text FROM relationship_contexts WHERE league_id = ?').get(scope.league.id) as
        | { text: string }
        | undefined)?.text ?? '',
  };

  return { context, podium, villain, consensus, quotes, flow, statStrip };
}
