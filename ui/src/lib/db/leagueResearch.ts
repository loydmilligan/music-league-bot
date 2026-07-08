import type Database from 'better-sqlite3';
import { normalizeGenre, type Matrix, type MatrixCell } from '../league-research/viz.js';

// League Research service (sprint-26) — powers the /history "League research" tab.
// Scoped to ONE league at a time (optionally one season). Produces the three
// view datasets: the voter×submitter points matrix (+ per-cell obscurity/energy
// for the auto-callouts), the round-by-round obscurity drift with tie-aware
// winners, and per-player genre submit/vote tallies. Presentation math (intensity
// ramp, callouts, SVG geometry, tornado %) lives in league-research/viz.ts.

export interface SeasonMeta {
  season: number;
  status: string;
}
export interface DriftRoundData {
  season: number;
  roundName: string;
  medianObsc: number;
  winners: number[]; // obscurity of the round's winning song(s); >1 = genuine tie
  seasonStart: boolean;
}
export interface PlayerGenre {
  submitCounts: Record<string, number>;
  submitTotal: number;
  voteCounts: Record<string, number>;
  voteTotal: number;
}
export interface LeagueResearch {
  leagueId: number;
  slug: string;
  name: string;
  seasons: SeasonMeta[];
  season: number | null; // active season filter, null = all seasons
  roster: string[];
  maxPoints: number;
  matrix: Matrix;
  drift: DriftRoundData[];
  genreByPlayer: Record<string, PlayerGenre>;
}

const round1 = (n: number | null): number | null => (n === null ? null : Math.round(n));

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

function topTagOf(tagsJson: string | null): string | null {
  if (!tagsJson) return null;
  try {
    const v = JSON.parse(tagsJson);
    return Array.isArray(v) && typeof v[0] === 'string' ? normalizeGenre(v[0]) : null;
  } catch {
    return null;
  }
}

/** Build the full League Research dataset for one league, optionally one season. */
export function getLeagueResearch(
  db: Database.Database,
  leagueId: number,
  season: number | null = null,
): LeagueResearch | null {
  const league = db
    .prepare('SELECT id, slug, name FROM leagues WHERE id = ?')
    .get(leagueId) as { id: number; slug: string; name: string } | undefined;
  if (!league) return null;

  const seasons = (
    db
      .prepare('SELECT season_number AS season, status FROM seasons WHERE league_id = ? ORDER BY season_number')
      .all(leagueId) as SeasonMeta[]
  ).map((s) => ({ season: Number(s.season), status: s.status }));

  // Scope predicate shared by every query.
  const scope = season === null ? 's.league_id = ?' : 's.league_id = ? AND s.season_number = ?';
  const scopeArgs: number[] = season === null ? [leagueId] : [leagueId, season];

  // ── Roster (ordered by total points received) ──
  const roster = (
    db
      .prepare(
        `SELECT c.name AS name, COALESCE(SUM(v.points), 0) AS pts
         FROM ml_submissions m
         JOIN rounds r ON r.id = m.round_id
         JOIN seasons s ON s.id = r.season_id
         JOIN competitors c ON c.id = m.competitor_id
         LEFT JOIN votes v ON v.round_id = m.round_id AND v.spotify_uri = m.spotify_uri
         WHERE ${scope}
         GROUP BY c.name
         ORDER BY pts DESC, c.name`,
      )
      .all(...scopeArgs) as { name: string; pts: number }[]
  ).map((r) => r.name);
  const idx = new Map(roster.map((name, i) => [name, i]));

  // ── Matrix (voter → submitter) ──
  const edges = db
    .prepare(
      `SELECT vc.name AS voter, sc.name AS submitter,
              SUM(v.points) AS points, COUNT(*) AS cnt,
              AVG(CASE WHEN sp.popularity_proxy IS NOT NULL THEN 100 - sp.popularity_proxy END) AS obscurity,
              AVG(af.energy) AS energy
       FROM votes v
       JOIN rounds r ON r.id = v.round_id
       JOIN seasons s ON s.id = r.season_id
       JOIN ml_submissions m ON m.round_id = v.round_id AND m.spotify_uri = v.spotify_uri
       JOIN competitors vc ON vc.id = v.voter_id
       JOIN competitors sc ON sc.id = m.competitor_id
       LEFT JOIN song_popularity sp ON sp.spotify_uri = v.spotify_uri
       LEFT JOIN song_audio_features af ON af.spotify_uri = v.spotify_uri
       WHERE ${scope}
       GROUP BY vc.name, sc.name`,
    )
    .all(...scopeArgs) as {
    voter: string;
    submitter: string;
    points: number;
    cnt: number;
    obscurity: number | null;
    energy: number | null;
  }[];

  const n = roster.length;
  const matrix: Matrix = Array.from({ length: n }, (_, r) =>
    Array.from({ length: n }, (_, c): MatrixCell | null =>
      r === c ? null : { points: null, count: 0, obscurity: null, energy: null },
    ),
  );
  let maxPoints = 0;
  for (const e of edges) {
    const r = idx.get(e.voter);
    const c = idx.get(e.submitter);
    if (r === undefined || c === undefined || r === c) continue;
    const points = Number(e.points);
    matrix[r][c] = {
      points,
      count: Number(e.cnt),
      obscurity: round1(e.obscurity),
      energy: round1(e.energy),
    };
    if (points > maxPoints) maxPoints = points;
  }

  // ── Drift (per round, chronological across seasons) ──
  const subs = db
    .prepare(
      `SELECT r.id AS roundId, s.season_number AS season, r.name AS roundName, r.created_at AS createdAt,
              CASE WHEN sp.popularity_proxy IS NOT NULL THEN 100 - sp.popularity_proxy END AS obsc,
              COALESCE(SUM(v.points), 0) AS pts,
              (SELECT COUNT(*) FROM votes vv WHERE vv.round_id = r.id) AS roundVotes
       FROM ml_submissions m
       JOIN rounds r ON r.id = m.round_id
       JOIN seasons s ON s.id = r.season_id
       LEFT JOIN votes v ON v.round_id = m.round_id AND v.spotify_uri = m.spotify_uri
       LEFT JOIN song_popularity sp ON sp.spotify_uri = m.spotify_uri
       WHERE ${scope}
       GROUP BY m.id
       ORDER BY s.season_number, r.created_at, r.id`,
    )
    .all(...scopeArgs) as {
    roundId: number;
    season: number;
    roundName: string;
    createdAt: string;
    obsc: number | null;
    pts: number;
    roundVotes: number;
  }[];

  const driftMap = new Map<
    number,
    { season: number; roundName: string; obsc: number[]; songs: { pts: number; obsc: number | null }[]; voted: boolean }
  >();
  const roundOrder: number[] = [];
  for (const s of subs) {
    let e = driftMap.get(s.roundId);
    if (!e) {
      e = { season: Number(s.season), roundName: s.roundName, obsc: [], songs: [], voted: Number(s.roundVotes) > 0 };
      driftMap.set(s.roundId, e);
      roundOrder.push(s.roundId);
    }
    if (s.obsc !== null) e.obsc.push(s.obsc);
    e.songs.push({ pts: Number(s.pts), obsc: s.obsc });
  }
  let prevSeason: number | null = null;
  const drift: DriftRoundData[] = roundOrder.map((rid) => {
    const e = driftMap.get(rid)!;
    // Winner(s) = song(s) at the round's max points (only if the round was voted);
    // ties yield multiple. Only dot winners whose obscurity is known.
    let winners: number[] = [];
    if (e.voted) {
      const maxPts = Math.max(...e.songs.map((x) => x.pts));
      if (maxPts > 0) {
        winners = e.songs.filter((x) => x.pts === maxPts && x.obsc !== null).map((x) => x.obsc as number);
      }
    }
    const seasonStart = e.season !== prevSeason;
    prevSeason = e.season;
    return { season: e.season, roundName: e.roundName, medianObsc: median(e.obsc), winners, seasonStart };
  });

  // ── Genre per player (top tag per song → canonical) ──
  const genreByPlayer: Record<string, PlayerGenre> = {};
  const ensure = (name: string): PlayerGenre =>
    (genreByPlayer[name] ??= { submitCounts: {}, submitTotal: 0, voteCounts: {}, voteTotal: 0 });

  const submitRows = db
    .prepare(
      `SELECT c.name AS player, sp.tags AS tags
       FROM ml_submissions m
       JOIN rounds r ON r.id = m.round_id
       JOIN seasons s ON s.id = r.season_id
       JOIN competitors c ON c.id = m.competitor_id
       LEFT JOIN song_popularity sp ON sp.spotify_uri = m.spotify_uri
       WHERE ${scope}`,
    )
    .all(...scopeArgs) as { player: string; tags: string | null }[];
  for (const row of submitRows) {
    const g = ensure(row.player);
    g.submitTotal += 1;
    const canon = topTagOf(row.tags);
    if (canon) g.submitCounts[canon] = (g.submitCounts[canon] ?? 0) + 1;
  }

  const voteRows = db
    .prepare(
      `SELECT vc.name AS player, sp.tags AS tags
       FROM votes v
       JOIN rounds r ON r.id = v.round_id
       JOIN seasons s ON s.id = r.season_id
       JOIN ml_submissions m ON m.round_id = v.round_id AND m.spotify_uri = v.spotify_uri
       JOIN competitors vc ON vc.id = v.voter_id
       LEFT JOIN song_popularity sp ON sp.spotify_uri = v.spotify_uri
       WHERE ${scope} AND v.points > 0`,
    )
    .all(...scopeArgs) as { player: string; tags: string | null }[];
  for (const row of voteRows) {
    const g = ensure(row.player);
    g.voteTotal += 1;
    const canon = topTagOf(row.tags);
    if (canon) g.voteCounts[canon] = (g.voteCounts[canon] ?? 0) + 1;
  }

  return {
    leagueId,
    slug: league.slug,
    name: league.name,
    seasons,
    season,
    roster,
    maxPoints,
    matrix,
    drift,
    genreByPlayer,
  };
}
