import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types.js';
import { buildSnapshotCached } from '$lib/server/boarzStats/data.js';

export const load: PageServerLoad = async ({ params, url }) => {
	const season = url.searchParams.get('season');
	try {
		return {
			snapshot: buildSnapshotCached({
				leagueSlug: params.league,
				seasons: season === 'all' ? 'all' : season && Number.isFinite(Number(season)) ? [Number(season)] : undefined,
			}),
		};
	} catch (cause) {
		throw error(404, cause instanceof Error ? cause.message : 'League stats not found');
	}
};
