import type Database from 'better-sqlite3';
import { getActiveDraftForRound } from '$lib/digest/llm.js';
import { getDigest2Share } from './shares.js';
import { dayOfTs } from '$lib/server/boarzStats/chat.js';

export interface Digest2Chrome {
	share: boolean;
	meta: { leagueName: string; roundName: string };
	/** First day of the round in stats (Central) days, or null — chat charts open on it. */
	roundStartDay: string | null;
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
	const roundStartDay = roundStartDayFor(db, roundId);
	if (share) return { share, meta, roundStartDay, admin: null };
	const draft = getActiveDraftForRound(db, roundId);
	const pub = getDigest2Share(db, roundId);
	return {
		share,
		meta,
		roundStartDay,
		admin: {
			draftGeneratedAt: draft?.generated_at ?? null,
			published: pub ? { url: pub.url, updatedAt: pub.updatedAt } : null
		}
	};
}

/** The round's start, else the previous round's close (zip-imported rounds lack round_started_at). */
function roundStartDayFor(db: Database.Database, roundId: number): string | null {
	const r = db
		.prepare(
			`SELECT r.round_started_at AS started,
			        (SELECT p.voting_ended_at FROM rounds p
			          WHERE p.season_id = r.season_id AND p.round_number = r.round_number - 1) AS prevEnded
			   FROM rounds r WHERE r.id = ?`
		)
		.get(roundId) as { started: string | null; prevEnded: string | null } | undefined;
	const ts = r?.started ?? r?.prevEnded;
	return ts ? dayOfTs(ts) : null;
}
