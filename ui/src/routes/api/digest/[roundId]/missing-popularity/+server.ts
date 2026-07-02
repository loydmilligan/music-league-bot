import type { RequestHandler } from './$types.js';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';

// GET /api/digest/[roundId]/missing-popularity
// Returns season-cumulative submissions (through this round) that have no
// popularity_proxy. Scope matches the Tastemaker coverage gate in prepChecks.ts:
// competitor_id IS NOT NULL, spotify:track:% URI, same season join.
export const GET: RequestHandler = async ({ params }) => {
	const db = getDb();
	const roundId = Number(params.roundId);
	const songs = db
		.prepare(
			`SELECT DISTINCT s.spotify_uri AS spotifyUri, s.title, s.artists AS artist
       FROM ml_submissions s
       JOIN rounds r ON r.id = s.round_id
       LEFT JOIN song_popularity sp ON sp.spotify_uri = s.spotify_uri
       WHERE r.season_id = (SELECT season_id FROM rounds WHERE id = ?)
         AND r.id <= ?
         AND s.competitor_id IS NOT NULL
         AND s.spotify_uri LIKE 'spotify:track:%'
         AND (sp.popularity_proxy IS NULL)
       ORDER BY s.title`
		)
		.all(roundId, roundId) as { spotifyUri: string; title: string; artist: string }[];
	return json({ songs });
};
