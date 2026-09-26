import type { PageServerLoad } from './$types.js';
import { buildSnapshotCached } from '$lib/server/boarzStats/data.js';

export const load: PageServerLoad = async ({ url }) => {
	const season = url.searchParams.get('season');
	return {
		snapshot: buildSnapshotCached({
			seasons: season === 'all' ? 'all' : season && Number.isFinite(Number(season)) ? [Number(season)] : undefined,
		}),
	};
};
