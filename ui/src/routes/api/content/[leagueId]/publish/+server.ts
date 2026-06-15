import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { publishSite } from '$lib/dashboard/publish.js';

// POST /api/content/:leagueId/publish — mint/refresh the public dashboard for a league.
export const POST: RequestHandler = async ({ params }) => {
	const leagueId = Number(params.leagueId);
	if (!Number.isInteger(leagueId) || leagueId <= 0) throw error(400, 'invalid leagueId');

	const db = getDb();

	try {
		const result = await publishSite(db, leagueId);
		return json(result);
	} catch (err) {
		if (err instanceof Error && err.message.includes('not found')) {
			throw error(404, err.message);
		}
		throw err;
	}
};
