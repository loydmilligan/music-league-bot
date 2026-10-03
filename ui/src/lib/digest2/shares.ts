import { randomBytes } from 'node:crypto';
import type Database from 'better-sqlite3';
import { digestBaseUrl } from '$lib/config/urls.js';

/** Public link for a published 2.0 digest — always the digest host, never the app host. */
export function digest2ShareUrl(slug: string): string {
	return `${digestBaseUrl()}/d2/${slug}`;
}

/** Stable, unguessable slug per round (one forever; re-publish overwrites in place). */
export function getOrCreateDigest2Slug(db: Database.Database, roundId: number): string {
	const row = db.prepare('SELECT slug FROM digest2_shares WHERE round_id = ?').get(roundId) as
		| { slug: string }
		| undefined;
	if (row?.slug) return row.slug;
	const slug = randomBytes(12).toString('base64url');
	db.prepare(
		`INSERT INTO digest2_shares (round_id, slug) VALUES (?, ?) ON CONFLICT(round_id) DO NOTHING`
	).run(roundId, slug);
	return (db.prepare('SELECT slug FROM digest2_shares WHERE round_id = ?').get(roundId) as { slug: string }).slug;
}

export function getDigest2Share(
	db: Database.Database,
	roundId: number
): { slug: string; updatedAt: string; url: string } | null {
	const row = db
		.prepare('SELECT slug, updated_at AS updatedAt FROM digest2_shares WHERE round_id = ?')
		.get(roundId) as { slug: string; updatedAt: string } | undefined;
	return row ? { ...row, url: digest2ShareUrl(row.slug) } : null;
}

export function touchDigest2Share(db: Database.Database, roundId: number): void {
	db.prepare(
		`UPDATE digest2_shares SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE round_id = ?`
	).run(roundId);
}

/** Existing slug for a round, or null — never inserts. */
export function peekDigest2Slug(db: Database.Database, roundId: number): string | null {
	const row = db.prepare('SELECT slug FROM digest2_shares WHERE round_id = ?').get(roundId) as
		| { slug: string }
		| undefined;
	return row?.slug ?? null;
}

/** A fresh unguessable slug candidate (not persisted). */
export function newDigest2Slug(): string {
	return randomBytes(12).toString('base64url');
}

/** Persist the share row after a successful publish; an existing row (and its slug) wins. */
export function recordDigest2Share(db: Database.Database, roundId: number, slug: string): string {
	db.prepare(
		`INSERT INTO digest2_shares (round_id, slug) VALUES (?, ?) ON CONFLICT(round_id) DO NOTHING`
	).run(roundId, slug);
	return (db.prepare('SELECT slug FROM digest2_shares WHERE round_id = ?').get(roundId) as { slug: string }).slug;
}
