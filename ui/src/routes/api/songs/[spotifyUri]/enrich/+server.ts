import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { enqueue } from '$lib/db/metadataQueue.js';
import type { JobType } from '$lib/db/metadataQueue.js';

const VALID_JOB_TYPES: readonly JobType[] = ['ytm', 'lastfm_pop', 'lastfm_tags', 'audio', 'lyrics'];

// POST /api/songs/[spotifyUri]/enrich
// Body (optional): { jobTypes?: Array<'ytm'|'lastfm_pop'|'lastfm_tags'|'audio'|'lyrics'> }
//
// Enqueues job types for the given spotify_uri.
// Defaults to all 5 job types if body is absent or jobTypes is omitted.
// Returns: { queued: number, alreadyQueued: number }
export const POST: RequestHandler = async ({ params, request }) => {
	const uri = decodeURIComponent(params.spotifyUri);

	if (!uri.startsWith('spotify:track:')) {
		throw error(400, `invalid spotifyUri: must start with 'spotify:track:'`);
	}

	let jobTypes: JobType[] = [...VALID_JOB_TYPES];

	const contentType = request.headers.get('content-type') ?? '';
	if (contentType.includes('application/json')) {
		let body: unknown;
		try {
			body = await request.json();
		} catch {
			throw error(400, 'invalid JSON body');
		}

		if (body !== null && typeof body === 'object' && 'jobTypes' in body) {
			const raw = (body as { jobTypes: unknown }).jobTypes;
			if (!Array.isArray(raw)) {
				throw error(400, 'jobTypes must be an array');
			}
			for (const jt of raw) {
				if (!VALID_JOB_TYPES.includes(jt as JobType)) {
					throw error(400, `invalid jobType: ${jt}`);
				}
			}
			jobTypes = raw as JobType[];
		}
	}

	const db = getDb();

	// Use per-job enqueue so we can count actual DB changes (INSERT OR IGNORE)
	const stmt = db.prepare(
		`INSERT OR IGNORE INTO song_metadata_queue (spotify_uri, job_type, queued_at)
		 VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))`
	);

	let queued = 0;
	const tx = db.transaction(() => {
		for (const jt of jobTypes) {
			const result = stmt.run(uri, jt);
			if (result.changes > 0) queued++;
		}
	});
	tx();

	return json({ queued, alreadyQueued: jobTypes.length - queued });
};
