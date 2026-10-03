import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { getActiveDraftForRound } from '$lib/digest/llm.js';
import { publishDigest2, Digest2PublishError } from '$lib/digest2/publish.js';

// POST /api/digest2/:roundId/publish — render the 2.0 digest to digests/d2/<slug>/
// and return its digest-host link. Writes only digest2_shares + digests/d2/.
export const POST: RequestHandler = async ({ params }) => {
	const roundId = Number(params.roundId);
	if (!Number.isInteger(roundId) || roundId <= 0) throw error(400, 'bad round id');
	const db = getDb();
	if (!db.prepare('SELECT 1 FROM rounds WHERE id = ?').get(roundId)) throw error(404, 'round not found');
	if (!getActiveDraftForRound(db, roundId)) throw error(409, 'No story draft yet — press Generate first.');
	try {
		return json(await publishDigest2(roundId));
	} catch (e) {
		if (e instanceof Digest2PublishError) throw error(e.status, e.message);
		throw error(500, `publish failed: ${e instanceof Error ? e.message : String(e)}`);
	}
};
