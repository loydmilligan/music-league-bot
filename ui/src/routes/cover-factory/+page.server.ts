import { getDb } from '$lib/db/client.js';
import { getState } from '$lib/server/coverFactory/service.js';
import type { HomeState } from '$lib/coverFactory/api';
import type { PageServerLoad } from './$types.js';

// Same payload as GET /api/cover-factory (projects, leagues, pinned models).
export const load: PageServerLoad = async () => {
	try {
		return { initial: (await getState(getDb(), new URLSearchParams())) as HomeState, error: null };
	} catch (e) {
		return { initial: null, error: e instanceof Error ? e.message : 'load failed' };
	}
};
