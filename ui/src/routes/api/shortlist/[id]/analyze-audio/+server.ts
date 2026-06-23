import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { analyzeTrack } from '$lib/sintel.js';

// POST /api/shortlist/[id]/analyze-audio
// Looks up the spotify_uri for the shortlist song, runs sintel, stores and returns the result.
export const POST: RequestHandler = async ({ params }) => {
	if (!params.id) throw error(400, 'id required');

	const db = getDb();
	const song = db
		.prepare('SELECT spotify_uri FROM shortlist_songs WHERE id = ?')
		.get(params.id) as { spotify_uri: string } | undefined;
	if (!song) throw error(404, `shortlist song not found: ${params.id}`);

	const features = await analyzeTrack(song.spotify_uri);

	db.prepare(`INSERT OR REPLACE INTO song_audio_features
		(spotify_uri, bpm, key, scale, energy, duration_s, analyzed_at)
		VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))`)
		.run(features.spotify_uri, features.bpm, features.key, features.scale, features.energy, features.duration_s);

	return json(features);
};
