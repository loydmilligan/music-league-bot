import { describe, it, expect, vi } from 'vitest';
import type Database from 'better-sqlite3';
import type { Snapshot, StatsSelection } from '$lib/server/boarzStats/data.js';
import { openLeagueDb } from '$lib/db/client.js';
import { buildStatsEmbedForRound } from './statsEmbed.js';

function seed(db: Database.Database) {
	db.exec(`
		INSERT INTO leagues (id, slug, name) VALUES (1, 'boarz-ii-men', 'Boarz II Men');
		INSERT INTO seasons (id, league_id, season_number, status) VALUES (10, 1, 2, 'active');
		INSERT INTO rounds (id, season_id, ml_round_id, name, created_at)
			VALUES (100, 10, 'ml-100', 'R', '2026-09-01T00:00:00Z');
	`);
}

// A minimal snapshot stand-in — the empty-arrays case (a season with no data yet).
const emptySnapshot = { generatedAt: 'x', competitors: [], rounds: [] } as unknown as Snapshot;

describe('buildStatsEmbedForRound', () => {
	it("passes the round's own-season selection to the snapshot builder", () => {
		const db = openLeagueDb(':memory:');
		seed(db);
		const build = vi.fn((_s: StatsSelection) => emptySnapshot);
		const out = buildStatsEmbedForRound(db, 100, build);
		db.close();
		expect(build).toHaveBeenCalledWith({ leagueSlug: 'boarz-ii-men', seasons: [2] });
		expect(out).toEqual({ roundId: 100, snapshot: emptySnapshot });
	});

	it('does not throw when the snapshot has empty data arrays', () => {
		const db = openLeagueDb(':memory:');
		seed(db);
		expect(() => buildStatsEmbedForRound(db, 100, () => emptySnapshot)).not.toThrow();
		db.close();
	});

	it('throws for an unknown round', () => {
		const db = openLeagueDb(':memory:');
		expect(() => buildStatsEmbedForRound(db, 999, () => emptySnapshot)).toThrow(/not found/);
		db.close();
	});
});
