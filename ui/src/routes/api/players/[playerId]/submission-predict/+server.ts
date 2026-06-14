import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { getPlayerById } from '$lib/db/players.js';
import { runSubmissionPredict } from '$lib/predict/tasks/submissionPredict.js';
import { validateTracks } from '$lib/predict/spotifyValidate.js';

// POST /api/players/:playerId/submission-predict
// Body: { theme: { name, description } }
// Runs the submission-predict task, Spotify-validates candidates + prediction,
// and returns the enriched three-part result.
export const POST: RequestHandler = async ({ params, request }) => {
	const playerId = Number(params.playerId);
	if (!playerId) throw error(400, 'invalid playerId');

	const db = getDb();
	if (!getPlayerById(db, playerId)) throw error(404, `player not found: ${playerId}`);

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'request body must be valid JSON');
	}

	if (!body || typeof body !== 'object') throw error(400, 'request body must be an object');

	const { theme } = body as Record<string, unknown>;

	if (!theme || typeof theme !== 'object') throw error(400, 'body.theme is required and must be an object');
	const { name, description } = theme as Record<string, unknown>;
	if (typeof name !== 'string' || !name.trim()) throw error(400, 'theme.name must be a non-empty string');
	if (typeof description !== 'string') throw error(400, 'theme.description must be a string');

	const { forceRegen } = body as Record<string, unknown>;

	const { output, meta, cacheHit, generatedAt } = await runSubmissionPredict(db, playerId, {
		theme: { name, description },
		forceRegen: forceRegen === true,
	});

	// Spotify-validate candidates — merge resolved fields back alongside LLM `why`
	const validatedCandidates = await validateTracks(
		output.candidates.map((c) => ({ title: c.title, artist: c.artist })),
	);
	const enrichedCandidates = output.candidates.map((c, i) => ({
		...c,
		...validatedCandidates[i],
	}));

	// Spotify-validate the final prediction pick
	const [validatedPrediction] = await validateTracks([
		{ title: output.prediction.title, artist: output.prediction.artist },
	]);
	const enrichedPrediction = {
		...output.prediction,
		...(validatedPrediction.spotify_url ? { spotify_url: validatedPrediction.spotify_url } : {}),
		...(validatedPrediction.album_art_url ? { album_art_url: validatedPrediction.album_art_url } : {}),
	};

	return json({
		profile: output.profile,
		candidates: enrichedCandidates,
		prediction: enrichedPrediction,
		model: meta.model,
		cost_usd: meta.costUsd,
		latency_ms: meta.latencyMs,
		generated_at: generatedAt,
		cache_hit: cacheHit,
	});
};
