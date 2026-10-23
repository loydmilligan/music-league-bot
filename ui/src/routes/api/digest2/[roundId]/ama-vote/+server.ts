import type { RequestHandler } from './$types.js';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';

const COOKIE = 'ama_voter_id';
const YEAR = 365 * 24 * 60 * 60;
const uuid = () => crypto.randomUUID();

function resolveVoterId(cookies: { get: (name: string) => string | undefined }, fallback?: string | null) {
	const fromCookie = cookies.get(COOKIE);
	if (fromCookie?.length) return fromCookie;
	if (fallback?.length) return fallback;
	return uuid();
}

function voterCookieOpts(secure: boolean) {
	return {
		path: '/',
		httpOnly: true,
		sameSite: 'lax' as const,
		secure,
		maxAge: YEAR,
	};
}

function voterHeader(voterId: string, secure: boolean) {
	return { 'Set-Cookie': `${COOKIE}=${voterId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${YEAR}${secure ? '; Secure' : ''}` };
}

export const GET: RequestHandler = async ({ params, url, cookies }) => {
	const roundId = Number(params.roundId);
	const voterId = resolveVoterId(cookies, url.searchParams.get('voter_id'));
	const secure = url.protocol === 'https:';
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

	return json({ myVotes, results, voter_id: voterId }, { headers: voterHeader(voterId, secure) });
};

export const POST: RequestHandler = async ({ params, request, cookies }) => {
	const roundId = Number(params.roundId);
	const body = (await request.json()) as {
		voter_id?: string;
		prompt_index?: number;
		answer_index?: number;
	};
	const voterId = resolveVoterId(cookies, body.voter_id);
	const secure = new URL(request.url).protocol === 'https:';

	if (body.prompt_index == null || body.answer_index == null) {
		return json({ error: 'prompt_index, answer_index required' }, { status: 400 });
	}

	const db = getDb();
	db.prepare(
		`INSERT INTO ama_votes (round_id, prompt_index, answer_index, voter_id, voted_at)
		 VALUES (?, ?, ?, ?, datetime('now'))
		 ON CONFLICT(round_id, prompt_index, voter_id) DO UPDATE SET
		 answer_index = excluded.answer_index, voted_at = excluded.voted_at`
	).run(roundId, body.prompt_index, body.answer_index, voterId);

	const tally = db
		.prepare('SELECT answer_index, COUNT(*) AS c FROM ama_votes WHERE round_id = ? AND prompt_index = ? GROUP BY answer_index')
		.all(roundId, body.prompt_index) as { answer_index: number; c: number }[];

	const results: Record<number, number> = {};
	for (const r of tally) results[r.answer_index] = r.c;

	const myRow = db
		.prepare('SELECT answer_index FROM ama_votes WHERE round_id = ? AND prompt_index = ? AND voter_id = ?')
		.get(roundId, body.prompt_index, voterId) as { answer_index: number } | undefined;

	return json(
		{ myVote: myRow?.answer_index, results, voter_id: voterId },
		{ headers: voterHeader(voterId, secure) },
	);
};