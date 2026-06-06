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
	const roundsCols = db.prepare("PRAGMA table_info(rounds)").all() as { name: string }[];
	if (!roundsCols.some(c => c.name === 'theme_chooser_id')) {
		db.exec("ALTER TABLE rounds ADD COLUMN theme_chooser_id INTEGER REFERENCES competitors(id)");
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
	const relCtxCols = db.prepare("PRAGMA table_info(relationship_contexts)").all() as { name: string }[];
	if (relCtxCols.length && !relCtxCols.some(c => c.name === 'previous_text')) {
		db.exec("ALTER TABLE relationship_contexts ADD COLUMN previous_text TEXT");
	}
	if (relCtxCols.length && !relCtxCols.some(c => c.name === 'previous_updated_at')) {
		db.exec("ALTER TABLE relationship_contexts ADD COLUMN previous_updated_at TEXT");
	}
	// sprint-14 variant-system: per-section layout variant on existing DBs.
	const digestSectionCols = db.prepare("PRAGMA table_info(digest_sections)").all() as { name: string }[];
	if (digestSectionCols.length && !digestSectionCols.some(c => c.name === 'variant')) {
		db.exec("ALTER TABLE digest_sections ADD COLUMN variant TEXT NOT NULL DEFAULT 'textual'");
	}
	// sprint-15 cost-capture: per-digest accumulated OpenRouter cost on existing DBs.
	const digestDraftCols = db.prepare("PRAGMA table_info(digest_drafts)").all() as { name: string }[];
	if (digestDraftCols.length && !digestDraftCols.some(c => c.name === 'llm_cost_usd')) {
		db.exec("ALTER TABLE digest_drafts ADD COLUMN llm_cost_usd REAL NOT NULL DEFAULT 0");
	}
	// sprint-21 season-recap: persist recap mode + final/mid framing on existing DBs.
	if (digestDraftCols.length && !digestDraftCols.some(c => c.name === 'recap_enabled')) {
		db.exec("ALTER TABLE digest_drafts ADD COLUMN recap_enabled INTEGER NOT NULL DEFAULT 0");
	}
	if (digestDraftCols.length && !digestDraftCols.some(c => c.name === 'recap_final')) {
		db.exec("ALTER TABLE digest_drafts ADD COLUMN recap_final INTEGER NOT NULL DEFAULT 1");
	}
	// sprint-15 podium-thumbnails: per-song album art cached on ml_submissions.
	const msArtCols = db.prepare("PRAGMA table_info(ml_submissions)").all() as { name: string }[];
	if (msArtCols.length && !msArtCols.some(c => c.name === 'album_art_url')) {
		db.exec("ALTER TABLE ml_submissions ADD COLUMN album_art_url TEXT");
	}
	// sprint-22 active-round mgmt: per-league active flag + active-round slot on
	// existing DBs. Backfill is_active=1 for leagues that already have an active
	// season so prod leagues come up "active" without a manual pass.
	const leagueCols = db.prepare("PRAGMA table_info(leagues)").all() as { name: string }[];
	if (leagueCols.length && !leagueCols.some(c => c.name === 'is_active')) {
		db.exec("ALTER TABLE leagues ADD COLUMN is_active INTEGER NOT NULL DEFAULT 0");
		db.exec("UPDATE leagues SET is_active = 1 WHERE id IN (SELECT DISTINCT league_id FROM seasons WHERE status = 'active')");
	}
	if (leagueCols.length && !leagueCols.some(c => c.name === 'active_round_id')) {
		db.exec("ALTER TABLE leagues ADD COLUMN active_round_id INTEGER REFERENCES rounds(id)");
	}
	const upsert = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
	for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) upsert.run(k, v);
	return db;
}

export function getDb(): Database.Database {
	if (!_db) _db = openLeagueDb();
	return _db;
}
