import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openLeagueDb } from '$lib/db/client.js';
import { buildDigest2Chrome } from './chrome.js';
import { getOrCreateDigest2Slug } from './shares.js';

let db: Database.Database;
beforeEach(() => {
	db = openLeagueDb(':memory:');
	db.exec(`
		INSERT INTO leagues (id, slug, name) VALUES (1, 'bz', 'Boarz II Men');
		INSERT INTO seasons (id, league_id, season_number, status) VALUES (10, 1, 2, 'active');
		INSERT INTO rounds (id, season_id, ml_round_id, name, created_at) VALUES (100, 10, 'ml-100', 'These Go to 11', '2026-09-01T00:00:00Z');
	`);
});

describe('buildDigest2Chrome', () => {
	it('meta carries league + round names', () => {
		expect(buildDigest2Chrome(db, 100, false).meta).toEqual({ leagueName: 'Boarz II Men', roundName: 'These Go to 11' });
	});
	it('share mode: admin is null (no draft times, no links leak into the public copy)', () => {
		db.exec(`INSERT INTO digest_drafts (id, round_id, rel_context, prep_checks, stats_content_json) VALUES ('d1', 100, '{}', '{}', '{}')`);
		getOrCreateDigest2Slug(db, 100);
		const c = buildDigest2Chrome(db, 100, true);
		expect(c.share).toBe(true);
		expect(c.admin).toBeNull();
	});
	// 03:00Z is still the previous evening in Central time, so a UTC slice would be a day late.
	it('roundStartDay is the round start as a stats (Central) day', () => {
		db.exec(`UPDATE rounds SET round_started_at = '2026-10-14T03:00:00Z' WHERE id = 100`);
		expect(buildDigest2Chrome(db, 100, true).roundStartDay).toBe('2026-10-13');
	});
	it('roundStartDay falls back to the previous round closing, then to null', () => {
		db.exec(`
			UPDATE rounds SET round_number = 2 WHERE id = 100;
			INSERT INTO rounds (id, season_id, ml_round_id, name, created_at, round_number, voting_ended_at)
			VALUES (99, 10, 'ml-99', 'Prev', '2026-08-01T00:00:00Z', 1, '2026-09-08T20:00:00Z');
		`);
		expect(buildDigest2Chrome(db, 100, false).roundStartDay).toBe('2026-09-08');
		db.exec(`DELETE FROM rounds WHERE id = 99`);
		expect(buildDigest2Chrome(db, 100, false).roundStartDay).toBeNull();
	});
	it('admin mode, no draft, never published', () => {
		expect(buildDigest2Chrome(db, 100, false).admin).toEqual({ draftGeneratedAt: null, published: null });
	});
	it('admin mode, draft + published', () => {
		db.exec(`INSERT INTO digest_drafts (id, round_id, rel_context, prep_checks, stats_content_json, generated_at) VALUES ('d1', 100, '{}', '{}', '{}', '2026-09-24T10:00:00Z')`);
		getOrCreateDigest2Slug(db, 100);
		const a = buildDigest2Chrome(db, 100, false).admin!;
		expect(a.draftGeneratedAt).toBe('2026-09-24T10:00:00Z');
		expect(a.published?.url).toMatch(/\/d2\/[A-Za-z0-9_-]{16}$/);
	});
});
