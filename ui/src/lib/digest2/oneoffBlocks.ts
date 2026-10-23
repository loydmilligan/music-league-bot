import type Database from 'better-sqlite3';

/**
 * Hand-built 2.0 sections (digest2_sections, source='oneoff') from the round's newest
 * 2.0 draft, keyed by kind. 2.0 owns these tables, so new kinds (e.g. 'ama') need no
 * change to the 1.0 schema. Read-only; a malformed row is skipped, never thrown.
 */
export function buildDigest2Oneoffs(db: Database.Database, roundId: number): Record<string, unknown> {
	const draft = db
		.prepare('SELECT id FROM digest2_drafts WHERE round_id = ? ORDER BY generated_at DESC LIMIT 1')
		.get(roundId) as { id: string } | undefined;
	if (!draft) return {};
	const rows = db
		.prepare(
			`SELECT kind, content_json FROM digest2_sections
			  WHERE draft_id = ? AND source = 'oneoff' AND state != 'excluded'
			  ORDER BY position`
		)
		.all(draft.id) as { kind: string; content_json: string }[];
	const out: Record<string, unknown> = {};
	for (const r of rows) {
		try {
			out[r.kind] = JSON.parse(r.content_json);
		} catch {
			/* skip the bad block */
		}
	}
	return out;
}
