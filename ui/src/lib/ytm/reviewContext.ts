import type Database from 'better-sqlite3';

/** Round + league naming for a review, used in notifications and messages. */
export function reviewContext(db: Database.Database, roundId: number): { roundName: string; leagueTitle: string } {
  const row = db.prepare(
    `SELECT r.name AS roundName, l.name AS leagueTitle
       FROM rounds r JOIN seasons s ON s.id = r.season_id JOIN leagues l ON l.id = s.league_id
      WHERE r.id = ?`,
  ).get(roundId) as { roundName: string; leagueTitle: string } | undefined;
  return row ?? { roundName: `Round ${roundId}`, leagueTitle: 'Music League' };
}
