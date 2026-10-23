import type { RequestHandler } from './$types.js';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { AMA_COOKIE, castAmaVote, readAmaVotes, resolveVoterId, validVoteIndices, voterHeader } from '$lib/server/amaVotes.js';

// Admin-host AMA poll by round id; the public twin is /api/p/ama/<shareSlug>.

export const GET: RequestHandler = async ({ params, url, cookies }) => {
	const roundId = Number(params.roundId);
	const voterId = resolveVoterId(cookies.get(AMA_COOKIE), url.searchParams.get('voter_id'));
	return json(readAmaVotes(getDb(), roundId, voterId), { headers: voterHeader(voterId, url.protocol === 'https:') });
};

export const POST: RequestHandler = async ({ params, request, cookies }) => {
	const roundId = Number(params.roundId);
	const body = (await request.json()) as { voter_id?: string; prompt_index?: unknown; answer_index?: unknown };
	if (!validVoteIndices(body.prompt_index, body.answer_index)) {
		return json({ error: 'prompt_index, answer_index required' }, { status: 400 });
	}
	const voterId = resolveVoterId(cookies.get(AMA_COOKIE), body.voter_id);
	const out = castAmaVote(getDb(), roundId, voterId, body.prompt_index, body.answer_index as number);
	return json(out, { headers: voterHeader(voterId, new URL(request.url).protocol === 'https:') });
};
