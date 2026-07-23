import type Database from 'better-sqlite3';
import type { Exposure, ExposurePlayer } from './types.js';

export function resolveOwnerCompetitorId(db: Database.Database, ownerName: string): number | null {
  const row = db.prepare('SELECT id FROM competitors WHERE name = ?').get(ownerName) as { id: number } | undefined;
  return row?.id ?? null;
}

export function ownerExposure(
  db: Database.Database, ownerCompetitorId: number, matchedRoundIds: number[], targetLeagueId: number,
): Exposure[] {
  if (matchedRoundIds.length === 0) return [];
  const owner = db.prepare('SELECT player_id FROM competitors WHERE id = ?').get(ownerCompetitorId) as { player_id: number } | undefined;
  const ownerPlayerId = owner?.player_id ?? -1;

  // Players in the target league (any of its seasons).
  const targetRoster = new Set(
    (db.prepare(`
      SELECT DISTINCT sp.player_id AS pid FROM season_players sp
      JOIN seasons s ON s.id = sp.season_id WHERE s.league_id = ?
    `).all(targetLeagueId) as Array<{ pid: number }>).map((r) => r.pid),
  );

  const placeholders = matchedRoundIds.map(() => '?').join(',');
  const subs = db.prepare(`
    SELECT ms.id AS sid, ms.round_id AS rid, ms.title, ms.artists AS artist
    FROM ml_submissions ms
    WHERE ms.competitor_id = ? AND ms.round_id IN (${placeholders})
  `).all(ownerCompetitorId, ...matchedRoundIds) as Array<{ sid: number; rid: number; title: string; artist: string }>;

  return subs.map((s) => {
    // Who saw this submission = players in the round's season, minus the owner,
    // intersected with the target roster.
    const seen = db.prepare(`
      SELECT DISTINCT p.id AS pid, p.name
      FROM rounds r
      JOIN season_players sp ON sp.season_id = r.season_id
      JOIN players p ON p.id = sp.player_id
      WHERE r.id = ? AND p.id <> ?
    `).all(s.rid, ownerPlayerId) as Array<{ pid: number; name: string }>;
    const seenBy: ExposurePlayer[] = seen
      .filter((p) => targetRoster.has(p.pid))
      .map((p) => ({ playerId: p.pid, name: p.name }));
    return { submissionId: s.sid, roundId: s.rid, title: s.title, artist: s.artist, seenBy, recognizable: seenBy.length > 0 };
  });
}
