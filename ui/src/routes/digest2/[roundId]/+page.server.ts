import { error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { buildSnapshotCached } from '$lib/server/boarzStats/data.js';
import { buildStatsEmbedForRound } from '$lib/digest2/statsEmbed.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const roundId = Number(params.roundId);
	if (!Number.isInteger(roundId) || roundId <= 0) throw error(400, 'bad round id');
	try {
		return buildStatsEmbedForRound(getDb(), roundId, buildSnapshotCached);
	} catch {
		throw error(404, 'round not found');
	}
};
