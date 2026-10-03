import type Database from 'better-sqlite3';
import { digestBaseUrl } from '$lib/config/urls.js';

/** Best public digest link for a round: 2.0 share, else 1.0 share, else null. */
export function digestLinkForRound(
	db: Database.Database,
	roundId: number
): { url: string; kind: 'v2' | 'v1' } | null {
	const v2 = db.prepare('SELECT slug FROM digest2_shares WHERE round_id = ?').get(roundId) as { slug: string } | undefined;
	if (v2) return { url: `${digestBaseUrl()}/d2/${v2.slug}`, kind: 'v2' };
	const v1 = db.prepare('SELECT slug FROM digest_shares WHERE round_id = ?').get(roundId) as { slug: string } | undefined;
	if (v1) return { url: `${digestBaseUrl()}/d/${v1.slug}`, kind: 'v1' };
	return null;
}
