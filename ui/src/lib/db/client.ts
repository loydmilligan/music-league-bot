import Database from 'better-sqlite3';
import { SCHEMA, DEFAULT_SETTINGS } from './schema.js';
import { seedThemeTags } from './themeTags.js';
import { getRoundPhasesForSeason } from '../lifecycle.js';
import { DEFAULT_PIPELINE, ARCHIVE_DEFAULT_PIPELINE } from '../digest/pipeline.js';

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
	const draftCols = db.prepare("PRAGMA table_info(digest_drafts)").all() as { name: string }[];
	if (draftCols.length && !draftCols.some(c => c.name === 'archive_context')) {
		db.exec("ALTER TABLE digest_drafts ADD COLUMN archive_context TEXT");
	}
	// sprint-25 next-round-edit: persist exclude flag + theme/deadline overrides on the draft.
	if (digestDraftCols.length && !digestDraftCols.some(c => c.name === 'next_round_excluded')) {
		db.exec("ALTER TABLE digest_drafts ADD COLUMN next_round_excluded INTEGER NOT NULL DEFAULT 0");
	}
	if (digestDraftCols.length && !digestDraftCols.some(c => c.name === 'next_round_theme_override')) {
		db.exec("ALTER TABLE digest_drafts ADD COLUMN next_round_theme_override TEXT");
	}
	if (digestDraftCols.length && !digestDraftCols.some(c => c.name === 'next_round_sub_deadline_override')) {
		db.exec("ALTER TABLE digest_drafts ADD COLUMN next_round_sub_deadline_override TEXT");
	}
	if (digestDraftCols.length && !digestDraftCols.some(c => c.name === 'next_round_vote_deadline_override')) {
		db.exec("ALTER TABLE digest_drafts ADD COLUMN next_round_vote_deadline_override TEXT");
	}
	// sprint-15 podium-thumbnails: per-song album art cached on ml_submissions.
	const msArtCols = db.prepare("PRAGMA table_info(ml_submissions)").all() as { name: string }[];
	if (msArtCols.length && !msArtCols.some(c => c.name === 'album_art_url')) {
		db.exec("ALTER TABLE ml_submissions ADD COLUMN album_art_url TEXT");
	}
	// sprint-26 season-override-fix: status_source guards manual flips from being
	// clobbered by re-imports. Default 'derived' preserves existing rows' behavior.
	const seasonCols = db.prepare("PRAGMA table_info(seasons)").all() as { name: string }[];
	if (seasonCols.length && !seasonCols.some(c => c.name === 'status_source')) {
		db.exec("ALTER TABLE seasons ADD COLUMN status_source TEXT NOT NULL CHECK(status_source IN ('derived','manual')) DEFAULT 'derived'");
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
	// sprint-39 llm_calls view: UNION over llm_cost_log (digest) + prediction_runs (predict/archive).
	// All /api/cost/* endpoints query this view, never either base table directly.
	// DROP + CREATE each boot to pick up column additions without a migration step.
	db.exec(`
		DROP VIEW IF EXISTS llm_calls;
		CREATE VIEW llm_calls AS
			SELECT
				created_at, model, category, label, cost_usd, latency_ms,
				prompt_tokens, completion_tokens
			FROM llm_cost_log
		UNION ALL
			SELECT
				created_at, model,
				COALESCE(category, 'predict') AS category,
				COALESCE(label, 'predict:unknown') AS label,
				cost_usd, latency_ms,
				COALESCE(prompt_tokens, 0) AS prompt_tokens,
				COALESCE(completion_tokens, 0) AS completion_tokens
			FROM prediction_runs
			WHERE cost_usd IS NOT NULL
	`);

	const upsert = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
	for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) upsert.run(k, v);
	// sprint-43 pipeline: seed the default pipeline config on first boot.
	upsert.run('pipeline_config', JSON.stringify(DEFAULT_PIPELINE));
	// sprint-46 archive pipeline: seed the archive pipeline config on first boot.
	upsert.run('pipeline_config_archive', JSON.stringify(ARCHIVE_DEFAULT_PIPELINE));
	// sprint-22 theme-tags: seed the category taxonomy + starter vocabulary
	// (idempotent INSERT OR IGNORE — safe to run every boot).
	seedThemeTags(db);
	// sprint-25 player management: create players + season_players tables on first
	// boot (and any existing DB that lacks them).
	const tableNames = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(r => r.name);
	if (!tableNames.includes('players')) {
		db.exec(`
			CREATE TABLE IF NOT EXISTS players (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				name TEXT NOT NULL,
				chat_type TEXT CHECK(chat_type IN ('whatsapp','google-chat')),
				chat_identifier TEXT,
				ml_competitor_id TEXT,
				created_at TEXT DEFAULT (datetime('now'))
			);
		`);
	}
	if (!tableNames.includes('season_players')) {
		db.exec(`
			CREATE TABLE IF NOT EXISTS season_players (
				season_id INTEGER NOT NULL REFERENCES seasons(id),
				player_id INTEGER NOT NULL REFERENCES players(id),
				joined_at TEXT DEFAULT (datetime('now')),
				PRIMARY KEY (season_id, player_id)
			);
		`);
	}
	// sprint-25 player identities: one-to-many identities per player, optionally
	// scoped to a league. Migrates existing chat_type+chat_identifier data.
	if (!tableNames.includes('player_identities')) {
		db.exec(`
			CREATE TABLE IF NOT EXISTS player_identities (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
				league_id INTEGER REFERENCES leagues(id) ON DELETE SET NULL,
				identity_type TEXT NOT NULL CHECK(identity_type IN ('whatsapp','google-chat','music-league')),
				identifier TEXT NOT NULL,
				created_at TEXT DEFAULT (datetime('now'))
			);
			INSERT OR IGNORE INTO player_identities (player_id, league_id, identity_type, identifier)
				SELECT id, NULL, chat_type, chat_identifier
				FROM players
				WHERE chat_type IS NOT NULL AND chat_identifier IS NOT NULL;
		`);
	}
	// sprint-25 player age + relationships.
	const playerCols = db.prepare("PRAGMA table_info(players)").all() as { name: string }[];
	if (playerCols.length && !playerCols.some(c => c.name === 'age')) {
		db.exec("ALTER TABLE players ADD COLUMN age INTEGER");
	}
	if (!tableNames.includes('player_relationships')) {
		db.exec(`
			CREATE TABLE IF NOT EXISTS player_relationships (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
				related_player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
				relationship_type TEXT NOT NULL,
				relationship_note TEXT,
				created_at TEXT DEFAULT (datetime('now')),
				UNIQUE(player_id, related_player_id)
			);
		`);
	}
	// sprint-25 history-player-id: stable player identity join on competitors.
	// Placed after players table creation so the FK reference resolves.
	const competitorCols = db.prepare("PRAGMA table_info(competitors)").all() as { name: string }[];
	if (competitorCols.length && !competitorCols.some(c => c.name === 'player_id')) {
		db.exec("ALTER TABLE competitors ADD COLUMN player_id INTEGER REFERENCES players(id)");
		// Backfill: link competitors to players where ml_competitor_id matches.
		db.exec(`UPDATE competitors SET player_id = (
			SELECT players.id FROM players
			WHERE players.ml_competitor_id = competitors.ml_competitor_id
			AND competitors.ml_competitor_id IS NOT NULL
		) WHERE player_id IS NULL`);
	}
	// sprint-25 round management: tag, theme_submitted_by, round_number.
	const roundsCols2 = db.prepare("PRAGMA table_info(rounds)").all() as { name: string }[];
	if (roundsCols2.length && !roundsCols2.some(c => c.name === 'tag')) {
		db.exec("ALTER TABLE rounds ADD COLUMN tag TEXT");
	}
	if (roundsCols2.length && !roundsCols2.some(c => c.name === 'theme_submitted_by')) {
		db.exec("ALTER TABLE rounds ADD COLUMN theme_submitted_by INTEGER REFERENCES players(id) ON DELETE SET NULL");
	}
	if (roundsCols2.length && !roundsCols2.some(c => c.name === 'round_number')) {
		db.exec("ALTER TABLE rounds ADD COLUMN round_number INTEGER");
	}
	// sprint-25 fk-migration: add player_id FK columns to gameplay tables so they
	// can reference players directly (rename-proof identity, non-ML league support).
	// Additive alongside existing competitor_id FKs — no data loss. Backfill from
	// competitors.player_id where the competitor→player link has been established
	// via the setup screen. All NULL on first boot (mapping built lazily by admin).
	const msCols2 = db.prepare("PRAGMA table_info(ml_submissions)").all() as { name: string }[];
	if (msCols2.length && !msCols2.some(c => c.name === 'player_id')) {
		db.exec("ALTER TABLE ml_submissions ADD COLUMN player_id INTEGER REFERENCES players(id)");
		db.exec(`UPDATE ml_submissions SET player_id = (
			SELECT c.player_id FROM competitors c WHERE c.id = ml_submissions.competitor_id
		) WHERE competitor_id IS NOT NULL AND player_id IS NULL`);
	}
	const votesCols = db.prepare("PRAGMA table_info(votes)").all() as { name: string }[];
	if (votesCols.length && !votesCols.some(c => c.name === 'player_id')) {
		db.exec("ALTER TABLE votes ADD COLUMN player_id INTEGER REFERENCES players(id)");
		db.exec(`UPDATE votes SET player_id = (
			SELECT c.player_id FROM competitors c WHERE c.id = votes.voter_id
		) WHERE player_id IS NULL`);
	}
	const ssCols = db.prepare("PRAGMA table_info(season_standings)").all() as { name: string }[];
	if (ssCols.length && !ssCols.some(c => c.name === 'player_id')) {
		db.exec("ALTER TABLE season_standings ADD COLUMN player_id INTEGER REFERENCES players(id)");
		db.exec(`UPDATE season_standings SET player_id = (
			SELECT c.player_id FROM competitors c WHERE c.id = season_standings.competitor_id
		) WHERE player_id IS NULL`);
	}
	// rounds.theme_submitted_by (already added in Wave 3) targets players(id).
	// Backfill from theme_chooser_id→competitors.player_id where unlinked and
	// theme_chooser_id is set (currently 0 rows on prod; future-proof).
	const roundsCols3 = db.prepare("PRAGMA table_info(rounds)").all() as { name: string }[];
	if (roundsCols3.length && roundsCols3.some(c => c.name === 'theme_submitted_by')) {
		db.exec(`UPDATE rounds SET theme_submitted_by = (
			SELECT c.player_id FROM competitors c WHERE c.id = rounds.theme_chooser_id
		) WHERE theme_chooser_id IS NOT NULL AND theme_submitted_by IS NULL`);
	}
	// sprint-27 round-edit-markers (FB-1): tracks which fields were manually edited
	// via patchRound/updateRound so upsertRound (importer) skips overwriting them.
	const roundsCols4 = db.prepare("PRAGMA table_info(rounds)").all() as { name: string }[];
	if (roundsCols4.length && !roundsCols4.some(c => c.name === 'edited_fields')) {
		db.exec("ALTER TABLE rounds ADD COLUMN edited_fields TEXT NOT NULL DEFAULT '[]'");
	}
	// sprint-28 player dossier: 1:1 profile row per player (notes, tags, AI fingerprint).
	// Manual fields (notes/tags) and AI fields (fingerprint_*) are separate columns so
	// regenerating a fingerprint never overwrites owner-authored content.
	if (!tableNames.includes('player_profiles')) {
		db.exec(`
			CREATE TABLE IF NOT EXISTS player_profiles (
				player_id INTEGER PRIMARY KEY REFERENCES players(id),
				notes TEXT,
				tags TEXT NOT NULL DEFAULT '[]',
				taste_fingerprint TEXT,
				fingerprint_model TEXT,
				fingerprint_cost_usd REAL,
				fingerprint_generated_at TEXT,
				updated_at TEXT
			);
		`);
	}
	// sprint-28 prediction audit log: one row per LLM prediction task run.
	// actual_json and score_json are reserved for Sprint 3 backtest scoring.
	if (!tableNames.includes('prediction_runs')) {
		db.exec(`
			CREATE TABLE IF NOT EXISTS prediction_runs (
				id TEXT PRIMARY KEY,
				task_id TEXT,
				player_id INTEGER,
				round_id INTEGER,
				input_json TEXT,
				output_json TEXT,
				model TEXT,
				cost_usd REAL,
				latency_ms INTEGER,
				created_at TEXT,
				actual_json TEXT,
				score_json TEXT
			);
		`);
	}
	// sprint-31 b-side read-model: public dashboard slug → read-model snapshot.
	// slug is the ≥80-bit unguessable URL token minted on first publish.
	if (!tableNames.includes('dashboard_sites')) {
		db.exec(`
			CREATE TABLE IF NOT EXISTS dashboard_sites (
				slug TEXT PRIMARY KEY,
				league_id INTEGER NOT NULL UNIQUE,
				season INTEGER NOT NULL,
				read_model TEXT NOT NULL,
				archived_rounds TEXT NOT NULL DEFAULT '[]',
				is_live INTEGER NOT NULL DEFAULT 1,
				published_at TEXT NOT NULL,
				refreshed_at TEXT NOT NULL,
				snark_level INTEGER NOT NULL DEFAULT 1
			);
		`);
	}
	// sprint-39 cost ledger: run_id on digest_drafts so regen calls can group under
	// the same run as the original draft generation.
	const draftColsFinal = db.prepare("PRAGMA table_info(digest_drafts)").all() as { name: string }[];
	if (draftColsFinal.length && !draftColsFinal.some(c => c.name === 'run_id')) {
		db.exec("ALTER TABLE digest_drafts ADD COLUMN run_id TEXT");
	}
	// sprint-39 federation: cost-attribution + passive capture columns on prediction_runs.
	// predict/archive calls federate here (do NOT write llm_cost_log rows for these).
	const predRunCols = db.prepare("PRAGMA table_info(prediction_runs)").all() as { name: string }[];
	if (predRunCols.length) {
		const addIfMissing = (col: string, def: string) => {
			if (!predRunCols.some(c => c.name === col)) db.exec(`ALTER TABLE prediction_runs ADD COLUMN ${col} ${def}`);
		};
		// cost-attribution
		addIfMissing('prompt_tokens',     'INTEGER NOT NULL DEFAULT 0');
		addIfMissing('completion_tokens', 'INTEGER NOT NULL DEFAULT 0');
		addIfMissing('total_tokens',      'INTEGER NOT NULL DEFAULT 0');
		addIfMissing('category',          'TEXT');
		addIfMissing('label',             'TEXT');
		// passive capture (same set as llm_cost_log, minus digest-only edit_distance/regen_changed)
		addIfMissing('run_id',               'TEXT');
		addIfMissing('artifact_type',        'TEXT');
		addIfMissing('artifact_id',          'TEXT');
		addIfMissing('prompt_version',       'TEXT');
		addIfMissing('output_hash',          'TEXT');
		addIfMissing('outcome',              'TEXT');
		addIfMissing('recovery_cost',        'REAL');
		addIfMissing('retry_count',          'INTEGER NOT NULL DEFAULT 0');
		addIfMissing('params',               'TEXT');
		addIfMissing('params_schema_version', 'INTEGER');
	}
	// sprint-37 S2: snark dial on dashboard_sites (additive migration for existing rows).
	const dsCols = db.prepare("PRAGMA table_info(dashboard_sites)").all() as { name: string }[];
	if (dsCols.length && !dsCols.some(c => c.name === 'snark_level')) {
		db.exec("ALTER TABLE dashboard_sites ADD COLUMN snark_level INTEGER NOT NULL DEFAULT 1");
	}
	// sprint-31 b-side: per-section LLM steering state for the operator UI.
	if (!tableNames.includes('dashboard_section_state')) {
		db.exec(`
			CREATE TABLE IF NOT EXISTS dashboard_section_state (
				league_id INTEGER NOT NULL,
				section TEXT NOT NULL,
				decision TEXT NOT NULL DEFAULT 'refresh',
				steer TEXT,
				PRIMARY KEY (league_id, section)
			);
		`);
	}
	// sprint-34 phase-schema: stored operator-controlled phase column on rounds.
	// Backfill every existing row from deadline-derived phase (getRoundPhasesForSeason),
	// mapping lifecycle's 'archive'→'complete' and 'upcoming'→'not-started'.
	// No row may be left null — the backfill runs in a single transaction.
	const roundsCols5 = db.prepare("PRAGMA table_info(rounds)").all() as { name: string }[];
	if (roundsCols5.length && !roundsCols5.some(c => c.name === 'phase')) {
		db.exec("ALTER TABLE rounds ADD COLUMN phase TEXT CHECK(phase IN ('not-started', 'submission', 'voting', 'complete'))");
		type RoundRow = { id: number; season_id: number; submission_deadline: string | null; voting_deadline: string | null };
		const allRounds = db.prepare(
			"SELECT id, season_id, submission_deadline, voting_deadline FROM rounds"
		).all() as RoundRow[];
		const bySeason = new Map<number, RoundRow[]>();
		for (const r of allRounds) {
			if (!bySeason.has(r.season_id)) bySeason.set(r.season_id, []);
			bySeason.get(r.season_id)!.push(r);
		}
		const updatePhase = db.prepare("UPDATE rounds SET phase = ? WHERE id = ?");
		const now = Date.now();
		db.transaction(() => {
			for (const [, rounds] of bySeason) {
				const phaseMap = getRoundPhasesForSeason(rounds, now);
				for (const [id, phase] of phaseMap) {
					const stored =
						phase === 'archive' ? 'complete' :
						phase === 'upcoming' ? 'not-started' : phase;
					updatePhase.run(stored, id);
				}
			}
		})();
	}
	// sprint-43 a4: cover_kind column on digest_regenerations distinguishes automatic
	// pipeline covers (cover_kind = 'pipeline_cover') from user-triggered regens (NULL).
	// Sprint-44 frontend queries: SELECT ... WHERE cover_kind = 'pipeline_cover'.
	const regenCols = db.prepare("PRAGMA table_info(digest_regenerations)").all() as { name: string }[];
	if (regenCols.length && !regenCols.some(c => c.name === 'cover_kind')) {
		db.exec("ALTER TABLE digest_regenerations ADD COLUMN cover_kind TEXT");
	}
	// sprint-queue Task 2: tags column on song_popularity for Last.fm genre tags.
	// JSON array of top-5 tag name strings. NULL until a lastfm_tags job completes.
	const songPopCols = db.prepare("PRAGMA table_info(song_popularity)").all() as { name: string }[];
	if (songPopCols.length && !songPopCols.some(c => c.name === 'tags')) {
		db.exec("ALTER TABLE song_popularity ADD COLUMN tags TEXT");
	}
	// sprint-queue Task 12: migrate pending/failed ytm_resolution_queue rows into
	// song_metadata_queue so no YTM work is lost when the old table is retired.
	// Guarded: only runs when the old table exists and has pending/failed rows.
	const oldQueueExists = (db.prepare(
		"SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='ytm_resolution_queue'"
	).get() as { n: number }).n > 0;
	if (oldQueueExists) {
		const orphans = (db.prepare(
			"SELECT COUNT(*) AS n FROM ytm_resolution_queue WHERE status IN ('pending','failed')"
		).get() as { n: number }).n;
		if (orphans > 0) {
			db.prepare(
				`INSERT OR IGNORE INTO song_metadata_queue (spotify_uri, job_type, queued_at)
				 SELECT spotify_uri, 'ytm', queued_at
				 FROM ytm_resolution_queue
				 WHERE status IN ('pending', 'failed')`
			).run();
		}
	}
	return db;
}

export function getDb(): Database.Database {
	if (!_db) _db = openLeagueDb();
	return _db;
}
