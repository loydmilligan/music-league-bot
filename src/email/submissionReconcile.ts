import type Database from 'better-sqlite3';

const TRIGGER_URL = process.env.ML_AUTH_TRIGGER_URL ?? 'http://localhost:7679';
const TIMEOUT_MS = 60_000;

export interface ReconcileResult {
  checked: boolean;
  reason: string;
  submitted?: number;
  waiting?: number;
  missedEmails?: string[];
}

/**
 * Reconcile who actually submitted, at a phase change.
 *
 * WHY: the "User Submitted" notification emails are lossy. Matt never gets one
 * for his own activity, and Music League dropped Darren Paletz on R148/R149/R153
 * despite him submitting every time. "No email" therefore proves nothing -- and
 * the distinction matters, because a player who skips a round is out of it
 * entirely and must not be offerable as a guess.
 *
 * ACCOUNTING GUARD: once the playlist exists we know the submitter count (one
 * song per person in these leagues). Matt never emails about himself, so full
 * coverage is emailers >= songs - 1. When that holds, every other submitter is
 * already accounted for and the network call would tell us nothing -- skip it.
 *
 * The CLI runs host-side via the ml-auth-trigger daemon: this container has
 * neither the CLI nor the session cookies. The call returns user ids only, never
 * song ownership, so it is safe while a guessing round is live.
 */
export async function maybeReconcileSubmissions(
  db: Database.Database,
  roundId: number,
): Promise<ReconcileResult> {
  const songs = (db.prepare('SELECT COUNT(*) n FROM ml_submissions WHERE round_id = ?').get(roundId) as { n: number }).n;
  const emailers = (
    db.prepare('SELECT COUNT(DISTINCT submitter_name) n FROM submission_events WHERE round_id = ?').get(roundId) as { n: number }
  ).n;
  if (songs > 0 && emailers >= songs - 1) {
    return { checked: false, reason: `all ${songs - 1} other submitters accounted for` };
  }

  const ids = db
    .prepare(
      `SELECT r.ml_round_id AS mlRoundId, se.source_competition_id AS mlLeagueId
         FROM rounds r JOIN seasons se ON se.id = r.season_id
        WHERE r.id = ?`,
    )
    .get(roundId) as { mlRoundId: string | null; mlLeagueId: string | null } | undefined;
  if (!ids?.mlRoundId || !ids?.mlLeagueId) {
    return { checked: false, reason: 'round has no Music League ids' };
  }

  let payload: { ok?: boolean; done?: string[]; waiting?: string[]; reason?: string };
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${TRIGGER_URL}/submission-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mlLeagueId: ids.mlLeagueId, mlRoundId: ids.mlRoundId }),
        signal: ac.signal,
      });
      payload = (await res.json()) as typeof payload;
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    // A failed reconcile must never break email ingestion.
    return { checked: false, reason: `trigger unreachable: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!payload?.ok) return { checked: false, reason: payload?.reason ?? 'trigger returned not-ok' };

  const byMlId = new Map(
    (db.prepare('SELECT id, ml_competitor_id AS ml, name FROM competitors').all() as
      { id: number; ml: string | null; name: string }[])
      .filter((c) => c.ml)
      .map((c) => [c.ml as string, c]),
  );
  const now = new Date().toISOString();
  const upsert = db.prepare(
    `INSERT INTO round_submission_status (round_id, competitor_id, submitted, checked_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(round_id, competitor_id) DO UPDATE SET
       submitted = excluded.submitted, checked_at = excluded.checked_at`,
  );
  const done: { id: number; name: string }[] = [];
  const waiting: { id: number; name: string }[] = [];
  db.transaction(() => {
    for (const uid of payload.done ?? []) {
      const c = byMlId.get(uid);
      if (c) { upsert.run(roundId, c.id, 1, now); done.push(c); }
    }
    for (const uid of payload.waiting ?? []) {
      const c = byMlId.get(uid);
      if (c) { upsert.run(roundId, c.id, 0, now); waiting.push(c); }
    }
  })();

  const emailed = new Set(
    (db.prepare('SELECT DISTINCT submitter_name AS n FROM submission_events WHERE round_id = ?').all(roundId) as { n: string }[])
      .map((x) => x.n),
  );
  const missedEmails = done.filter((c) => !emailed.has(c.name)).map((c) => c.name);
  return { checked: true, reason: 'reconciled', submitted: done.length, waiting: waiting.length, missedEmails };
}
