import { describe, it, expect } from 'vitest';
import type Database from 'better-sqlite3';
import type { Snapshot } from '$lib/server/boarzStats/data.js';
import { openLeagueDb } from '$lib/db/client.js';
import { buildDigest2Page } from './page.js';

const emptySnapshot = { generatedAt: 'x', competitors: [], rounds: [] } as unknown as Snapshot;

function seed(db: Database.Database) {
	db.exec(`
		INSERT INTO leagues (id, slug, name) VALUES (1, 'boarz-ii-men', 'Boarz II Men');
		INSERT INTO seasons (id, league_id, season_number, status) VALUES (10, 1, 2, 'active');
		INSERT INTO rounds (id, season_id, ml_round_id, name, created_at)
			VALUES (100, 10, 'ml-100', 'R', '2026-09-01T00:00:00Z');
		INSERT INTO digest_drafts (id, round_id, rel_context, prep_checks, stats_content_json)
			VALUES ('d1', 100, '{}', '{}', '{}');
		INSERT INTO digest_sections (id, draft_id, kind, position, state, content_json)
			VALUES ('s1','d1','podium',0,'default','{"title":"The Podium"}');
	`);
}

describe('buildDigest2Page', () => {
	it('returns snapshot + story for a round with a draft', () => {
		const db = openLeagueDb(':memory:');
		seed(db);
		const page = buildDigest2Page(db, 100, () => emptySnapshot);
		db.close();
		expect(page.roundId).toBe(100);
		expect(page.snapshot).toBe(emptySnapshot);
		expect(page.story.blocks.map((b) => b.kind)).toEqual(['podium']);
		expect(page.structural).toBeDefined();
		expect(page.structural.reel).toBeNull(); // the seed draft has no reel media
	});

	it('returns snapshot + empty story when the round exists but has no draft', () => {
		const db = openLeagueDb(':memory:');
		db.exec(`
			INSERT INTO leagues (id, slug, name) VALUES (1, 'boarz-ii-men', 'Boarz II Men');
			INSERT INTO seasons (id, league_id, season_number, status) VALUES (10, 1, 2, 'active');
			INSERT INTO rounds (id, season_id, ml_round_id, name, created_at)
				VALUES (101, 10, 'ml-101', 'R2', '2026-09-02T00:00:00Z');
		`);
		const page = buildDigest2Page(db, 101, () => emptySnapshot);
		db.close();
		expect(page.snapshot).toBe(emptySnapshot);
		expect(page.story).toEqual({ blocks: [], coinage: null });
		expect(page.structural).toEqual({
			standings: null,
			nextRound: null,
			tastemaker: null,
			guesser: null,
			reel: null
		});
	});

	it('throws for an unknown round', () => {
		const db = openLeagueDb(':memory:');
		expect(() => buildDigest2Page(db, 999, () => emptySnapshot)).toThrow(/not found/);
		db.close();
	});
});
