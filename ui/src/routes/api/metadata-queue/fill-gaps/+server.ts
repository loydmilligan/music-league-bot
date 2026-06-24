import type { RequestHandler } from './$types.js';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { enqueueMany, type JobType } from '$lib/db/metadataQueue.js';

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const roundId = body?.roundId;

	if (roundId == null || typeof roundId !== 'number' || !Number.isInteger(roundId)) {
		return json({ error: 'roundId is required and must be an integer' }, { status: 400 });
	}

	const db = getDb();

	// Get all URIs for the round
	const uriRows = db
		.prepare(
			`SELECT DISTINCT spotify_uri FROM ml_submissions WHERE round_id = ?`
		)
		.all(roundId) as { spotify_uri: string }[];

	const uris = uriRows.map((r) => r.spotify_uri);

	if (uris.length === 0) {
		return json({ queued: 0 });
	}

	// Fast job types (audio excluded unless auto_analyze_audio is enabled)
	const jobTypes: JobType[] = ['ytm', 'lastfm_pop', 'lastfm_tags', 'lyrics'];

	const autoAudioSetting = db
		.prepare("SELECT value FROM settings WHERE key = ?")
		.get('auto_analyze_audio') as { value: string } | undefined;

	if (autoAudioSetting?.value === '1' || autoAudioSetting?.value === 'true') {
		jobTypes.push('audio');
	}

	// Reset any failed rows for these URIs + these job types back to pending
	const placeholders = uris.map(() => '?').join(',');
	for (const jobType of jobTypes) {
		db.prepare(
			`UPDATE song_metadata_queue
			 SET status = 'pending', error = NULL, retries = 0, started_at = NULL, done_at = NULL
			 WHERE spotify_uri IN (${placeholders})
			   AND job_type = ?
			   AND status = 'failed'`
		).run(...uris, jobType);
	}

	// Enqueue all URIs × job types — INSERT OR IGNORE skips already-pending/processing/done
	enqueueMany(db, uris, jobTypes);

	// Count how many are now pending for these URIs + job types
	const jobTypePlaceholders = jobTypes.map(() => '?').join(',');
	const queuedRow = db
		.prepare(
			`SELECT COUNT(*) AS n
			 FROM song_metadata_queue
			 WHERE spotify_uri IN (${placeholders})
			   AND job_type IN (${jobTypePlaceholders})
			   AND status = 'pending'`
		)
		.get(...uris, ...jobTypes) as { n: number };

	return json({ queued: queuedRow.n });
};
