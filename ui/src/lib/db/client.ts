import Database from 'better-sqlite3';
import { SCHEMA, DEFAULT_SETTINGS } from './schema.js';

let _db: Database.Database | null = null;

export function openLeagueDb(path?: string): Database.Database {
	const dbPath = path ?? `${process.env.DATA_DIR ?? 'data'}/league.db`;
	const db = new Database(dbPath);
	db.pragma('journal_mode = WAL');
	db.pragma('foreign_keys = ON');
	db.exec(SCHEMA);
	const upsert = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
	for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) upsert.run(k, v);
	return db;
}

export function getDb(): Database.Database {
	if (!_db) _db = openLeagueDb();
	return _db;
}
