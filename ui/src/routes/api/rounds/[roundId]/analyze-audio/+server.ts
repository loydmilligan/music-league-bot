import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { getRoundById } from '$lib/db/rounds.js';
import { enqueueMany } from '$lib/db/metadataQueue.js';

// POST /api/rounds/[roundId]/analyze-audio
// Enqueues audio analysis jobs for every submission in the round.
// The actual analysis runs in the background worker; returns immediately.
export const POST: RequestHandler = async ({ params }) => {
	const roundId = Number(params.roundId);
	if (!roundId) throw error(400, 'invalid roundId');

	const db = getDb();
	const round = getRoundById(db, roundId);
	if (!round) throw error(404, `round not found: ${roundId}`);

	const uris = (
		db.prepare('SELECT DISTINCT spotify_uri FROM ml_submissions WHERE round_id = ?').all(roundId) as Array<{ spotify_uri: string }>
	).map((r) => r.spotify_uri);

	if (uris.length === 0) {
		return json({ queued: 0, message: 'no submissions in this round' });
	}

	enqueueMany(db, uris, ['audio']);
	return json({ queued: uris.length });
};
