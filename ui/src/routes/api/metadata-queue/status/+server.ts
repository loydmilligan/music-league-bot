import type { RequestHandler } from './$types.js';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { getQueueStatus } from '$lib/db/metadataQueue.js';
import { getDigestReadiness, getCoverageMatrix } from '$lib/db/metadataQueue.js';

export const GET: RequestHandler = async ({ url }) => {
	const db = getDb();
	const roundIdParam = url.searchParams.get('roundId');
	const roundId = roundIdParam != null ? Number(roundIdParam) : undefined;

	if (roundIdParam != null && (isNaN(roundId as number) || !Number.isInteger(roundId as number))) {
		return json({ error: 'roundId must be an integer' }, { status: 400 });
	}

	const status = getQueueStatus(db, roundId);

	if (roundId != null) {
		const digestReadiness = getDigestReadiness(db, roundId);
		const coverageMatrix = getCoverageMatrix(db, roundId);
		return json({ ...status, digestReadiness, coverageMatrix });
	}

	return json(status);
};
