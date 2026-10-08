import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { requirePortalAdmin } from '$lib/portalAdmin/api.js';
import { syncSeasonPlan } from '$lib/portalAdmin/seasonSync.js';

export const POST: RequestHandler = async (event) => {
	const { db, leagueId } = requirePortalAdmin(event);
	const seasonNumber = syncSeasonPlan(db, leagueId);
	return json({ ok: true, seasonNumber });
};