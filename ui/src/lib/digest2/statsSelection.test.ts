import { describe, it, expect } from 'vitest';
import type Database from 'better-sqlite3';
import { openLeagueDb } from '$lib/db/client.js';
import { resolveStatsSelectionForRound } from './statsSelection.js';

function seed(db: Database.Database) {
	db.exec(`
		INSERT INTO leagues (id, slug, name) VALUES (1, 'boarz-ii-men', 'Boarz II Men');
		INSERT INTO seasons (id, league_id, season_number, status) VALUES (10, 1, 2, 'active');
		INSERT INTO rounds (id, season_id, ml_round_id, name, created_at)
			VALUES (100, 10, 'ml-100', 'These Go to 11', '2026-09-01T00:00:00Z');
	`);
}

describe('resolveStatsSelectionForRound', () => {
	it("maps a round to its league slug and its own season", () => {
		const db = openLeagueDb(':memory:');
		seed(db);
		const sel = resolveStatsSelectionForRound(db, 100);
		db.close();
		expect(sel).toEqual({ leagueSlug: 'boarz-ii-men', seasons: [2] });
	});

	it('returns null for an unknown round', () => {
		const db = openLeagueDb(':memory:');
		const sel = resolveStatsSelectionForRound(db, 999);
		db.close();
		expect(sel).toBeNull();
	});
});
