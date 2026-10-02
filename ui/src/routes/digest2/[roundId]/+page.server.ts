import { error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { buildSnapshotCached } from '$lib/server/boarzStats/data.js';
import { buildDigest2Page } from '$lib/digest2/page.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const roundId = Number(params.roundId);
	if (!Number.isInteger(roundId) || roundId <= 0) throw error(400, 'bad round id');
	try {
		return buildDigest2Page(getDb(), roundId, buildSnapshotCached);
	} catch {
		throw error(404, 'round not found');
	}
};
