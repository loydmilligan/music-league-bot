/**
 * Digest-prep checks — shared logic, mirrors the inline implementation in
 * `routes/api/digest/[roundId]/prepare/+server.ts`. Lifted here so the new
 * import-export-zip endpoint (sprint-11 Task A) can return a fresh checks
 * payload in the same round-trip without dragging the prepare endpoint
 * into its territory.
 *
 * If the prepare endpoint ever drifts in scope, reconcile here too.
 */
import type Database from 'better-sqlite3';

export interface CheckResult {
  name: string;
  ok: boolean;
  src: string;
  count?: number;
  optional?: boolean;
}

interface RoundRow {
  id: number;
  name: string;
  description: string | null;
  submission_deadline: string | null;
  voting_deadline: string | null;
}

export function runPrepChecks(db: Database.Database, roundId: number): CheckResult[] {
  const round = db
    .prepare(
      `SELECT id, name, description, submission_deadline, voting_deadline
       FROM rounds WHERE id = ?`,
    )
    .get(roundId) as RoundRow | undefined;

  if (!round) {
    return [
      { name: 'Round metadata', ok: false, src: `export.zip · round ${roundId}` },
      { name: 'Submissions', ok: false, src: `export.zip · round ${roundId}` },
      { name: 'Votes', ok: false, src: `export.zip · round ${roundId}` },
      { name: 'Vote comments', ok: false, src: `export.zip · round ${roundId}` },
      { name: 'Chat-window mentions', ok: false, src: 'watcher · —' },
      { name: 'Album art', ok: false, src: 'spotify api' },
    ];
  }

  const roundSrc = `export.zip · ${round.name}`;

  const meta_ok = !!round.description;

  const subs_count = (db
    .prepare('SELECT COUNT(*) AS n FROM ml_submissions WHERE round_id = ?')
    .get(roundId) as { n: number }).n;

  const votes_count = (db
    .prepare('SELECT COUNT(*) AS n FROM votes WHERE round_id = ?')
    .get(roundId) as { n: number }).n;

  const comments_count = (db
    .prepare(
      `SELECT COUNT(*) AS n FROM votes
       WHERE round_id = ? AND comment IS NOT NULL AND TRIM(comment) <> ''`,
    )
    .get(roundId) as { n: number }).n;

  const mentionRow = db
    .prepare(
      `SELECT COUNT(*) AS n,
              MIN(m.captured_at) AS min_at,
              MAX(m.captured_at) AS max_at
       FROM chat_mentions m
       JOIN chat_assignments a ON a.chat_song_id = m.song_id
       WHERE a.round_id = ?`,
    )
    .get(roundId) as { n: number; min_at: string | null; max_at: string | null };
  const mentions_count = mentionRow.n;
  const dateRange =
    mentionRow.min_at && mentionRow.max_at
      ? `${mentionRow.min_at.slice(0, 10)} → ${mentionRow.max_at.slice(0, 10)}`
      : '—';

  const artOk = subs_count > 0;

  return [
    { name: 'Round metadata', ok: meta_ok, src: roundSrc },
    { name: 'Submissions', ok: subs_count > 0, src: roundSrc, count: subs_count },
    { name: 'Votes', ok: votes_count > 0, src: roundSrc, count: votes_count },
    { name: 'Vote comments', ok: comments_count > 0, src: roundSrc, count: comments_count },
    {
      name: 'Chat-window mentions',
      ok: mentions_count > 0,
      src: `watcher · ${dateRange}`,
      count: mentions_count,
      optional: true,
    },
    { name: 'Album art', ok: artOk, src: 'spotify api', count: subs_count },
  ];
}
