import type Database from 'better-sqlite3';

// sprint-17 discoverability-data — per-player "tastemaker leaderboard" for a
// season. obscurity = 100 − popularity_proxy (stored, from Last.fm via
// scripts/backfill-popularity.ts); per player = mean obscurity across their
// season submissions that have popularity data. Ranked most-obscure first.

export interface DiscoverabilityRow {
  name: string;
  obscurityScore: number; // 0-100, higher = more obscure picks
  submissionCount: number;
  avgPopularity: number; // 0-100, mean popularity_proxy
}

/** Returns the season's discoverability rows, or null when no popularity data exists (self-suppress). */
export function getDiscoverability(db: Database.Database, roundId: number): DiscoverabilityRow[] | null {
  const round = db.prepare('SELECT season_id FROM rounds WHERE id = ?').get(roundId) as { season_id: number } | undefined;
  if (!round) return null;

  const rows = db
    .prepare(
      `SELECT c.name AS name, sp.popularity_proxy AS proxy
       FROM ml_submissions m
       JOIN rounds r ON r.id = m.round_id
       JOIN competitors c ON c.id = m.competitor_id
       JOIN song_popularity sp ON sp.spotify_uri = m.spotify_uri
       WHERE r.season_id = ? AND m.competitor_id IS NOT NULL AND sp.popularity_proxy IS NOT NULL`,
    )
    .all(round.season_id) as { name: string; proxy: number }[];
  if (!rows.length) return null;

  const byName = new Map<string, { sumObsc: number; sumPop: number; n: number }>();
  for (const r of rows) {
    const e = byName.get(r.name) ?? { sumObsc: 0, sumPop: 0, n: 0 };
    e.sumObsc += 100 - r.proxy;
    e.sumPop += r.proxy;
    e.n += 1;
    byName.set(r.name, e);
  }

  const out: DiscoverabilityRow[] = [...byName].map(([name, e]) => ({
    name,
    obscurityScore: Math.round(e.sumObsc / e.n),
    submissionCount: e.n,
    avgPopularity: Math.round(e.sumPop / e.n),
  }));
  out.sort((a, b) => b.obscurityScore - a.obscurityScore || a.name.localeCompare(b.name));
  return out;
}
