import type Database from 'better-sqlite3';

// AMA poll storage, shared by the admin route (/api/digest2/<id>/ama-vote) and the
// public one the digest host proxies (/api/p/ama/<shareSlug>). The vote key is a
// long-lived HttpOnly cookie; the client's localStorage UUID is only a fallback.

export const AMA_COOKIE = 'ama_voter_id';
const YEAR = 365 * 24 * 60 * 60;

export function resolveVoterId(cookieValue: string | undefined, fallback?: string | null): string {
	if (cookieValue?.length) return cookieValue;
	if (fallback?.length) return fallback;
	return crypto.randomUUID();
}

export function voterHeader(voterId: string, secure: boolean) {
	return { 'Set-Cookie': `${AMA_COOKIE}=${voterId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${YEAR}${secure ? '; Secure' : ''}` };
}

/** Round behind a published share slug, or null. Never inserts. */
export function roundForShareSlug(db: Database.Database, slug: string): number | null {
	const row = db.prepare('SELECT round_id FROM digest2_shares WHERE slug = ?').get(slug) as { round_id: number } | undefined;
	return row?.round_id ?? null;
}

/** Both indices must be small non-negative integers (the public route is unauthenticated). */
export function validVoteIndices(prompt: unknown, answer: unknown): prompt is number {
	const ok = (n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) < 50;
	return ok(prompt) && ok(answer);
}

export function readAmaVotes(db: Database.Database, roundId: number, voterId: string) {
	const myRows = db
		.prepare('SELECT prompt_index, answer_index FROM ama_votes WHERE round_id = ? AND voter_id = ?')
		.all(roundId, voterId) as { prompt_index: number; answer_index: number }[];
	const myVotes: Record<number, number> = {};
	for (const r of myRows) myVotes[r.prompt_index] = r.answer_index;

	const tallyRows = db
		.prepare('SELECT prompt_index, answer_index, COUNT(*) AS c FROM ama_votes WHERE round_id = ? GROUP BY prompt_index, answer_index ORDER BY prompt_index, c DESC')
		.all(roundId) as { prompt_index: number; answer_index: number; c: number }[];
	const results: Record<number, Record<number, number>> = {};
	for (const r of tallyRows) {
		results[r.prompt_index] ??= {};
		results[r.prompt_index][r.answer_index] = r.c;
	}
	return { myVotes, results, voter_id: voterId };
}

/** One vote per voter per prompt; a re-vote replaces it. */
export function castAmaVote(db: Database.Database, roundId: number, voterId: string, prompt: number, answer: number) {
	db.prepare(
		`INSERT INTO ama_votes (round_id, prompt_index, answer_index, voter_id, voted_at)
		 VALUES (?, ?, ?, ?, datetime('now'))
		 ON CONFLICT(round_id, prompt_index, voter_id) DO UPDATE SET
		 answer_index = excluded.answer_index, voted_at = excluded.voted_at`
	).run(roundId, prompt, answer, voterId);

	const tally = db
		.prepare('SELECT answer_index, COUNT(*) AS c FROM ama_votes WHERE round_id = ? AND prompt_index = ? GROUP BY answer_index')
		.all(roundId, prompt) as { answer_index: number; c: number }[];
	const results: Record<number, number> = {};
	for (const r of tally) results[r.answer_index] = r.c;

	const myRow = db
		.prepare('SELECT answer_index FROM ama_votes WHERE round_id = ? AND prompt_index = ? AND voter_id = ?')
		.get(roundId, prompt, voterId) as { answer_index: number } | undefined;
	return { myVote: myRow?.answer_index, results, voter_id: voterId };
}
