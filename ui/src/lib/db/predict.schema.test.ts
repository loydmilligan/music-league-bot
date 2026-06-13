import { it, expect, beforeEach, describe } from 'vitest';
import { openLeagueDb } from './client.js';
import type Database from 'better-sqlite3';

let db: Database.Database;
beforeEach(() => { db = openLeagueDb(':memory:'); });

const PLAYER_PROFILES_COLS = [
	'player_id', 'notes', 'tags', 'taste_fingerprint',
	'fingerprint_model', 'fingerprint_cost_usd', 'fingerprint_generated_at', 'updated_at',
];
const PREDICTION_RUNS_COLS = [
	'id', 'task_id', 'player_id', 'round_id', 'input_json', 'output_json',
	'model', 'cost_usd', 'latency_ms', 'created_at', 'actual_json', 'score_json',
];

describe('sprint-28 schema: player_profiles', () => {
	it('table exists after boot', () => {
		const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(r => r.name);
		expect(tables).toContain('player_profiles');
	});

	it('has all required columns', () => {
		const cols = (db.prepare('PRAGMA table_info(player_profiles)').all() as { name: string }[]).map(c => c.name);
		for (const col of PLAYER_PROFILES_COLS) {
			expect(cols, `missing column: ${col}`).toContain(col);
		}
	});

	it('player_id is the primary key', () => {
		const info = db.prepare('PRAGMA table_info(player_profiles)').all() as { name: string; pk: number }[];
		const pk = info.find(c => c.name === 'player_id');
		expect(pk?.pk).toBe(1);
	});

	it('tags defaults to empty JSON array', () => {
		db.exec("INSERT INTO players (name) VALUES ('tester')");
		const playerId = (db.prepare('SELECT last_insert_rowid() as id').get() as { id: number }).id;
		db.prepare('INSERT INTO player_profiles (player_id) VALUES (?)').run(playerId);
		const row = db.prepare('SELECT tags FROM player_profiles WHERE player_id = ?').get(playerId) as { tags: string };
		expect(row.tags).toBe('[]');
	});

	it('boot is idempotent — CREATE TABLE IF NOT EXISTS does not error on existing table', () => {
		expect(() => {
			db.exec(`CREATE TABLE IF NOT EXISTS player_profiles (
				player_id INTEGER PRIMARY KEY REFERENCES players(id),
				notes TEXT,
				tags TEXT NOT NULL DEFAULT '[]',
				taste_fingerprint TEXT,
				fingerprint_model TEXT,
				fingerprint_cost_usd REAL,
				fingerprint_generated_at TEXT,
				updated_at TEXT
			)`);
		}).not.toThrow();
	});
});

describe('sprint-28 schema: prediction_runs', () => {
	it('table exists after boot', () => {
		const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(r => r.name);
		expect(tables).toContain('prediction_runs');
	});

	it('has all required columns', () => {
		const cols = (db.prepare('PRAGMA table_info(prediction_runs)').all() as { name: string }[]).map(c => c.name);
		for (const col of PREDICTION_RUNS_COLS) {
			expect(cols, `missing column: ${col}`).toContain(col);
		}
	});

	it('id is the primary key (text uuid)', () => {
		const info = db.prepare('PRAGMA table_info(prediction_runs)').all() as { name: string; pk: number; type: string }[];
		const pk = info.find(c => c.name === 'id');
		expect(pk?.pk).toBe(1);
		expect(pk?.type.toUpperCase()).toBe('TEXT');
	});

	it('round_id is nullable', () => {
		const info = db.prepare('PRAGMA table_info(prediction_runs)').all() as { name: string; notnull: number }[];
		const col = info.find(c => c.name === 'round_id');
		expect(col?.notnull).toBe(0);
	});

	it('actual_json and score_json are nullable (reserved for Sprint 3)', () => {
		const info = db.prepare('PRAGMA table_info(prediction_runs)').all() as { name: string; notnull: number }[];
		for (const colName of ['actual_json', 'score_json']) {
			const col = info.find(c => c.name === colName);
			expect(col?.notnull, `${colName} should be nullable`).toBe(0);
		}
	});

	it('can insert and retrieve a run row', () => {
		const id = 'test-uuid-1234';
		db.prepare(`INSERT INTO prediction_runs (id, task_id, player_id, model, cost_usd, latency_ms, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)`
		).run(id, 'taste-fingerprint', 1, 'openai/gpt-4o-mini', 0.0012, 842, '2026-06-13T00:00:00Z');
		const row = db.prepare('SELECT * FROM prediction_runs WHERE id = ?').get(id) as {
			id: string; task_id: string; cost_usd: number; actual_json: unknown; score_json: unknown;
		};
		expect(row.id).toBe(id);
		expect(row.task_id).toBe('taste-fingerprint');
		expect(row.cost_usd).toBe(0.0012);
		expect(row.actual_json).toBeNull();
		expect(row.score_json).toBeNull();
	});

	it('boot is idempotent — CREATE TABLE IF NOT EXISTS does not error on existing table', () => {
		expect(() => {
			db.exec(`CREATE TABLE IF NOT EXISTS prediction_runs (
				id TEXT PRIMARY KEY,
				task_id TEXT, player_id INTEGER, round_id INTEGER,
				input_json TEXT, output_json TEXT, model TEXT,
				cost_usd REAL, latency_ms INTEGER, created_at TEXT,
				actual_json TEXT, score_json TEXT
			)`);
		}).not.toThrow();
	});
});
