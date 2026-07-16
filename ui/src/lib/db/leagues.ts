import type Database from 'better-sqlite3';
import type { League, Season } from '../types.js';
import { getCurrentRoundForSeason } from './rounds.js';

const SEED = [
  { slug: 'hip-jammers',  name: 'Hip Jammers',  exclude: 0 },
  { slug: 'fam-jam',      name: 'Fam-Jam',      exclude: 0 },
  { slug: 'second-best',  name: 'Second Best',  exclude: 0 },
  { slug: 'nostalgia-pit',name: 'Nostalgia Pit',exclude: 1 },
  { slug: 'boarz-ii-men', name: 'Boarz II Men', exclude: 0 },
];

export function seedLeagues(db: Database.Database): void {
  const stmt = db.prepare(`INSERT INTO leagues (slug,name,exclude_from_combined) VALUES (@slug,@name,@exclude)
    ON CONFLICT(slug) DO UPDATE SET name=excluded.name`);
  for (const l of SEED) stmt.run(l);
}

export function getAllLeagues(db: Database.Database): League[] {
  return (db.prepare('SELECT * FROM leagues ORDER BY id').all() as any[]).map(r => ({
    id: r.id, slug: r.slug, name: r.name, excludeFromCombined: !!r.exclude_from_combined, notes: r.notes,
  }));
}

export function getLeagueBySlug(db: Database.Database, slug: string): League | null {
  const r = db.prepare('SELECT * FROM leagues WHERE slug=?').get(slug) as any;
  return r ? { id: r.id, slug: r.slug, name: r.name, excludeFromCombined: !!r.exclude_from_combined, notes: r.notes } : null;
}

export function getSeasonsForLeague(db: Database.Database, leagueId: number): Season[] {
  return (db.prepare('SELECT * FROM seasons WHERE league_id=? ORDER BY season_number').all(leagueId) as any[])
    .map(r => ({ id: r.id, leagueId: r.league_id, seasonNumber: r.season_number, status: r.status }));
}

export function getActiveSeasonsWithLeague(db: Database.Database): Array<Season & { league: League }> {
  const rows = db.prepare(`SELECT s.*,l.slug league_slug,l.name league_name,l.exclude_from_combined
    FROM seasons s JOIN leagues l ON s.league_id=l.id
    ORDER BY l.id,s.season_number`).all() as any[];
  return rows
    .filter(r => {
      const current = getCurrentRoundForSeason(db, r.id);
      return r.status === 'active' || (!!current && current.phase !== 'archive');
    })
    .map(r => ({
      id: r.id, leagueId: r.league_id, seasonNumber: r.season_number, status: r.status,
      league: { id: r.league_id, slug: r.league_slug, name: r.league_name, excludeFromCombined: !!r.exclude_from_combined, notes: null },
    }));
}

export function upsertSeason(db: Database.Database, leagueId: number, seasonNumber: number, status: 'active'|'complete'): number {
  // Preserve status for manually-overridden seasons — import-path callers must not
  // clobber admin flips. A season with status_source='manual' keeps its current
  // status regardless of what the importer derived.
  return (db.prepare(`INSERT INTO seasons (league_id,season_number,status,status_source) VALUES (?,?,?,'derived')
    ON CONFLICT(league_id,season_number) DO UPDATE SET
      status = CASE WHEN seasons.status_source = 'manual' THEN seasons.status ELSE excluded.status END
    RETURNING id`)
    .get(leagueId, seasonNumber, status) as { id: number }).id;
}

export function setSeasonStatus(db: Database.Database, seasonId: number, status: 'active'|'complete'): boolean {
  const info = db.prepare("UPDATE seasons SET status = ?, status_source = 'manual' WHERE id = ?").run(status, seasonId);
  return info.changes > 0;
}
