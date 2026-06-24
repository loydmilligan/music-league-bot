import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { enqueueMany } from '$lib/db/metadataQueue.js';

// POST /api/shortlist/[id]/analyze-audio
// Enqueues an audio analysis job for the shortlist song.
// The actual analysis runs in the background worker; returns immediately.
export const POST: RequestHandler = async ({ params }) => {
	if (!params.id) throw error(400, 'id required');

	const db = getDb();
	const song = db
		.prepare('SELECT spotify_uri FROM shortlist_songs WHERE id = ?')
		.get(params.id) as { spotify_uri: string } | undefined;
	if (!song) throw error(404, `shortlist song not found: ${params.id}`);

	enqueueMany(db, [song.spotify_uri], ['audio']);
	return json({ queued: 1 });
};
