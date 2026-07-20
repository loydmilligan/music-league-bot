/**
 * DB-backed resolution of a season's upstream (source) competition id.
 * Single source of truth for the .mjs ML scripts, replacing hardcoded pin maps.
 */
export function resolveSourceCompetition(db, slug, seasonNumber) {
  const row = db.prepare(`SELECT s.source AS source, s.source_competition_id AS sid
    FROM seasons s JOIN leagues l ON l.id = s.league_id
    WHERE l.slug = ? AND s.season_number = ?`).get(slug, seasonNumber);
  if (!row || !row.sid) return null;
  return { source: row.source ?? 'music_league', sourceCompetitionId: row.sid };
}

export function resolveActiveSourceCompetition(db, slug) {
  const row = db.prepare(`SELECT s.season_number AS n, s.source AS source, s.source_competition_id AS sid
    FROM seasons s JOIN leagues l ON l.id = s.league_id
    WHERE l.slug = ? AND s.status = 'active' AND s.source_competition_id IS NOT NULL
    ORDER BY s.season_number DESC LIMIT 1`).get(slug);
  if (!row) return null;
  return { source: row.source ?? 'music_league', sourceCompetitionId: row.sid, seasonNumber: row.n };
}
