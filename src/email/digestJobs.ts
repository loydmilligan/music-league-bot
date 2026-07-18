import type Database from 'better-sqlite3';

// DDL mirrored verbatim from ui/src/lib/digest/jobsSchema.ts (no shared imports
// across the src/ and ui/ projects). Keep the two in sync.
const DIGEST_JOBS_DDL = `
  CREATE TABLE IF NOT EXISTS digest_jobs (
    round_id       INTEGER PRIMARY KEY,
    league_id      INTEGER NOT NULL,
    status         TEXT NOT NULL,
    gen_params     TEXT,
    error          TEXT,
    approval_token TEXT,
    decision       TEXT,
    decided_at     TEXT,
    review_url     TEXT,
    attempts       INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
  );
`;

export function enqueueDigestJob(db: Database.Database, roundId: number, leagueId: number, nowIso: string): void {
  db.exec(DIGEST_JOBS_DDL);
  db.prepare(
    `INSERT OR IGNORE INTO digest_jobs (round_id, league_id, status, created_at, updated_at)
     VALUES (?, ?, 'pending', ?, ?)`,
  ).run(roundId, leagueId, nowIso, nowIso);
}
