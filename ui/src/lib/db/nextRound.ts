import type Database from 'better-sqlite3';

// sprint-17 next-round-data — preview of the round after the current one in the
// same season. Null when the current round is the latest (section self-suppresses).

export interface NextRoundPreview {
  theme: string;
  deadline: string | null;
  submissionsSoFar: number;
}

export function getNextRound(db: Database.Database, roundId: number): NextRoundPreview | null {
  const cur = db.prepare('SELECT season_id FROM rounds WHERE id = ?').get(roundId) as { season_id: number } | undefined;
  if (!cur) return null;

  const rounds = db
    .prepare('SELECT id, name, description, submission_deadline, voting_deadline FROM rounds WHERE season_id = ? ORDER BY id')
    .all(cur.season_id) as { id: number; name: string; description: string | null; submission_deadline: string | null; voting_deadline: string | null }[];

  const idx = rounds.findIndex((r) => r.id === roundId);
  if (idx < 0 || idx >= rounds.length - 1) return null; // latest round → no next

  const nx = rounds[idx + 1];
  const submissionsSoFar = (db
    .prepare('SELECT COUNT(*) AS n FROM ml_submissions WHERE round_id = ?')
    .get(nx.id) as { n: number }).n;

  return {
    theme: nx.name?.trim() || nx.description?.trim() || `Round ${idx + 2}`,
    deadline: nx.submission_deadline ?? nx.voting_deadline ?? null,
    submissionsSoFar,
  };
}
