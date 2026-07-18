import type Database from 'better-sqlite3';

export function enqueueJob(db: Database.Database, roundId: number, leagueId: number, nowIso: string): boolean {
  const res = db.prepare(
    `INSERT OR IGNORE INTO digest_jobs (round_id, league_id, status, created_at, updated_at)
     VALUES (?, ?, 'pending', ?, ?)`,
  ).run(roundId, leagueId, nowIso, nowIso);
  return res.changes === 1;
}

export function claimNextJob(db: Database.Database, nowIso: string):
  { roundId: number; leagueId: number; gen_params: string | null } | null {
  const claim = db.transaction(() => {
    const row = db.prepare(
      `SELECT round_id, league_id, gen_params FROM digest_jobs
        WHERE status='pending' ORDER BY created_at LIMIT 1`,
    ).get() as { round_id: number; league_id: number; gen_params: string | null } | undefined;
    if (!row) return null;
    db.prepare(`UPDATE digest_jobs SET status='capturing', updated_at=? WHERE round_id=?`)
      .run(nowIso, row.round_id);
    return { roundId: row.round_id, leagueId: row.league_id, gen_params: row.gen_params };
  });
  return claim();
}

export function transitionJob(db: Database.Database, roundId: number, status: string, nowIso: string): void {
  db.prepare(`UPDATE digest_jobs SET status=?, updated_at=? WHERE round_id=?`).run(status, nowIso, roundId);
}

export function failJob(db: Database.Database, roundId: number, error: string, nowIso: string): void {
  db.prepare(`UPDATE digest_jobs SET status='failed', error=?, updated_at=? WHERE round_id=?`)
    .run(error, nowIso, roundId);
}

export function getJob(db: Database.Database, roundId: number): { status: string; error: string | null } | undefined {
  return db.prepare(`SELECT status, error FROM digest_jobs WHERE round_id=?`).get(roundId) as
    { status: string; error: string | null } | undefined;
}
