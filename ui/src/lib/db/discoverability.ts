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

// Minimum fraction of a season's real submissions that must have popularity data
// before we render a leaderboard. Below this the data is incomplete (e.g. a
// season whose popularity backfill hasn't run — only songs that overlap an
// already-fetched season would appear), which produces a misleading near-empty
// board, so we self-suppress instead. 0.8 = require ≥80% coverage.
export const COVERAGE_THRESHOLD = 0.8;

/**
 * Returns the season's discoverability rows, ranked most-obscure first — or null
 * when popularity coverage is absent OR PARTIAL (< COVERAGE_THRESHOLD of the
 * season's submissions scored). Null → the section self-suppresses.
 */
export function getDiscoverability(db: Database.Database, roundId: number): DiscoverabilityRow[] | null {
  const round = db.prepare('SELECT season_id FROM rounds WHERE id = ?').get(roundId) as { season_id: number } | undefined;
  if (!round) return null;

  // Coverage gate: how many of the season's real submissions have popularity data?
  const cov = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN sp.popularity_proxy IS NOT NULL THEN 1 ELSE 0 END) AS covered
       FROM ml_submissions m
       JOIN rounds r ON r.id = m.round_id
       LEFT JOIN song_popularity sp ON sp.spotify_uri = m.spotify_uri
       WHERE r.season_id = ? AND m.competitor_id IS NOT NULL AND m.spotify_uri LIKE 'spotify:track:%'`,
    )
    .get(round.season_id) as { total: number; covered: number };
  if (!cov.total || cov.covered / cov.total < COVERAGE_THRESHOLD) return null;

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
