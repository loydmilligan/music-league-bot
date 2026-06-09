import type Database from 'better-sqlite3';

// Player-history service (sprint-24, player-data) — powers Tab 3 "Player research".
//   getPlayers(db)        -> roster summary [{ name, songsSubmitted, winRate }]
//   getPlayer(db, name)   -> per-player detail { songs, winRate, tasteOverlap }
//
// Identity is by competitor NAME (the human-facing handle). Joins mirror
// songHistory.ts / research.ts: a submission's points = SUM(votes.points) for
// its round+uri.
//
// winRate     = rounds won ÷ rounds participated. A round is "won" when the
//               player's best-scoring submission ties the round's max points
//               (and that max is > 0, so an all-zero round isn't a win for all).
// tasteOverlap = co-voting Jaccard: over the set of songs each player awarded
//               points to (points > 0), |A∩B| / |A∪B|. A symmetric 0..1 score,
//               a sensible default that's tunable later.

export interface PlayerSummary {
  name: string;
  songsSubmitted: number;
  winRate: number;
}

export interface PlayerSong {
  round: string;
  title: string;
  artist: string;
  points: number;
}

export interface PlayerDetail {
  songs: PlayerSong[];
  winRate: number;
  tasteOverlap: Record<string, number>;
}

interface SubRow {
  round_id: number;
  name: string;
  points: number;
}

/** Per-submission points keyed by competitor name and round. */
function submissionRows(db: Database.Database): SubRow[] {
  return db
    .prepare(
      `SELECT m.round_id AS round_id, c.name AS name,
              COALESCE(SUM(v.points), 0) AS points
       FROM ml_submissions m
       JOIN competitors c ON c.id = m.competitor_id
       LEFT JOIN votes v ON v.round_id = m.round_id AND v.spotify_uri = m.spotify_uri
       GROUP BY m.id`,
    )
    .all() as SubRow[];
}

/**
 * Win rate per player: rounds-won ÷ rounds-participated. Computed from the full
 * submission set so a single pass serves both the roster and the detail view.
 */
function winRates(rows: SubRow[]): Map<string, number> {
  // Round max points, and each player's best submission per round.
  const roundMax = new Map<number, number>();
  const playerBest = new Map<string, Map<number, number>>(); // name -> round -> best pts
  for (const r of rows) {
    roundMax.set(r.round_id, Math.max(roundMax.get(r.round_id) ?? 0, r.points));
    let perRound = playerBest.get(r.name);
    if (!perRound) { perRound = new Map(); playerBest.set(r.name, perRound); }
    perRound.set(r.round_id, Math.max(perRound.get(r.round_id) ?? 0, r.points));
  }

  const out = new Map<string, number>();
  for (const [name, perRound] of playerBest) {
    let won = 0;
    const participated = perRound.size;
    for (const [roundId, best] of perRound) {
      const max = roundMax.get(roundId) ?? 0;
      if (max > 0 && best === max) won++;
    }
    out.set(name, participated ? won / participated : 0);
  }
  return out;
}

/** Set of songs (spotify_uri) each player awarded points to — for taste overlap. */
function votedSets(db: Database.Database): Map<string, Set<string>> {
  const rows = db
    .prepare(
      `SELECT c.name AS name, v.spotify_uri AS uri
       FROM votes v
       JOIN competitors c ON c.id = v.voter_id
       WHERE v.points > 0`,
    )
    .all() as { name: string; uri: string }[];
  const out = new Map<string, Set<string>>();
  for (const r of rows) {
    let set = out.get(r.name);
    if (!set) { set = new Set(); out.set(r.name, set); }
    set.add(r.uri);
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union ? inter / union : 0;
}

/** Roster summary: every player who has submitted at least one song. */
export function getPlayers(db: Database.Database): PlayerSummary[] {
  const rows = submissionRows(db);
  const rates = winRates(rows);
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.name, (counts.get(r.name) ?? 0) + 1);

  return Array.from(counts.entries())
    .map(([name, songsSubmitted]) => ({ name, songsSubmitted, winRate: rates.get(name) ?? 0 }))
    .sort((a, b) => b.songsSubmitted - a.songsSubmitted || a.name.localeCompare(b.name));
}

/** Per-player detail: submitted songs, win rate, and taste overlap vs everyone else. */
export function getPlayer(db: Database.Database, name: string): PlayerDetail {
  const songs = db
    .prepare(
      `SELECT r.name AS round, m.title AS title, m.artists AS artist,
              COALESCE(SUM(v.points), 0) AS points
       FROM ml_submissions m
       JOIN competitors c ON c.id = m.competitor_id
       JOIN rounds r ON r.id = m.round_id
       JOIN seasons s ON s.id = r.season_id
       LEFT JOIN votes v ON v.round_id = m.round_id AND v.spotify_uri = m.spotify_uri
       WHERE c.name = ?
       GROUP BY m.id
       ORDER BY s.season_number, r.created_at, r.id`,
    )
    .all(name) as { round: string; title: string; artist: string; points: number }[];

  const winRate = winRates(submissionRows(db)).get(name) ?? 0;

  const sets = votedSets(db);
  const mine = sets.get(name) ?? new Set<string>();
  const tasteOverlap: Record<string, number> = {};
  for (const [other, set] of sets) {
    if (other === name) continue;
    const score = jaccard(mine, set);
    if (score > 0) tasteOverlap[other] = Math.round(score * 1000) / 1000;
  }

  return {
    songs: songs.map((s) => ({ round: s.round, title: s.title, artist: s.artist, points: Number(s.points) })),
    winRate,
    tasteOverlap,
  };
}
