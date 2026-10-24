import { BOARZ_LEAGUE_SLUG } from '$lib/server/avatarFactory/notes.js';
import { publicState, runRescan } from '$lib/server/avatarFactory/actions.js';
import type { PageServerLoad } from './$types.js';

export const load: PageServerLoad = async () => {
	try {
		runRescan();
	} catch {
		// Sources dir may be unset outside docker; page still renders.
	}
	try {
		return { initial: publicState(BOARZ_LEAGUE_SLUG) };
	} catch (e) {
		return { initial: null, error: e instanceof Error ? e.message : 'load failed' };
	}
};
