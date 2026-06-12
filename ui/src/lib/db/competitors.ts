import type Database from 'better-sqlite3';

export function setCompetitorPlayerLink(
  db: Database.Database,
  competitorId: number,
  playerId: number | null,
): boolean {
  const info = db.prepare('UPDATE competitors SET player_id = ? WHERE id = ?').run(playerId, competitorId);
  return info.changes > 0;
}

// Re-runs the deterministic gameplay backfill for a single competitor.
// Called after every link/unlink so player_id in ml_submissions, votes,
// and season_standings reflects the current competitors.player_id immediately
// — no container reboot required.
export function resyncCompetitorPlayerIds(db: Database.Database, competitorId: number): void {
  db.transaction(() => {
    const comp = db.prepare('SELECT player_id FROM competitors WHERE id = ?').get(competitorId) as
      | { player_id: number | null }
      | undefined;
    if (!comp) return;
    const playerId = comp.player_id ?? null;
    db.prepare('UPDATE ml_submissions SET player_id = ? WHERE competitor_id = ?').run(playerId, competitorId);
    db.prepare('UPDATE votes SET player_id = ? WHERE voter_id = ?').run(playerId, competitorId);
    db.prepare('UPDATE season_standings SET player_id = ? WHERE competitor_id = ?').run(playerId, competitorId);
  })();
}
