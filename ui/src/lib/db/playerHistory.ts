import type Database from 'better-sqlite3';

// Player-history service — powers Tab 3 "Player research".
//   getPlayers(db)        -> roster summary [{ name, songsSubmitted, winRate }]
//   getPlayer(db, name)   -> per-player detail { songs, winRate, tasteOverlap }
//
// Identity is by stable player_id join when competitors.player_id is set;
// falls back to competitors.id for unlinked competitors. Renames in the
// players table leave history intact; cross-league competitors sharing a
// player_id appear as one unified record.
//
// winRate     = rounds won ÷ rounds participated. A round is "won" when the
//               player's best-scoring submission ties the round's max points
//               (and that max is > 0, so an all-zero round isn't a win for all).
// tasteOverlap = co-voting Jaccard: over the set of songs each player awarded
//               points to (points > 0), |A∩B| / |A∪B|. A symmetric 0..1 score.

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
  // 'p:N' when competitors.player_id is set; 'c:N' for unlinked competitors.
  stable_key: string;
  display_name: string;
  points: number;
}

/** Per-submission points keyed by stable player key and round. */
function submissionRows(db: Database.Database): SubRow[] {
  return db
    .prepare(
      `SELECT m.round_id,
              CASE WHEN c.player_id IS NOT NULL THEN 'p:' || c.player_id ELSE 'c:' || c.id END AS stable_key,
              CASE WHEN c.player_id IS NOT NULL THEN p.name ELSE c.name END AS display_name,
              COALESCE(SUM(v.points), 0) AS points
       FROM ml_submissions m
       JOIN competitors c ON c.id = m.competitor_id
       LEFT JOIN players p ON p.id = c.player_id
       LEFT JOIN votes v ON v.round_id = m.round_id AND v.spotify_uri = m.spotify_uri
       GROUP BY m.id`,
    )
    .all() as SubRow[];
}

/**
 * Win rate per stable key: rounds-won ÷ rounds-participated.
 */
function winRates(rows: SubRow[]): Map<string, number> {
  const roundMax = new Map<number, number>();
  const playerBest = new Map<string, Map<number, number>>(); // key -> round -> best pts
  for (const r of rows) {
    roundMax.set(r.round_id, Math.max(roundMax.get(r.round_id) ?? 0, r.points));
    let perRound = playerBest.get(r.stable_key);
    if (!perRound) { perRound = new Map(); playerBest.set(r.stable_key, perRound); }
    perRound.set(r.round_id, Math.max(perRound.get(r.round_id) ?? 0, r.points));
  }

  const out = new Map<string, number>();
  for (const [key, perRound] of playerBest) {
    let won = 0;
    const participated = perRound.size;
    for (const [roundId, best] of perRound) {
      const max = roundMax.get(roundId) ?? 0;
      if (max > 0 && best === max) won++;
    }
    out.set(key, participated ? won / participated : 0);
  }
  return out;
}

/** Set of songs (spotify_uri) each stable key awarded points to — for taste overlap. */
function votedSets(db: Database.Database): Map<string, Set<string>> {
  const rows = db
    .prepare(
      `SELECT CASE WHEN c.player_id IS NOT NULL THEN 'p:' || c.player_id ELSE 'c:' || c.id END AS stable_key,
              v.spotify_uri AS uri
       FROM votes v
       JOIN competitors c ON c.id = v.voter_id
       WHERE v.points > 0`,
    )
    .all() as { stable_key: string; uri: string }[];
  const out = new Map<string, Set<string>>();
  for (const r of rows) {
    let set = out.get(r.stable_key);
    if (!set) { set = new Set(); out.set(r.stable_key, set); }
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

/** Roster summary: every player/competitor who has submitted at least one song. */
export function getPlayers(db: Database.Database): PlayerSummary[] {
  const rows = submissionRows(db);
  const rates = winRates(rows);
  const counts = new Map<string, number>();
  const names = new Map<string, string>(); // stable_key → display_name
  for (const r of rows) {
    counts.set(r.stable_key, (counts.get(r.stable_key) ?? 0) + 1);
    names.set(r.stable_key, r.display_name);
  }

  return Array.from(counts.entries())
    .map(([key, songsSubmitted]) => ({
      name: names.get(key)!,
      songsSubmitted,
      winRate: rates.get(key) ?? 0,
    }))
    .sort((a, b) => b.songsSubmitted - a.songsSubmitted || a.name.localeCompare(b.name));
}

/**
 * Resolve the stable key and competitor IDs for a player by display name.
 * Checks players table first (returns 'p:N' key + all linked competitor IDs),
 * falls back to competitors table ('c:N' key).
 */
function resolvePlayerKey(db: Database.Database, name: string): { key: string; competitorIds: number[] } | null {
  const player = db.prepare('SELECT id FROM players WHERE name = ?').get(name) as { id: number } | undefined;
  if (player) {
    const comps = db
      .prepare('SELECT id FROM competitors WHERE player_id = ?')
      .all(player.id) as { id: number }[];
    if (comps.length) return { key: `p:${player.id}`, competitorIds: comps.map((c) => c.id) };
  }
  const comp = db.prepare('SELECT id FROM competitors WHERE name = ?').get(name) as { id: number } | undefined;
  if (comp) return { key: `c:${comp.id}`, competitorIds: [comp.id] };
  return null;
}

/** Per-player detail: submitted songs, win rate, and taste overlap vs everyone else. */
export function getPlayer(db: Database.Database, name: string): PlayerDetail {
  const resolved = resolvePlayerKey(db, name);
  if (!resolved) return { songs: [], winRate: 0, tasteOverlap: {} };

  const { key, competitorIds } = resolved;
  const placeholders = competitorIds.map(() => '?').join(', ');

  const songs = db
    .prepare(
      `SELECT r.name AS round, m.title AS title, m.artists AS artist,
              COALESCE(SUM(v.points), 0) AS points
       FROM ml_submissions m
       JOIN competitors c ON c.id = m.competitor_id
       JOIN rounds r ON r.id = m.round_id
       JOIN seasons s ON s.id = r.season_id
       LEFT JOIN votes v ON v.round_id = m.round_id AND v.spotify_uri = m.spotify_uri
       WHERE m.competitor_id IN (${placeholders})
       GROUP BY m.id
       ORDER BY s.season_number, r.created_at, r.id`,
    )
    .all(...competitorIds) as { round: string; title: string; artist: string; points: number }[];

  const rows = submissionRows(db);
  const winRate = winRates(rows).get(key) ?? 0;

  const displayNames = new Map<string, string>();
  for (const r of rows) displayNames.set(r.stable_key, r.display_name);

  const sets = votedSets(db);
  const mine = sets.get(key) ?? new Set<string>();
  const tasteOverlap: Record<string, number> = {};
  for (const [otherKey, otherSet] of sets) {
    if (otherKey === key) continue;
    const score = jaccard(mine, otherSet);
    if (score > 0) {
      const displayName = displayNames.get(otherKey);
      if (displayName) tasteOverlap[displayName] = Math.round(score * 1000) / 1000;
    }
  }

  return {
    songs: songs.map((s) => ({ round: s.round, title: s.title, artist: s.artist, points: Number(s.points) })),
    winRate,
    tasteOverlap,
  };
}
