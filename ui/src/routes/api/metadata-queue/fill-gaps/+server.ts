import type { RequestHandler } from './$types.js';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { enqueueMany, type JobType } from '$lib/db/metadataQueue.js';

const VALID_LEVELS = ['all', 'league', 'season', 'round'] as const;
type Level = (typeof VALID_LEVELS)[number];

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();

	// Resolve scope: new {level, id} form OR legacy {roundId} back-compat
	let level: Level;
	let scopeId: number | undefined;

	if (body?.roundId != null) {
		// Legacy back-compat: {roundId: N}
		const roundId = body.roundId;
		if (typeof roundId !== 'number' || !Number.isInteger(roundId)) {
			return json({ error: 'roundId is required and must be an integer' }, { status: 400 });
		}
		level = 'round';
		scopeId = roundId;
	} else if (body?.level != null) {
		// New form: {level, id?}
		if (!VALID_LEVELS.includes(body.level)) {
			return json({ error: `level must be one of: ${VALID_LEVELS.join(', ')}` }, { status: 400 });
		}
		level = body.level as Level;

		if (level !== 'all') {
			const id = body.id;
			if (id == null || typeof id !== 'number' || !Number.isInteger(id)) {
				return json({ error: `id is required and must be an integer when level=${level}` }, { status: 400 });
			}
			scopeId = id;
		}
	} else {
		return json({ error: 'Provide {level} or legacy {roundId}' }, { status: 400 });
	}

	const db = getDb();

	// Resolve URIs by scope — bind params, never string-interpolate ids
	let uriRows: { spotify_uri: string }[];
	if (level === 'all') {
		uriRows = db
			.prepare(`SELECT DISTINCT spotify_uri FROM ml_submissions`)
			.all() as { spotify_uri: string }[];
	} else if (level === 'round') {
		uriRows = db
			.prepare(`SELECT DISTINCT spotify_uri FROM ml_submissions WHERE round_id = ?`)
			.all(scopeId) as { spotify_uri: string }[];
	} else if (level === 'season') {
		uriRows = db
			.prepare(
				`SELECT DISTINCT ms.spotify_uri
				 FROM ml_submissions ms
				 JOIN rounds r ON r.id = ms.round_id
				 WHERE r.season_id = ?`
			)
			.all(scopeId) as { spotify_uri: string }[];
	} else {
		// league
		uriRows = db
			.prepare(
				`SELECT DISTINCT ms.spotify_uri
				 FROM ml_submissions ms
				 JOIN rounds r ON r.id = ms.round_id
				 JOIN seasons s ON s.id = r.season_id
				 WHERE s.league_id = ?`
			)
			.all(scopeId) as { spotify_uri: string }[];
	}

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
