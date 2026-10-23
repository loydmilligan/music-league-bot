import { error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { buildSnapshotCached } from '$lib/server/boarzStats/data.js';
import { buildDigest2Page } from '$lib/digest2/page.js';
import { buildDigest2Chrome } from '$lib/digest2/chrome.js';
import { peekDigest2Slug } from '$lib/digest2/shares.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url }) => {
	const roundId = Number(params.roundId);
	if (!Number.isInteger(roundId) || roundId <= 0) throw error(400, 'bad round id');
	// ?share=1 → bare layout (root layout reads page.data.share) and no admin data.
	// In load data, not the live URL, so it survives static serving at /d2/<slug>/.
	const share = url.searchParams.get('share') === '1';
	try {
		const db = getDb();
		return {
			...buildDigest2Page(db, roundId, buildSnapshotCached),
			...buildDigest2Chrome(db, roundId, share),
			amaVoteSlug: peekDigest2Slug(db, roundId),
		};
	} catch {
		throw error(404, 'round not found');
	}
};
