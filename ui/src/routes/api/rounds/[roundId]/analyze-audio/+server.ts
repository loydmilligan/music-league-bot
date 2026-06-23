import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { getRoundById } from '$lib/db/rounds.js';
import { analyzeTrack, analyzePlaylist, type AudioFeatures } from '$lib/sintel.js';

function storeFeatures(db: ReturnType<typeof getDb>, features: AudioFeatures[]) {
	const stmt = db.prepare(`
		INSERT OR REPLACE INTO song_audio_features
			(spotify_uri, bpm, key, scale, energy, duration_s, analyzed_at)
		VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
	`);
	const insertMany = db.transaction((rows: AudioFeatures[]) => {
		for (const f of rows) stmt.run(f.spotify_uri, f.bpm, f.key, f.scale, f.energy, f.duration_s);
	});
	insertMany(features);
}

// POST /api/rounds/[roundId]/analyze-audio
// Runs sintel on every submission in the round. Uses analyze-playlist when the
// round has a playlist URL (faster — one download pass). Falls back to per-track.
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
		return json({ analyzed: 0, message: 'no submissions in this round' });
	}

	let features: AudioFeatures[];

	if (round.spotifyPlaylistUrl) {
		try {
			const results = await analyzePlaylist(round.spotifyPlaylistUrl);
			// analyzePlaylist covers all playlist tracks — filter to only round submissions
			const uriSet = new Set(uris);
			features = results.filter((r) => uriSet.has(r.spotify_uri));
			// any submissions missing from playlist → analyze individually
			const missing = uris.filter((u) => !results.find((r) => r.spotify_uri === u));
			if (missing.length > 0) {
				const extra = await Promise.allSettled(missing.map((u) => analyzeTrack(u)));
				for (const r of extra) {
					if (r.status === 'fulfilled') features.push(r.value);
				}
			}
		} catch (e) {
			console.error('[analyze-audio] playlist analysis failed, falling back to per-track:', e);
			const results = await Promise.allSettled(uris.map((u) => analyzeTrack(u)));
			features = results.flatMap((r) => r.status === 'fulfilled' ? [r.value] : []);
		}
	} else {
		const results = await Promise.allSettled(uris.map((u) => analyzeTrack(u)));
		features = results.flatMap((r) => r.status === 'fulfilled' ? [r.value] : []);
	}

	storeFeatures(db, features);
	return json({ analyzed: features.length, total: uris.length });
};
