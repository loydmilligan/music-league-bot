import type Database from 'better-sqlite3';
import type { SongStanding, PodiumCellar, Bucket, BucketKey, ScoringType } from './types.js';

export function standings(db: Database.Database, roundId: number, ownerCompetitorId: number): SongStanding[] {
  const rows = db.prepare(`
    SELECT ms.spotify_uri AS uri, ms.title, ms.artists AS artist, ms.competitor_id AS cid,
           COALESCE(SUM(v.points), 0) AS pts, sp.spotify_popularity AS pop, sp.listeners AS lst
    FROM ml_submissions ms
    LEFT JOIN votes v ON v.round_id = ms.round_id AND v.spotify_uri = ms.spotify_uri
    LEFT JOIN song_popularity sp ON sp.spotify_uri = ms.spotify_uri
    WHERE ms.round_id = ?
    GROUP BY ms.id
    ORDER BY pts DESC
  `).all(roundId) as Array<{ uri: string; title: string; artist: string; cid: number; pts: number; pop: number | null; lst: number | null }>;
  return rows.map((r, i) => ({
    rank: i + 1,
    points: r.pts,
    spotifyUri: r.uri,
    title: r.title,
    artist: r.artist,
    submitterIsOwner: r.cid === ownerCompetitorId,
    popularity: r.pop ?? null,
    listeners: r.lst ?? null,
  }));
}

export function podiumCellar(rows: SongStanding[]): PodiumCellar {
  if (rows.length === 0) return { podium: [], cellar: [] };
  return { podium: rows.slice(0, 3), cellar: [rows[rows.length - 1]] };
}

function bucketOf(pop: number | null): BucketKey {
  if (pop === null) return 'unknown';
  if (pop >= 65) return 'mainstream';
  if (pop >= 45) return 'mid';
  return 'obscure';
}
const BUCKET_LABEL: Record<BucketKey, string> = {
  mainstream: 'Mainstream (pop 65+)', mid: 'Mid (45–64)', obscure: 'Obscure (<45)', unknown: 'Unknown',
};

export function familiarityBuckets(rows: SongStanding[]): Bucket[] {
  const groups = new Map<BucketKey, number[]>();
  for (const r of rows) {
    const k = bucketOf(r.popularity);
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(r.points);
  }
  const order: BucketKey[] = ['mainstream', 'mid', 'obscure', 'unknown'];
  return order.filter((k) => groups.has(k)).map((k) => {
    const pts = groups.get(k)!;
    return { key: k, label: BUCKET_LABEL[k], n: pts.length, avgPoints: Math.round((pts.reduce((a, b) => a + b, 0) / pts.length) * 10) / 10 };
  });
}

export function leagueScoringType(db: Database.Database, leagueId: number): ScoringType {
  const row = db.prepare(`
    SELECT MIN(v.points) AS minp
    FROM votes v JOIN rounds r ON r.id = v.round_id JOIN seasons s ON s.id = r.season_id
    WHERE s.league_id = ?
  `).get(leagueId) as { minp: number | null };
  return (row.minp ?? 0) < 0 ? 'downvotes' : 'upvote-only';
}
