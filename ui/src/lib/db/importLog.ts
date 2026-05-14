import type Database from 'better-sqlite3';
import type { ImportLogEntry } from '../types.js';

export function logImport(db: Database.Database, e: Omit<ImportLogEntry,'id'>): void {
  db.prepare(`INSERT INTO import_log (league_slug,season_number,filename,imported_at,rounds_count,submissions_count,votes_count,status,error)
    VALUES (@leagueSlug,@seasonNumber,@filename,@importedAt,@roundsCount,@submissionsCount,@votesCount,@status,@error)`).run(e);
}

export function getImportLog(db: Database.Database): ImportLogEntry[] {
  return (db.prepare('SELECT * FROM import_log ORDER BY imported_at DESC LIMIT 100').all() as any[]).map(r => ({
    id: r.id, leagueSlug: r.league_slug, seasonNumber: r.season_number, filename: r.filename,
    importedAt: r.imported_at, roundsCount: r.rounds_count, submissionsCount: r.submissions_count,
    votesCount: r.votes_count, status: r.status, error: r.error,
  }));
}
