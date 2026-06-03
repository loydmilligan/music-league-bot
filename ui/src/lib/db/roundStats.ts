import type Database from 'better-sqlite3';

// sprint-17 stats-strip-data — by-the-numbers tiles for a round, computed from
// the same submissions/votes source as standings.

export interface RoundStats {
  totalVotes: number;    // vote rows cast this round
  submitters: number;    // distinct players who submitted
  blowoutMargin: number; // winner points − runner-up points
  closestRace: number;   // smallest gap between adjacent-ranked songs
  uniqueArtists: number; // distinct first-listed artists
}

export function getRoundStats(db: Database.Database, roundId: number): RoundStats {
  const totalVotes = (db.prepare('SELECT COUNT(*) AS n FROM votes WHERE round_id = ?').get(roundId) as { n: number }).n;
  const submitters = (db
    .prepare('SELECT COUNT(DISTINCT competitor_id) AS n FROM ml_submissions WHERE round_id = ? AND competitor_id IS NOT NULL')
    .get(roundId) as { n: number }).n;

  const songs = db
    .prepare(
      `SELECT m.artists AS artists, COALESCE(SUM(v.points), 0) AS pts
       FROM ml_submissions m
       LEFT JOIN votes v ON v.round_id = m.round_id AND v.spotify_uri = m.spotify_uri
       WHERE m.round_id = ? AND m.competitor_id IS NOT NULL
       GROUP BY m.id
       ORDER BY pts DESC`,
    )
    .all(roundId) as { artists: string; pts: number }[];

  const totals = songs.map((s) => Number(s.pts));
  const blowoutMargin = totals.length >= 2 ? totals[0] - totals[1] : 0;
  let closestRace = 0;
  for (let i = 1; i < totals.length; i++) {
    const gap = totals[i - 1] - totals[i];
    if (i === 1 || gap < closestRace) closestRace = gap;
  }

  const artists = new Set(
    songs.map((s) => (s.artists.split(',')[0] ?? '').trim().toLowerCase()).filter(Boolean),
  );

  return { totalVotes, submitters, blowoutMargin, closestRace, uniqueArtists: artists.size };
}
