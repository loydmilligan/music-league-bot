import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { AMA_COOKIE, castAmaVote, readAmaVotes, resolveVoterId, roundForShareSlug, validVoteIndices, voterHeader } from '$lib/server/amaVotes.js';

// Public AMA poll, keyed by the digest2 share slug (never a round id). Lives under
// /api/p/ because that is the one prefix the Access-less digest host proxies to
// bot-ui (Caddyfile.digest), so the published copy and mlb13 hit the same API.

function round(slug: string): number {
	const roundId = roundForShareSlug(getDb(), slug);
	if (roundId == null) throw error(404, 'not found');
	return roundId;
}

export const GET: RequestHandler = async ({ params, url, cookies }) => {
	const roundId = round(params.slug);
	const voterId = resolveVoterId(cookies.get(AMA_COOKIE), url.searchParams.get('voter_id'));
	return json(readAmaVotes(getDb(), roundId, voterId), { headers: voterHeader(voterId, url.protocol === 'https:') });
};

export const POST: RequestHandler = async ({ params, request, url, cookies }) => {
	const roundId = round(params.slug);
	const body = (await request.json().catch(() => ({}))) as { voter_id?: string; prompt_index?: unknown; answer_index?: unknown };
	if (!validVoteIndices(body.prompt_index, body.answer_index)) {
		return json({ error: 'prompt_index, answer_index required' }, { status: 400 });
	}
	const voterId = resolveVoterId(cookies.get(AMA_COOKIE), body.voter_id);
	const out = castAmaVote(getDb(), roundId, voterId, body.prompt_index, body.answer_index as number);
	return json(out, { headers: voterHeader(voterId, url.protocol === 'https:') });
};
