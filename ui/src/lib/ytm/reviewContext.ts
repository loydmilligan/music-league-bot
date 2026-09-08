import type Database from 'better-sqlite3';

/** Round + league naming for a review, used in notifications, covers and messages. */
export function reviewContext(
  db: Database.Database, roundId: number,
): { roundName: string; leagueTitle: string; roundNumber: number | null } {
  const row = db.prepare(
    `SELECT r.name AS roundName, l.name AS leagueTitle, r.round_number AS roundNumber
       FROM rounds r JOIN seasons s ON s.id = r.season_id JOIN leagues l ON l.id = s.league_id
      WHERE r.id = ?`,
  ).get(roundId) as { roundName: string; leagueTitle: string; roundNumber: number | null } | undefined;
  // The cover stamps "R<n>"; falling back to the internal round id keeps the
  // stamp truthful-looking rather than blank for a round with no number set.
  return row
    ? { ...row, roundNumber: row.roundNumber ?? roundId }
    : { roundName: `Round ${roundId}`, leagueTitle: 'Music League', roundNumber: roundId };
}
