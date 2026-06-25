import type { RequestHandler } from './$types.js';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { enqueue, resetFailed } from '$lib/db/metadataQueue.js';
import type { JobType } from '$lib/db/metadataQueue.js';

const VALID_JOB_TYPES: ReadonlySet<string> = new Set<JobType>([
	'ytm',
	'lastfm_pop',
	'lastfm_tags',
	'audio',
	'lyrics'
]);

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const uri = body?.uri;
	const job_type = body?.job_type;

	if (!uri || typeof uri !== 'string' || uri.trim() === '') {
		return json({ error: 'uri is required and must be a non-empty string' }, { status: 400 });
	}

	if (!job_type || !VALID_JOB_TYPES.has(job_type)) {
		return json(
			{ error: `job_type must be one of: ${[...VALID_JOB_TYPES].join(', ')}` },
			{ status: 400 }
		);
	}

	const db = getDb();

	// INSERT OR IGNORE creates the row if it doesn't exist yet.
	enqueue(db, uri, job_type as JobType);

	// If the existing row was failed, reset it to pending.
	resetFailed(db, uri, job_type as JobType);

	return json({ queued: 1 });
};
