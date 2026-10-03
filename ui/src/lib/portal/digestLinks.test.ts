import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openLeagueDb } from '$lib/db/client.js';
import { digestBaseUrl } from '$lib/config/urls.js';
import { digestLinkForRound } from './digestLinks.js';

let db: Database.Database;
beforeEach(() => {
	db = openLeagueDb(':memory:');
	db.exec(`
		INSERT INTO leagues (id, slug, name) VALUES (1, 'bz', 'Boarz');
		INSERT INTO seasons (id, league_id, season_number, status) VALUES (10, 1, 1, 'active');
		INSERT INTO rounds (id, season_id, ml_round_id, name, created_at) VALUES
			(1, 10, 'a', 'R1', '2026-01-01'), (2, 10, 'b', 'R2', '2026-01-02'), (3, 10, 'c', 'R3', '2026-01-03');
		INSERT INTO digest_shares (round_id, slug) VALUES (1, 'v1only0000000000'), (2, 'v1both0000000000');
		INSERT INTO digest2_shares (round_id, slug) VALUES (2, 'v2both0000000000');
	`);
});

describe('digestLinkForRound', () => {
	it('prefers the 2.0 share when both exist', () => {
		expect(digestLinkForRound(db, 2)).toEqual({ url: `${digestBaseUrl()}/d2/v2both0000000000`, kind: 'v2' });
	});
	it('falls back to the 1.0 share', () => {
		expect(digestLinkForRound(db, 1)).toEqual({ url: `${digestBaseUrl()}/d/v1only0000000000`, kind: 'v1' });
	});
	it('null when the round has no share', () => {
		expect(digestLinkForRound(db, 3)).toBeNull();
	});
});
