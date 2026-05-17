import Database from 'better-sqlite3';
import { SCHEMA, DEFAULT_SETTINGS } from './schema.js';

let _db: Database.Database | null = null;

export function openLeagueDb(path?: string): Database.Database {
	const dbPath = path ?? `${process.env.DATA_DIR ?? 'data'}/league.db`;
	const db = new Database(dbPath);
	db.pragma('journal_mode = WAL');
	db.pragma('foreign_keys = ON');
	db.exec(SCHEMA);
	// Lightweight in-place migration: add columns missing from older DBs.
	// CREATE TABLE IF NOT EXISTS only creates fresh tables, so existing DBs
	// need an explicit ALTER. This stays cheap (one PRAGMA per boot).
	const researchCols = db.prepare("PRAGMA table_info(research_songs)").all() as { name: string }[];
	if (!researchCols.some(c => c.name === 'status')) {
		db.exec("ALTER TABLE research_songs ADD COLUMN status TEXT NOT NULL DEFAULT 'reviewing'");
	}
	// Relax ml_submissions.competitor_id NOT NULL → nullable so anonymous
	// playlist-ingest rows (sprint-5 D2) can use competitor_id IS NULL.
	// SQLite has no ALTER COLUMN; one-time table rebuild preserving every row.
	const msCols = db.prepare("PRAGMA table_info(ml_submissions)").all() as { name: string; notnull: number }[];
	const competitorCol = msCols.find(c => c.name === 'competitor_id');
	if (competitorCol && competitorCol.notnull === 1) {
		db.exec(`
			PRAGMA foreign_keys = OFF;
			BEGIN;
			CREATE TABLE ml_submissions__new (
				id INTEGER PRIMARY KEY,
				round_id INTEGER NOT NULL REFERENCES rounds(id),
				competitor_id INTEGER REFERENCES competitors(id),
				spotify_uri TEXT NOT NULL,
				title TEXT NOT NULL, album TEXT, artists TEXT NOT NULL,
				comment TEXT, created_at TEXT NOT NULL,
				visible_to_voters INTEGER NOT NULL DEFAULT 0,
				UNIQUE(round_id, spotify_uri, competitor_id)
			);
			INSERT INTO ml_submissions__new SELECT * FROM ml_submissions;
			DROP TABLE ml_submissions;
			ALTER TABLE ml_submissions__new RENAME TO ml_submissions;
			CREATE UNIQUE INDEX IF NOT EXISTS idx_ml_submissions_anon
				ON ml_submissions(round_id, spotify_uri) WHERE competitor_id IS NULL;
			COMMIT;
			PRAGMA foreign_keys = ON;
		`);
	}
	const upsert = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
	for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) upsert.run(k, v);
	return db;
}

export function getDb(): Database.Database {
	if (!_db) _db = openLeagueDb();
	return _db;
}
