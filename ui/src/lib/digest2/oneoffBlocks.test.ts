import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openLeagueDb } from '$lib/db/client.js';
import { buildDigest2Oneoffs } from './oneoffBlocks.js';

let db: Database.Database;
beforeEach(() => {
	db = openLeagueDb(':memory:');
	db.exec(`
		INSERT INTO leagues (id, slug, name) VALUES (1, 'bz', 'Boarz II Men');
		INSERT INTO seasons (id, league_id, season_number, status) VALUES (10, 1, 2, 'active');
		INSERT INTO rounds (id, season_id, ml_round_id, name, created_at) VALUES (100, 10, 'ml-100', 'R', '2026-09-01T00:00:00Z');
	`);
});

const addSection = (draft: string, kind: string, json: string, state = 'default', source = 'oneoff', pos = 0) =>
	db
		.prepare('INSERT INTO digest2_sections (id, draft_id, kind, source, position, state, content_json) VALUES (?,?,?,?,?,?,?)')
		.run(`${draft}-${kind}-${pos}`, draft, kind, source, pos, state, json);

describe('buildDigest2Oneoffs', () => {
	it('is empty without a 2.0 draft', () => {
		expect(buildDigest2Oneoffs(db, 100)).toEqual({});
	});

	it('reads the newest draft only, skipping excluded, auto and malformed rows', () => {
		db.exec(`INSERT INTO digest2_drafts (id, round_id, generated_at) VALUES
			('old', 100, '2026-09-01T00:00:00Z'), ('new', 100, '2026-09-02T00:00:00Z')`);
		addSection('old', 'ama', '{"title":"stale"}');
		addSection('new', 'ama', '{"title":"fresh"}');
		addSection('new', 'quiz', '{"title":"gone"}', 'excluded');
		addSection('new', 'poll', '{"title":"auto"}', 'default', 'auto');
		addSection('new', 'broken', '{not json');
		expect(buildDigest2Oneoffs(db, 100)).toEqual({ ama: { title: 'fresh' } });
	});
});
