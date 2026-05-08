import Database from 'better-sqlite3';

export function openDb(path: string): Database.Database {
  const db = new Database(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS submissions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      submitter_id  TEXT    NOT NULL,
      submitter_name TEXT   NOT NULL,
      raw_text      TEXT    NOT NULL,
      track_title   TEXT,
      track_artist  TEXT,
      spotify_uri   TEXT,
      playlist_id   TEXT,
      playlist_name TEXT,
      status        TEXT    NOT NULL,
      created_at    INTEGER NOT NULL
    )
  `);
  try { db.exec(`ALTER TABLE submissions ADD COLUMN source_platform TEXT`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE submissions ADD COLUMN source_url TEXT`); } catch { /* already exists */ }
  return db;
}
