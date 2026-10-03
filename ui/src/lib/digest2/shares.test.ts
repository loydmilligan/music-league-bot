import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openLeagueDb } from '$lib/db/client.js';
import { digestBaseUrl } from '$lib/config/urls.js';
import { getOrCreateDigest2Slug, getDigest2Share, touchDigest2Share, digest2ShareUrl } from './shares.js';

let db: Database.Database;
beforeEach(() => {
	db = openLeagueDb(':memory:');
	db.exec(`
		INSERT INTO leagues (id, slug, name) VALUES (1, 'bz', 'Boarz');
		INSERT INTO seasons (id, league_id, season_number, status) VALUES (10, 1, 2, 'active');
		INSERT INTO rounds (id, season_id, ml_round_id, name, created_at) VALUES (100, 10, 'ml-100', 'R', '2026-09-01T00:00:00Z');
		INSERT INTO rounds (id, season_id, ml_round_id, name, created_at) VALUES (101, 10, 'ml-101', 'R2', '2026-09-02T00:00:00Z');
	`);
});

describe('digest2 shares', () => {
	it('mints a 16-char url-safe slug once and reuses it', () => {
		const a = getOrCreateDigest2Slug(db, 100);
		expect(a).toMatch(/^[A-Za-z0-9_-]{16}$/);
		expect(getOrCreateDigest2Slug(db, 100)).toBe(a);
	});
	it('different rounds get different slugs', () => {
		expect(getOrCreateDigest2Slug(db, 100)).not.toBe(getOrCreateDigest2Slug(db, 101));
	});
	it('never writes the 1.0 digest_shares table', () => {
		getOrCreateDigest2Slug(db, 100);
		expect((db.prepare('SELECT COUNT(*) n FROM digest_shares').get() as { n: number }).n).toBe(0);
	});
	it('getDigest2Share is null before publish, then returns slug + digest-host url', () => {
		expect(getDigest2Share(db, 100)).toBeNull();
		const slug = getOrCreateDigest2Slug(db, 100);
		const s = getDigest2Share(db, 100)!;
		expect(s.slug).toBe(slug);
		expect(s.url).toBe(`${digestBaseUrl()}/d2/${slug}`);
	});
	it('touch bumps updated_at', () => {
		getOrCreateDigest2Slug(db, 100);
		db.prepare(`UPDATE digest2_shares SET updated_at = '2000-01-01T00:00:00Z' WHERE round_id = 100`).run();
		touchDigest2Share(db, 100);
		expect(getDigest2Share(db, 100)!.updatedAt).not.toBe('2000-01-01T00:00:00Z');
	});
	it('digest2ShareUrl uses the digest host, never the app host', () => {
		expect(digest2ShareUrl('abc')).toBe(`${digestBaseUrl()}/d2/abc`);
	});
});
