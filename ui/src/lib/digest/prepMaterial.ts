/**
 * What pre-generation material exists for a round.
 *
 * Answers a different question from runPrepChecks: that one asks "is the DATA
 * imported?", this asks "what MATERIAL do we hold to build from?" They render
 * as two blocks on the prepare stage and are deliberately not merged.
 */
import type Database from 'better-sqlite3';

/**
 * `not-enabled` (the league is not opted in) is deliberately distinct from
 * `absent` (opted in, nothing there). Collapsing them is how R148 shipped
 * without a Regulars section without anyone noticing.
 */
export type MaterialStatus = 'present' | 'absent' | 'not-enabled';

export type MaterialRow = {
	id: string;
	name: string;
	status: MaterialStatus;
	/** Where it comes from / why it is missing. Rendered like PrepareCheck.src. */
	src: string;
	count?: number;
	preview?: unknown;
};

/**
 * The prior round in the same season, by voting deadline.
 * Mirrors generate_ledes.py's lookup so the app and the lede generator never
 * disagree about which bridge belongs to which round.
 */
export function previousRoundId(db: Database.Database, roundId: number): number | null {
	const self = db.prepare('SELECT season_id, voting_deadline FROM rounds WHERE id = ?')
		.get(roundId) as { season_id: number; voting_deadline: string | null } | undefined;
	if (!self?.voting_deadline) return null;
	const prev = db.prepare(
		`SELECT id FROM rounds
      WHERE season_id = ? AND voting_deadline IS NOT NULL AND voting_deadline < ?
      ORDER BY voting_deadline DESC LIMIT 1`,
	).get(self.season_id, self.voting_deadline) as { id: number } | undefined;
	return prev?.id ?? null;
}

function bridgeRow(db: Database.Database, roundId: number): MaterialRow {
	const base = { id: 'bridge', name: "Previous round's bridge" };
	const prevId = previousRoundId(db, roundId);
	if (prevId === null) {
		return { ...base, status: 'absent', src: 'no previous round in this season' };
	}
	let row: { content_json: string; generated_at: string } | undefined;
	try {
		row = db.prepare('SELECT content_json, generated_at FROM digest_bridges WHERE round_id = ?')
			.get(prevId) as typeof row;
	} catch {
		row = undefined; // table may not exist on an old DB
	}
	if (!row) {
		return { ...base, status: 'absent', src: `digest_bridges · round ${prevId} · never generated` };
	}
	try {
		return {
			...base,
			status: 'present',
			src: `round ${prevId} · ${row.generated_at}`,
			preview: JSON.parse(row.content_json),
		};
	} catch {
		// A malformed payload is worse than a missing one; report it as absent so
		// it is regenerated rather than silently previewed as empty.
		return { ...base, status: 'absent', src: `round ${prevId} · malformed payload` };
	}
}

export function gatherPrepMaterial(db: Database.Database, roundId: number): MaterialRow[] {
	return [bridgeRow(db, roundId)];
}
