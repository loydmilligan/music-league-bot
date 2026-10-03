import type Database from 'better-sqlite3';
import { getActiveDraftForRound } from '$lib/digest/llm.js';
import { getDigest2Share } from './shares.js';

export interface Digest2Chrome {
	share: boolean;
	meta: { leagueName: string; roundName: string };
	/** null in share mode — nothing admin-only may reach the public copy. */
	admin: { draftGeneratedAt: string | null; published: { url: string; updatedAt: string } | null } | null;
}

export function buildDigest2Chrome(db: Database.Database, roundId: number, share: boolean): Digest2Chrome {
	const row = db
		.prepare(
			`SELECT l.name AS leagueName, r.name AS roundName
			   FROM rounds r JOIN seasons s ON s.id = r.season_id JOIN leagues l ON l.id = s.league_id
			  WHERE r.id = ?`
		)
		.get(roundId) as { leagueName: string; roundName: string } | undefined;
	const meta = row ?? { leagueName: '', roundName: '' };
	if (share) return { share, meta, admin: null };
	const draft = getActiveDraftForRound(db, roundId);
	const pub = getDigest2Share(db, roundId);
	return {
		share,
		meta,
		admin: {
			draftGeneratedAt: draft?.generated_at ?? null,
			published: pub ? { url: pub.url, updatedAt: pub.updatedAt } : null
		}
	};
}
