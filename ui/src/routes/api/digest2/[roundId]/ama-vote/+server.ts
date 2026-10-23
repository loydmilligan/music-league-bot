import type { RequestHandler } from './$types.js';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';

const uuid = () => crypto.randomUUID();

export const GET: RequestHandler = async ({ params, url }) => {
	const roundId = Number(params.roundId);
	const voterId = url.searchParams.get('voter_id');
	if (!voterId) return json({ myVotes: {}, results: {} });
	const db = getDb();

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
		const prompt = r.prompt_index;
		results[prompt] ??= {};
		results[prompt][r.answer_index] = r.c;
	}

	return json({ myVotes, results });
};

export const POST: RequestHandler = async ({ params, request }) => {
	const roundId = Number(params.roundId);
	const { voter_id, prompt_index, answer_index } = (await request.json()) as {
		voter_id?: string;
		prompt_index?: number;
		answer_index?: number;
	};
	if (!voter_id || prompt_index == null || answer_index == null) {
		return json({ error: 'voter_id, prompt_index, answer_index required' }, { status: 400 });
	}
	const id = voter_id.length >= 8 ? voter_id : uuid();

	const db = getDb();
	db.prepare(
		`INSERT INTO ama_votes (round_id, prompt_index, answer_index, voter_id, voted_at)
		 VALUES (?, ?, ?, ?, datetime('now'))
		 ON CONFLICT(round_id, prompt_index, voter_id) DO UPDATE SET
		 answer_index = excluded.answer_index, voted_at = excluded.voted_at`
	).run(roundId, prompt_index, answer_index, id);

	const tally = db
		.prepare('SELECT answer_index, COUNT(*) AS c FROM ama_votes WHERE round_id = ? AND prompt_index = ? GROUP BY answer_index')
		.all(roundId, prompt_index) as { answer_index: number; c: number }[];

	const results: Record<number, number> = {};
	for (const r of tally) results[r.answer_index] = r.c;

	const myRow = db
		.prepare('SELECT answer_index FROM ama_votes WHERE round_id = ? AND prompt_index = ? AND voter_id = ?')
		.get(roundId, prompt_index, id) as { answer_index: number } | undefined;

	return json({ myVote: myRow?.answer_index, results, voter_id: id });
};