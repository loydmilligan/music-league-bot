import type Database from 'better-sqlite3';

// sprint-17 next-round-data — preview of the round after the current one in the
// same league. Null when the current round is the latest (section self-suppresses).

export interface NextRoundPreview {
  theme: string;
  themeSource: 'description' | 'name';
  submissionDeadline: string | null;
  votingDeadline: string | null;
  /** Legacy UI alias. Prefer submissionDeadline/votingDeadline in new callers. */
  deadline: string | null;
  submissionsSoFar: number;
}

export function getNextRound(db: Database.Database, roundId: number): NextRoundPreview | null {
  const cur = db.prepare(
    `SELECT r.id, r.season_id, s.league_id
     FROM rounds r
     JOIN seasons s ON s.id = r.season_id
     WHERE r.id = ?`,
  ).get(roundId) as { id: number; season_id: number; league_id: number } | undefined;
  if (!cur) return null;

  const rounds = db
    .prepare(
      `SELECT r.id, r.name, r.description, r.submission_deadline, r.voting_deadline
       FROM rounds r
       JOIN seasons s ON s.id = r.season_id
       WHERE s.league_id = ?
       ORDER BY s.season_number, r.id`,
    )
    .all(cur.league_id) as { id: number; name: string; description: string | null; submission_deadline: string | null; voting_deadline: string | null }[];

  const idx = rounds.findIndex((r) => r.id === roundId);
  if (idx < 0 || idx >= rounds.length - 1) return null; // latest round → no next

  const nx = rounds[idx + 1];
  const description = nx.description?.trim() ?? '';
  const name = nx.name?.trim() ?? '';
  const themeSource: NextRoundPreview['themeSource'] = description ? 'description' : 'name';
  const submissionsSoFar = (db
    .prepare('SELECT COUNT(*) AS n FROM ml_submissions WHERE round_id = ?')
    .get(nx.id) as { n: number }).n;

  return {
    theme: description || name || `Round ${idx + 2}`,
    themeSource,
    submissionDeadline: nx.submission_deadline ?? null,
    votingDeadline: nx.voting_deadline ?? null,
    deadline: nx.submission_deadline ?? null,
    submissionsSoFar,
  };
}
