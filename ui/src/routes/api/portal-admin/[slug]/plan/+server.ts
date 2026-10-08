import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { requirePortalAdmin, parsePlanDays } from '$lib/portalAdmin/api.js';
import { groupPlanTasks } from '$lib/portalAdmin/planView.js';
import { syncSeasonPlan } from '$lib/portalAdmin/seasonSync.js';
import { listTasks } from '$lib/portalAdmin/taskStore.js';

export const GET: RequestHandler = async (event) => {
	const { db, leagueId } = requirePortalAdmin(event);
	const days = parsePlanDays(event.url.searchParams.get('days'));
	const seasonNumber = syncSeasonPlan(db, leagueId);
	const tasks = seasonNumber === null ? [] : listTasks(db, leagueId, seasonNumber);
	return json(groupPlanTasks(tasks, days));
};